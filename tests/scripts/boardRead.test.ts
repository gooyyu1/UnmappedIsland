import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { cycleHours } from '../../scripts/daemon/board-move.mjs';
import {
  FIRST_ISSUE_PULL,
  MERGED_CAP,
  MERGED_WINDOW_HOURS,
  countUnsummarizedAnalyses,
  readBoard,
} from '../../scripts/daemon/board-read.mjs';

/**
 * `scripts/daemon/board-read.mjs` の検査。
 *
 * 盤面を組み立てる手のうち、**GitHub と CCR の外を見る分**——判断の履歴と、分析の記録の数え方
 * ——と、**一覧の引き方**（スメルを拾う係が読む窓の取り方・開いている issue を切らずに引くこと）を
 * ここで見る。手を決める分は `boardMove.test.ts`、1周を通した形は `boardRound.test.ts` が持つ。
 *
 * **判断の履歴は、差し替えの口を通さずに実物を通す。** あちらは `pendingDecisions` を渡して数を
 * 決めてしまうので、**既定の経路（`archive/` を除く・`.md` だけ数える）は誰も通らない。**
 *
 * **分析の記録のほうは、置き場を渡して通す。** 日付の比較と「二次がまだ一度も書いていない」の分岐を
 * 持つので、**実物の今の中身で通すと、二次が1回書いた日から検査の意味が変わる。**
 */

const ROOT = resolve(__dirname, '../..');
const DECISIONS = join(ROOT, 'agent-ops', 'decisions');

/** 盤面のうち、履歴の数え方に関わらない部分。引けたことにして先へ通す。 */
const EMPTY_GH = (args: readonly string[]): string | undefined =>
  args[0] === 'api' && args[1] === 'graphql' ? '{"data":{}}' : '[]';

async function pendingDecisions(): Promise<unknown> {
  return (
    await readBoard({
      gh: EMPTY_GH,
      sessions: () => [],
      log: () => {},
      now: new Date('2026-09-06T00:00:00Z'),
      settleMinutes: 10,
      taken: {},
    })
  )?.pendingDecisions;
}

describe('board-read.mjs', () => {
  const direct = readdirSync(DECISIONS, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith('.md'),
  );
  const archived = readdirSync(join(DECISIONS, 'archive')).filter((name) => name.endsWith('.md'));

  // 除く対象が実在しないと、下の検査は「除けている」と「そもそも無い」を区別できない。
  it('棚卸しを通った履歴が実際に置いてある', () => {
    expect(archived.length).toBeGreaterThan(0);
  });

  it('数えるのは、archive に入っていない履歴だけ', async () => {
    expect(await pendingDecisions()).toBe(direct.length);
  });

  // `archive` はディレクトリなので `.md` で終わらず、名前での絞りだけでも落ちる。**数え方を
  // `withFileTypes` から名前へ変えても気づけない**ので、入れ子の中身を数えていないことを別に見る。
  it('archive の中の件数を足していない', async () => {
    expect(await pendingDecisions()).toBeLessThan(direct.length + archived.length);
  });
});

describe('スメルを拾う係が読む窓（board-design.md 4.4.2）', () => {
  const NOW = new Date('2026-09-07T12:00:00Z');

  /** `gh` へ渡った引数を控えながら盤面を1つ組む。`merged` はマージ済みPRの一覧として返る。 */
  async function readWith(merged: readonly unknown[] = []) {
    const calls: string[][] = [];
    const log: string[] = [];
    const gh = (args: readonly string[]): string => {
      calls.push([...args]);
      if (args[0] === 'api' && args[1] === 'graphql') return '{"data":{}}';
      if (args[0] === 'pr' && args[1] === 'list' && args.includes('merged')) {
        return JSON.stringify(merged);
      }
      return '[]';
    };
    await readBoard({
      gh,
      sessions: () => [],
      pendingDecisions: () => 0,
      unsummarizedAnalyses: () => 0,
      log: (line) => log.push(line),
      now: NOW,
      settleMinutes: 10,
      taken: {},
    });
    return { merged: calls.find((args) => args.includes('merged')), log: log.join('\n') };
  }

  // 窓が間隔を下回ると、間に入ったぶんが誰にも読まれないまま落ちる（#1787）。
  it('窓の幅が、係の立つ間隔より広い', () => {
    const interval = cycleHours('analysis');
    if (interval === undefined) throw new Error('`analysis` が CYCLES に居ない');
    expect(MERGED_WINDOW_HOURS).toBeGreaterThan(interval);
  });

  // **本数で切らない。** 本数は1本あたりの時間が変われば覆う期間も変わる。**窓の幅そのものは
  // 上の検査が見る**ので、ここは絞り方だけを見る（幅を写すと、幅を動かしただけでここが赤くなる）。
  it('マージされた時刻で絞って引く', async () => {
    const merged = (await readWith()).merged ?? [];
    const start = new Date(NOW.getTime() - MERGED_WINDOW_HOURS * 3_600_000);
    expect(merged[merged.indexOf('--search') + 1]).toBe(
      `merged:>=${start.toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
    );
  });

  // **黙って切らない。** 切られた側は「1件も無い」と同じ形になり、次の周も同じに読まれる。
  it('引きすぎの栓に当たった周は、全部を見ていないと言う', async () => {
    const many = Array.from({ length: MERGED_CAP }, (_, index) => ({ number: index, comments: [] }));
    expect((await readWith(many)).log).toContain('マージ済みPRが上限');
  });

  it('栓に届いていない周は言わない', async () => {
    expect((await readWith([{ number: 1, comments: [] }])).log).not.toContain('上限');
  });
});

describe('開いている issue は、上限で切らずに全部引く', () => {
  /**
   * 開いている issue を `count` 件だけ置いた世界で盤面を1つ組む。**渡す `gh` は `--limit` を実際に
   * 守る**——守らない `gh` だと、いくつ渡しても全部が返るので、**上限を固定へ戻しても緑のまま**
   * になる（この検査が見ている面はそこだけ）。並びは本物と同じ**作成の新しい順**（番号の大きい側が先）
   * にしてあるので、切られるのは番号の小さい側。
   */
  async function readWith(count: number) {
    const all = Array.from({ length: count }, (_, index) => ({
      number: count - index,
      labels: [],
      blockedBy: { nodes: [] },
    }));
    const limits: number[] = [];
    const gh = (args: readonly string[]): string => {
      if (args[0] === 'api' && args[1] === 'graphql') return '{"data":{}}';
      if (args[0] !== 'issue') return '[]';
      const limit = Number(args[args.indexOf('--limit') + 1]);
      limits.push(limit);
      return JSON.stringify(all.slice(0, limit));
    };
    const board = (await readBoard({
      gh,
      sessions: () => [],
      pendingDecisions: () => 0,
      unsummarizedAnalyses: () => 0,
      log: () => {},
      now: new Date('2026-09-07T12:00:00Z'),
      settleMinutes: 10,
      taken: {},
    })) as { issues: { number: number }[] } | undefined;
    return { issues: board?.issues ?? [], limits };
  }

  // 切られるのはいちばん古い issue で、切られたぶんは「1件も無い」と同じ形になる。2026-09-11 に
  // 100件で実際に起き、走っているワーカーが担当していた #1722 が盤面から消えた。
  it('1回で引きにいく数を超えて開いていても、いちばん古いものまで返る', async () => {
    const { issues } = await readWith(FIRST_ISSUE_PULL * 2 + 1);
    expect(issues).toHaveLength(FIRST_ISSUE_PULL * 2 + 1);
    expect(issues.at(-1)?.number).toBe(1);
  });

  // **届いた回だけ引き直す。** 毎周2回引くと、1周30秒ぶんの固定費がそのまま倍になる。
  it('1回で引きにいく数に届かなければ、引き直さない', async () => {
    expect((await readWith(FIRST_ISSUE_PULL - 1)).limits).toEqual([FIRST_ISSUE_PULL]);
  });

  // **引けなかったことと「1件も無い」を混ぜない。** 空として読むと、値の見張り
  // （`check-values.mjs`）では同じ題の2本目がそのまま立つ。
  it('応答が読めなかった周は、引けなかった周と同じに読む', async () => {
    const gh = (args: readonly string[]): string =>
      args[0] === 'issue' ? '壊れた応答' : args[1] === 'graphql' ? '{"data":{}}' : '[]';
    const board = await readBoard({
      gh,
      sessions: () => [],
      pendingDecisions: () => 0,
      unsummarizedAnalyses: () => 0,
      log: () => {},
      now: new Date('2026-09-07T12:00:00Z'),
      settleMinutes: 10,
      taken: {},
    });
    expect(board).toBeUndefined();
  });
});

describe('二次がまだ読んでいない分析の記録を数える（board-design.md 2.17.4）', () => {
  /** 一次の記録と二次のまとめを置いた作業場を1つ作る。`summary` に `undefined` を渡すと、置き場ごと無い。 */
  function placed(written: readonly string[], summary?: readonly string[]) {
    const root = mkdtempSync(join(tmpdir(), 'analysis-'));
    const analyses = join(root, 'analysis');
    mkdirSync(analyses);
    for (const name of written) writeFileSync(join(analyses, name), '');
    const summaries = join(analyses, 'summary');
    if (summary !== undefined) {
      mkdirSync(summaries);
      for (const name of summary) writeFileSync(join(summaries, name), '');
    }
    return countUnsummarizedAnalyses(() => {}, {
      analyses: pathToFileURL(`${analyses}/`),
      summaries: pathToFileURL(`${summaries}/`),
    });
  }

  // **置き場そのものが無い周を、読めない周と同じに扱わない。** 同じに扱うと係が永久に立たない。
  it('二次がまだ一度も書いていなければ、一次の記録が全部そのまま未処理になる', () => {
    expect(placed(['2026-09-06.md', '2026-09-07.md'])).toBe(2);
  });

  it('二次が読んだ日までの記録は数に入らない', () => {
    expect(placed(['2026-09-05.md', '2026-09-06.md', '2026-09-07.md'], ['2026-09-06.md'])).toBe(1);
  });

  it('二次が最後に書いた日で切る（それより前のまとめは効かない）', () => {
    const summary = ['2026-08-30.md', '2026-09-06.md'];
    expect(placed(['2026-09-05.md', '2026-09-06.md', '2026-09-07.md'], summary)).toBe(1);
  });

  it('一次に新しい記録が無ければ、立てる仕事は無い', () => {
    expect(placed(['2026-09-06.md'], ['2026-09-06.md'])).toBe(0);
  });

  // 一次の帯には `<日付>-backfill.md` のような変種が実際に置かれている。**日付で切るので、同じ日の
  // 変種は同じ扱いになる**——名前の全体で比べる形にすると、ここが黙って落ちる。
  it('同じ日の変種も、その日で切る', () => {
    const written = ['2026-09-06-backfill.md', '2026-09-06.md', '2026-09-07.md'];
    expect(placed(written, ['2026-09-06.md'])).toBe(1);
  });

  // 日付で始まらないファイル（`README.md` など）を置いても数が動かないことを見る。
  it('日付で始まらないファイルは数えない', () => {
    expect(placed(['README.md', '2026-09-07.md'], ['2026-09-06.md'])).toBe(1);
  });
});
