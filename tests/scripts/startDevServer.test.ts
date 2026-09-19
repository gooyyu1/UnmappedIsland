import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { spawnScript } from '../support/runScript';
import { STUB_SHEBANG } from '../support/stubShebang';

/**
 * `.claude/skills/run/scripts/start-dev-server.sh` の検査。
 *
 * 守るのは**待ち方**——開発サーバが名乗るのを待つのであって、決まった回数寝るのではない。画面を
 * 撮るたびに通る道なので、ここが刻みぶん底上げされると、撮る手すべてがその分だけ遅くなる。
 *
 * `npx` をPATHの先頭で身代わりへ差し替える。**本物の Vite を起こさないため**——起こすと、この検査
 * そのものが機械の速さで決まる。`sleep` は控えてから本物へ渡す身代わりにして、刻みを読む。
 */

const SCRIPT = resolve(__dirname, '../../.claude/skills/run/scripts/start-dev-server.sh');

/**
 * 身代わりの `npx` が名乗るまでの間（秒）。**0にしない**——親が最初に見に行く前に子が書き終えて
 * いるかは、どちらのプロセス生成が先に済むかで決まるだけなので、**この検査の成否が機械で変わる。**
 * 間を置けば、どんな機械でも「まだ名乗っていない状態を見て、名乗るまで待つ」側を通る。
 */
const SAYS_AFTER = 0.2;

interface World {
  /** 身代わりの `npx` が `SAYS_AFTER` の後にログへ書く中身。**名乗らない世界は `undefined`。** */
  readonly says?: string;
  /** 起動を待つ上限（秒）。 */
  readonly readyWait: string;
}

interface Result {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** `sleep` に渡された長さ（秒）。 */
  readonly sleeps: readonly number[];
  /** 走らせるのに掛かった時間（ミリ秒）。 */
  readonly took: number;
}

function startDevServer(world: World): Result {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-dev-server-'));
  try {
    // 間を置くのは本物の `sleep` で。**下の身代わりを通すと、待ち合わせの刻みと混ざって読めなくなる。**
    const npx = join(work, 'npx');
    writeFileSync(
      npx,
      `${STUB_SHEBANG}\n` +
        (world.says === undefined
          ? ':\n'
          : `"$(command -pv sleep)" ${SAYS_AFTER}\necho ${JSON.stringify(world.says)}\n`),
      'utf-8',
    );
    chmodSync(npx, 0o755);

    // 本物は `command -pv` で引く——PATHの先頭は自分なので、名前で引くと自分を呼び続ける。
    const sleep = join(work, 'sleep');
    writeFileSync(
      sleep,
      `${STUB_SHEBANG}\necho "$1" >> '${work}/sleep-calls'\nexec "$(command -pv sleep)" "$@"\n`,
      'utf-8',
    );
    chmodSync(sleep, 0o755);

    const log = join(work, 'server.log');
    const started = Date.now();
    const run = spawnScript(SCRIPT, ['5173', log, work], {
      stdio: 'pipe',
      env: {
        ...process.env,
        PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
        READY_WAIT: world.readyWait,
      },
    });
    const took = Date.now() - started;

    const calls = join(work, 'sleep-calls');
    return {
      code: run.status ?? -1,
      stdout: run.stdout,
      stderr: run.stderr,
      sleeps: run.status === null ? [] : readSleeps(calls),
      took,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function readSleeps(calls: string): readonly number[] {
  try {
    return readFileSync(calls, 'utf-8').split('\n').filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

describe('start-dev-server.sh', () => {
  // **名乗るまで待って、名乗ったら返す。** 刻みが1秒だと、`SAYS_AFTER` で名乗り終えている相手にも
  // 1秒を払う——画面を撮るたびに通る道なので、そのぶんがそのまま毎回の待ちになる。
  //
  // **見るのは寝た長さだけで、寝た回数は見ない。** 何回で名乗りに追いつくかは機械の速さで変わる。
  it('名乗るまで待って、名乗ったら0で返る', () => {
    const result = startDevServer({ says: 'ready in 42 ms', readyWait: '10' });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('起動確認OK: http://localhost:5173/');
    expect(Math.max(...result.sleeps)).toBeLessThan(1);
  });

  // **上限は秒で、刻みはそれより細かい。** 刻みの回数で数えていると、刻みを細かくしたぶんだけ上限が
  // 縮む。**下限で書く**——「これより速い」は遅い機械で落ちる。
  it('名乗らないまま上限まで来たら、諦めて非0で終わる', () => {
    const result = startDevServer({ readyWait: '1' });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('1秒待っても起動確認できませんでした');
    expect(result.took).toBeGreaterThanOrEqual(1000);
    expect(result.sleeps.length).toBeGreaterThan(1);
    expect(Math.max(...result.sleeps)).toBeLessThan(1);
  });
});
