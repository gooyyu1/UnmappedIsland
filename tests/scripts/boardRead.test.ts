import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { cycleHours } from '../../scripts/agent/board-move.mjs';
import {
  MERGED_CAP,
  MERGED_WINDOW_HOURS,
  countUnsummarizedAnalyses,
  readBoard,
} from '../../scripts/agent/board-read.mjs';

/**
 * `scripts/agent/board-read.mjs` の検査。
 *
 * 盤面を組み立てる手のうち、**GitHub と CCR の外を見る分**——判断の履歴と、分析の記録の数え方
 * ——と、**スメルを拾う係が読む窓の取り方**をここで見る。手を決める分は `boardMove.test.ts`、
 * 1周を通した形は `boardRound.test.ts` が持つ。
 *
 * **判断の履歴は、差し替えの口を通さずに実物を通す。** あちらは `pendingDecisions` を渡して数を
 * 決めてしまうので、**既定の経路（`archive/` を除く・`.md` だけ数える）は誰も通らない。**
 *
 * **分析の記録のほうは、置き場を渡して通す。** 日付の比較と「二次がまだ一度も書いていない」の分岐を
 * 持つので、**実物の今の中身で通すと、二次が1回書いた日から検査の意味が変わる。**
 */

const ROOT = resolve(__dirname, '../..');
const DECISIONS = join(ROOT, '.claude', 'decisions');

/** 盤面のうち、履歴の数え方に関わらない部分。引けたことにして先へ通す。 */
const EMPTY_GH = (args: readonly string[]): string | undefined =>
  args[0] === 'api' && args[1] === 'graphql' ? '{"data":{}}' : '[]';

function pendingDecisions(): unknown {
  return readBoard({
    gh: EMPTY_GH,
    sessions: () => [],
    log: () => {},
    now: new Date('2026-09-06T00:00:00Z'),
    settleMinutes: 10,
    taken: {},
  })?.pendingDecisions;
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

  it('数えるのは、archive に入っていない履歴だけ', () => {
    expect(pendingDecisions()).toBe(direct.length);
  });

  // `archive` はディレクトリなので `.md` で終わらず、名前での絞りだけでも落ちる。**数え方を
  // `withFileTypes` から名前へ変えても気づけない**ので、入れ子の中身を数えていないことを別に見る。
  it('archive の中の件数を足していない', () => {
    expect(pendingDecisions()).toBeLessThan(direct.length + archived.length);
  });
});

describe('スメルを拾う係が読む窓（board-design.md 4.4.2）', () => {
  const NOW = new Date('2026-09-07T12:00:00Z');

  /** `gh` へ渡った引数を控えながら盤面を1つ組む。`merged` はマージ済みPRの一覧として返る。 */
  function readWith(merged: readonly unknown[] = []) {
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
    readBoard({
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

  // **本数で切らない。** 本数は1本あたりの時間が変われば覆う期間も変わる。
  it('マージされた時刻で絞って引く', () => {
    const merged = readWith().merged ?? [];
    expect(merged[merged.indexOf('--search') + 1]).toBe('merged:>=2026-09-05T12:00:00Z');
  });

  // **黙って切らない。** 切られた側は「1件も無い」と同じ形になり、次の周も同じに読まれる。
  it('引きすぎの栓に当たった周は、全部を見ていないと言う', () => {
    const many = Array.from({ length: MERGED_CAP }, (_, index) => ({ number: index, comments: [] }));
    expect(readWith(many).log).toContain('マージ済みPRが上限');
  });

  it('栓に届いていない周は言わない', () => {
    expect(readWith([{ number: 1, comments: [] }]).log).not.toContain('上限');
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
