import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnScript } from '../support/runScript';
import { STUB_SHEBANG } from '../support/stubShebang';
import { type CachedUsage, writeUsageCache, writeUsagePolled } from '../support/usageCache';

/**
 * `scripts/daemon/headroom.sh`（と中身の `headroom.mjs`）の検査
 * （`agent-ops/board-design.md` 2.5.2節）。
 *
 * ここが守るのは**比べているものが「残量」ではなく「あと1本入るか」であること**。
 *
 * - 枠ごとに比べ、**どれか1つでも足りなければ止める**（2026-09-14 からの3日で当たったのは週次）
 * - **消費が0の記録を平均に入れない**——空のまま畳まれたセッションを1本の実績として数えると、
 *   上限に当たっている間ほど平均が0へ近づき、いちばん止めたい周に手綱が緩む（issue #2209）
 * - **「制限中だった」という状態を持たない**ので、値が戻れば次の呼び出しでそのまま通る
 *
 * 使用量の控え（`usage.sh --last` が読む）と記録（`spent.tsv`）を `BOARD_STATE` で差し替える。
 * **口は叩かない**ので、この検査は網に触らない。
 */

// 実プロセス（bash + node）を起こす。
vi.setConfig({ testTimeout: 20000 });

const SCRIPT = resolve(__dirname, '../../scripts/daemon/headroom.sh');

/** 余力で止まったことを名乗る終了コード。人が手綱で止めた3と分ける（`headroom.sh`）。 */
const HELD = 4;

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'unmapped-island-headroom-'));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

/** 使用量の控えを置く。形は `usageCache.ts`。 */
function cacheUsage(usage: CachedUsage = {}): void {
  writeUsageCache(stateDir, usage);
}

/** 畳まれたセッションの記録を置く。並びは `usage-attribute.mjs` の出す形。 */
function cacheSpent(rows: readonly { kind: string; five: number; seven: number }[]): void {
  const lines = rows.map(
    (row, index) =>
      `2026-09-16T0${index % 10}:00:00Z\t${row.kind}\t${row.five.toFixed(4)}\t${row.seven.toFixed(4)}\tcse_${index}`,
  );
  writeFileSync(join(stateDir, 'spent.tsv'), `${lines.join('\n')}\n`, 'utf-8');
}

/**
 * **控えが無い・古いときは口を叩きに行く**（`headroom.sh`）ので、資格情報の在り処を作業用の
 * ディレクトリへ向けて**必ず落ちるようにする**——そうしないと、控えの検査が本物の網に触る。
 */
function run(kind: string, path?: string): { code: number; stdout: string } {
  const call = spawnScript(SCRIPT, [kind], {
    env: {
      ...process.env,
      BOARD_STATE: stateDir,
      HOME: stateDir,
      USERPROFILE: stateDir,
      ...(path === undefined ? {} : { PATH: `${path}${delimiter}${process.env.PATH ?? ''}` }),
    },
  });
  return { code: call.status ?? -1, stdout: call.stdout };
}

/**
 * 口の中身（`usage.mjs`）だけを差し替える `node` を PATH の先頭へ置き、その置き場を返す。
 * **`headroom.mjs` は本物で走らせる**必要があるので、引数で振り分ける。
 */
function stubEndpoint(lines: string): string {
  const bin = mkdtempSync(join(tmpdir(), 'unmapped-island-headroom-bin-'));
  const node = join(bin, 'node');
  writeFileSync(
    node,
    `${STUB_SHEBANG}\ncase "$1" in\n*usage.mjs) printf '%s\\n' '${lines}'; exit 0 ;;\nesac\nexec '${process.execPath}' "$@"\n`,
    'utf-8',
  );
  chmodSync(node, 0o755);
  return bin;
}

/** 同じ消費の記録を並べる。平均を信じ始める件数より多く置く。 */
function samples(
  kind: string,
  five: number,
  seven: number,
): readonly { kind: string; five: number; seven: number }[] {
  return Array.from({ length: 5 }, () => ({ kind, five, seven }));
}

describe('headroom.sh', () => {
  it('余力がたっぷりあれば通す', () => {
    cacheUsage();

    expect(run('new-task')).toEqual({ code: 0, stdout: 'GO\n' });
  });

  // 枠は独立に尽きる。当たったのは週次のほうで、5時間の枠には余力が在った（issue #2209）。
  it('週次の余力だけが足りなくても止まる', () => {
    cacheUsage({ fiveHour: 1, sevenDay: 99 });

    const result = run('new-task');

    expect(result.code).toBe(HELD);
    expect(result.stdout).toContain('seven_day');
  });

  it('5時間の余力だけが足りなくても止まる', () => {
    cacheUsage({ fiveHour: 95, sevenDay: 1 });

    const result = run('new-task');

    expect(result.code).toBe(HELD);
    expect(result.stdout).toContain('five_hour');
  });

  // **毎回引いて比べるだけ**（2.5.1）。止めた後に戻すための処理は無い。
  it('値が戻れば、次の呼び出しでそのまま通る', () => {
    cacheUsage({ sevenDay: 99 });
    expect(run('new-task').code).toBe(HELD);

    cacheUsage({ sevenDay: 10 });
    expect(run('new-task').code).toBe(0);
  });

  // 既に立てられないので、計測に関わらず全部止める（2.5.2）。
  it('錠が掛かっていれば、余力が在っても止まる', () => {
    cacheUsage({ fiveHour: 0, sevenDay: 0, locked: 'usage_limit_reached' });

    const result = run('review');

    expect(result.code).toBe(HELD);
    expect(result.stdout).toContain('usage_limit_reached');
  });

  // **段は結果として付く**（2.5.2）。しきい値は種類ごとに書き分けていないので、同じ余力で
  // 重い種類だけが落ちるのは、記録された消費の差からしか出ない。
  it('同じ余力でも、消費の大きい種類から先に止まる', () => {
    cacheUsage({ fiveHour: 10, sevenDay: 92 });
    cacheSpent([...samples('new-task', 20, 5), ...samples('review', 1, 0.5)]);

    expect(run('new-task').code).toBe(HELD);
    expect(run('review').code).toBe(0);
  });

  // **0は「1本で0しか食わなかった」ではなく「一度も動いているところを見なかった」。** 2026-09-14
  // からの3日は、投入した90本が空のまま畳まれてこの形で残っている（#2209）。
  it('消費が0の記録は、平均に入れない', () => {
    cacheUsage({ fiveHour: 10, sevenDay: 92 });
    cacheSpent([
      ...samples('new-task', 20, 5),
      ...Array.from({ length: 90 }, () => ({ kind: 'new-task', five: 0, seven: 0 })),
    ]);

    expect(run('new-task').code).toBe(HELD);
  });

  // **タグから付く種類のほうが粗い**（`headroom.mjs` の `measuredKind`）。寄せないと、この種類の
  // 計測は永久に0件で、既定値のまま止まり続ける。
  it('`review-untasked` は、`review` の記録で比べる', () => {
    cacheUsage({ fiveHour: 10, sevenDay: 97 });
    cacheSpent(samples('review', 1, 0.5));

    expect(run('review-untasked').code).toBe(0);
  });

  // **起こす周を分けて測った値は、記録に永久に0件**（起こされたセッションの消費は、そのセッション
  // 自身のタグの種類として積まれる）。**新しいタスクが止まる周には、起こす手も止まる**と決めてある
  // ので（2.5.2）、`other` の側がいくら軽くても通らない。
  it('`resume` は、`new-task` の記録で比べる', () => {
    cacheUsage({ fiveHour: 10, sevenDay: 92 });
    cacheSpent([...samples('new-task', 20, 5), ...samples('other', 1, 0.5)]);

    expect(run('resume').code).toBe(HELD);
    expect(run('other').code).toBe(0);
  });

  // 計測が薄いうちは既定値。**既定は大きめに置く**ので、記録の無い種類は先に止まる（2.5.3）。
  it('記録が足りない種類は、既定値で比べる', () => {
    cacheUsage({ fiveHour: 10, sevenDay: 97 });
    cacheSpent([{ kind: 'new-task', five: 1, seven: 0.5 }]);

    expect(run('new-task').code).toBe(HELD);
  });

  // **控えが無い・古いのを、そのまま「立てるな」にしない**（`headroom.sh`）。控えを書くのは口を
  // 叩いた周だけなので、デーモンが回っていない場所で手から投入すると必ずこの形になる。
  it('控えが無ければ、自分で1回引いてその値で比べる', () => {
    const bin = stubEndpoint('five_hour 5 - -\nseven_day 99 - -');
    try {
      const result = run('new-task', bin);

      expect(result.code).toBe(HELD);
      expect(result.stdout).toContain('seven_day');
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  // **古い値で通すと、上限に当たってから気づく**（`usage.sh` の `--last`）ので、控えは使わずに
  // 引き直す。
  it('控えが古ければ、控えではなく引き直した値で比べる', () => {
    cacheUsage({ agedSeconds: 60 * 60 * 24, fiveHour: 1, sevenDay: 1 });
    const bin = stubEndpoint('five_hour 5 - -\nseven_day 99 - -');
    try {
      expect(run('new-task', bin).code).toBe(HELD);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  // 引き直しても駄目なら、通す側へは倒れない。**告げるのは、その場で打てば本当に答えが出る1行**
  // ——ただの `usage.sh` は間隔が空くまで何も出さずに2で返るので、案内にならない
  // （その打ち方が実際に通ることは `usagePoll.test.ts` が留める）。
  //
  // **口が落ちた（1）のか順番待ち（2）なのかで名乗りを分けない。** 印は叩いた回に、控えは引けた回
  // だけに書かれるので、**口が落ちているときほど2の側へ落ちる**——分けると「順番待ち」と読ませる。
  it('引き直せなければ、どちらの落ち方でも同じ1行で止まる', () => {
    const noCache = run('new-task');

    cacheUsage({ agedSeconds: 60 * 60 * 24 });
    writeUsagePolled(stateDir);
    const notMyTurn = run('new-task');

    for (const result of [noCache, notMyTurn]) {
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('UNKNOWN');
      expect(result.stdout).toContain('USAGE_MIN_SECONDS=0');
    }
    expect(notMyTurn.stdout).toBe(noCache.stdout);
  });

  // **欠けた枠を「余力が在る」として通すと、その枠では手綱が掛からないまま上限に当たる。**
  it('枠が1つでも欠けた控えなら止まる', () => {
    writeFileSync(
      join(stateDir, 'usage-latest'),
      `${Math.floor(Date.now() / 1000)}\nfive_hour 5 2026-09-05T01:00:00Z -\n`,
      'utf-8',
    );

    expect(run('new-task').code).toBe(1);
  });
});
