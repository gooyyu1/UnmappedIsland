import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runScript } from '../support/runScript';
import { STUB_SHEBANG } from '../support/stubShebang';

/**
 * `scripts/agent/daemon.sh` の検査。
 *
 * 1周の中身（引く・決める・打つ）は [`board-round.mjs`](../../scripts/agent/board-round.mjs)
 * （検査は `boardRound.test.ts`）なので、ここが守るのは**回し続けること**——二本目を立てないこと・
 * 落ちた跡の錠を取り上げること・立てて確かめて止められること・引けない周を数えて諦めること。
 *
 * デーモンを一時ディレクトリへ写し、隣の `board-round.mjs` と `board-publish.mjs` を**走ったことだけを
 * 記録する身代わり**へ差し替える（`$HERE` は `BASH_SOURCE` から決まるので、写した先の隣が呼ばれる）。
 */

// 実プロセス（bash + node）を起こすため、`npm test` 全体を並行実行したときのCPU競合だけで
// 既定の5秒を超えうる。
vi.setConfig({ testTimeout: 20000 });

const AGENT = resolve(__dirname, '../../scripts/agent');

interface World {
  /** 1周が非0で終わるか（＝盤面を引けない周）。 */
  readonly roundFails?: boolean;
  /** 盤面の書き出しが非0で終わるか（＝issue へ書けない周）。 */
  readonly publishFails?: boolean;
  /** 錠の中に置いておく心拍。 */
  readonly heartbeat?: string;
  /** 周ごとに、`daemon.sh` を書き換える中身（`null` を置いた周は書き換えない）。 */
  readonly swap?: readonly (string | null)[];
  readonly env?: Record<string, string>;
  /** 最初に渡す引数。既定は `run`（前に出たまま回す）。 */
  readonly args?: readonly string[];
  /** 同じ世界へ続けて打つ引数。`start` したものを `stop` する、のように状態をまたぐものに使う。 */
  readonly then?: readonly (readonly string[])[];
}

interface Result {
  /** 最後の呼び出しの終了コード。 */
  readonly code: number;
  /** 呼び出しごとの出力。 */
  readonly logs: readonly string[];
  /** 全部の出力をつないだもの。 */
  readonly log: string;
  /** 回った周の数。 */
  readonly rounds: number;
  /** 盤面を書き出した回数。 */
  readonly publishes: number;
  /** 走る実体として置かれた複製の中身（置かれていなければ `undefined`）。 */
  readonly copy: string | undefined;
}

function daemon(world: World = {}): Result {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-daemon-'));
  try {
    const here = join(work, 'agent');
    mkdirSync(here);
    copyFileSync(join(AGENT, 'daemon.sh'), join(here, 'daemon.sh'));

    const rounds = join(work, 'rounds.txt');
    writeFileSync(rounds, '', 'utf-8');
    // 身代わりは、走ったことを記録するついでに**自分の呼び手を書き換えられる**——`SYNCED` で
    // `daemon.sh` が新しい版へ差し替わる瞬間は、走っている周の中から起きる。
    writeFileSync(
      join(here, 'board-round.mjs'),
      `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';\n` +
        `const rounds = ${JSON.stringify(rounds)};\n` +
        `appendFileSync(rounds, '1\\n');\n` +
        `const round = readFileSync(rounds, 'utf-8').split('\\n').filter(Boolean).length;\n` +
        `const swap = ${JSON.stringify(world.swap ?? [])}[round - 1];\n` +
        `if (typeof swap === 'string') writeFileSync(${JSON.stringify(join(here, 'daemon.sh'))}, swap, 'utf-8');\n` +
        `process.exit(${world.roundFails === true ? 1 : 0});\n`,
      'utf-8',
    );

    // 書き出しの身代わり。**周の数とは別に数える**——書くのは周ごとではなく、間隔が満ちたときだけ。
    const publishes = join(work, 'publishes.txt');
    writeFileSync(publishes, '', 'utf-8');
    writeFileSync(
      join(here, 'board-publish.mjs'),
      `import { appendFileSync } from 'node:fs';\n` +
        `appendFileSync(${JSON.stringify(publishes)}, '1\\n');\n` +
        `process.exit(${world.publishFails === true ? 1 : 0});\n`,
      'utf-8',
    );

    const state = join(work, 'state');
    mkdirSync(state);
    // 心拍を渡す＝**誰かが握ったまま**の状態を作る。錠は錠で要る（心拍は錠の外にあるので、
    // 置いただけでは二本目が素通りしてしまう）。PIDは置かない——落ちた跡と同じ形。
    if (world.heartbeat !== undefined) {
      mkdirSync(join(state, 'lock'));
      writeFileSync(join(state, 'heartbeat'), world.heartbeat, 'utf-8');
    }

    let code = 0;
    const logs: string[] = [];
    for (const args of [world.args ?? ['run'], ...(world.then ?? [])]) {
      code = 0;
      try {
        logs.push(
          runScript(join(here, 'daemon.sh'), args, {
            stdio: 'pipe',
            // **回り続ける相手は、待たずに撃つ。** 起こし方が同期なので、止まらない版に当たると
            // `vitest` の制限時間では止められず、試験が赤くならずに固まる。
            timeout: 15000,
            env: {
              ...process.env,
              BOARD_STATE: state,
              // **既定は `~/daemon.log`。** 指さないと、`start` の試験が本物のログへ書き足す。
              DAEMON_LOG: join(work, 'daemon.log'),
              ONCE: '1',
              ...world.env,
            },
          }),
        );
      } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };
        code = failure.status ?? -1;
        logs.push(`${failure.stdout ?? ''}${failure.stderr ?? ''}`);
      }
    }

    const copy = join(state, 'daemon-running.sh');

    return {
      code,
      logs,
      log: logs.join(''),
      rounds: readFileSync(rounds, 'utf-8').split('\n').filter(Boolean).length,
      publishes: readFileSync(publishes, 'utf-8').split('\n').filter(Boolean).length,
      copy: existsSync(copy) ? readFileSync(copy, 'utf-8') : undefined,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

describe('daemon.sh', () => {
  it('回すと、1周ぶん回る', () => {
    const result = daemon();

    expect(result.code).toBe(0);
    expect(result.rounds).toBe(1);
  });

  // **走行中のファイルが書き換わると、bash が次に読む位置は別の中身を指す。** リポジトリの1本を
  // 直に読ませず、複製から走る。
  it('走るのは複製で、リポジトリの1本ではない', () => {
    const result = daemon();

    expect(result.copy).toBe(readFileSync(join(AGENT, 'daemon.sh'), 'utf-8'));
  });

  // 起こす側に「もう走っているか」を確かめさせない（`pgrep` はブリッジの bash に無い）。
  it('心拍が新しければ、二本目は何もせずに終わる', () => {
    const result = daemon({ heartbeat: now() });

    expect(result.code).toBe(0);
    expect(result.rounds).toBe(0);
    expect(result.log).toContain('既に走っている');
  });

  it('心拍が途切れていれば、落ちた跡の錠を取り上げる', () => {
    const result = daemon({ heartbeat: '2020-01-01T00:00:00Z' });

    expect(result.log).toContain('錠を取り上げる');
    expect(result.rounds).toBe(1);
  });

  // 引けなかった周は盤面が欠けているので、手を決めない（`board-round.mjs`）。ここが数えるのは、
  // それが続いたかどうかだけ。
  it('引けなかった周を数える', () => {
    const result = daemon({ roundFails: true });

    expect(result.code).toBe(0);
    expect(result.log).toContain('盤面を引けなかった（1回目）');
  });

  // **止まらない。** いちばん多い理由（アクセストークンの期限切れ）を直すのは Claude Code 本体で、
  // こちらにできるのは直るまで待つことだけ。止めると、直っても誰かが立て直すまで盤面が動かない。
  it('続けて引けなければ、間隔を落として回り続ける', () => {
    const result = daemon({ roundFails: true, env: { FAILURE_LIMIT: '1', RETRY_INTERVAL: '300' } });

    expect(result.code).toBe(0);
    expect(result.log).toContain('1回続けて失敗したので、300秒おきへ落とす');
  });

  it('status は、一度も起きていなければ非0', () => {
    const result = daemon({ args: ['status'] });

    expect(result.code).toBe(1);
    expect(result.log).toContain('一度も起きていない');
  });

  it('status は、心拍が新しければ0', () => {
    const result = daemon({ args: ['status'], heartbeat: now() });

    expect(result.code).toBe(0);
    expect(result.log).toContain('生きている');
  });

  // **何をするかを書かせる。** 引数なしで回り出すと、`status` のつもりで打った1本が背景の
  // デーモンと同じ錠を取り合う。
  it('知らない語では、使い方を出して非0で終わる', () => {
    const result = daemon({ args: [] });

    expect(result.code).toBe(1);
    expect(result.log).toContain('使い方');
    expect(result.rounds).toBe(0);
  });

  it('stop は、走っていなければそう言って0で終わる', () => {
    const result = daemon({ args: ['stop'] });

    expect(result.code).toBe(0);
    expect(result.log).toContain('走っていない');
  });

  // 撃つ相手が居ない錠を待っても、永久に外れない。**落ちた跡はここで片付ける。**
  it('stop は、落ちた跡の錠を外す', () => {
    const result = daemon({
      args: ['stop'],
      then: [['status']],
      heartbeat: '2020-01-01T00:00:00Z',
    });

    expect(result.logs[0]).toContain('落ちた跡の錠を外した');
    // 心拍は錠の外なので、**最後にいつ回っていたかは残る。**
    expect(result.logs[1]).toContain('止まっている（最終 2020-01-01T00:00:00Z）');
  });

  // **ここが、この道具の眼目。** 呼び手が `ps` で相手を探さずに、立てて・確かめて・止められる。
  //
  // **`INTERVAL` を `STOP_WAIT` より充分に長く採る。** 逆だと、寝方を壊して（`sleep` を前に置いて）
  // も寝終わったところで止まるので、**撃たれてすぐ畳むことを確かめられない。**
  it('start で立てて、status で見えて、stop で止まる', () => {
    const result = daemon({
      args: ['start'],
      then: [['status'], ['stop'], ['status']],
      // `ONCE` を空にして回り続けさせる。撃たれるまで止まらない相手でないと、止める試験にならない。
      env: { ONCE: '', INTERVAL: '120', START_WAIT: '30', STOP_WAIT: '10' },
    });

    expect(result.logs[0]).toContain('立てた');
    expect(result.logs[1]).toContain('生きている');
    expect(result.logs[2]).toContain('止めた');
    expect(result.logs[3]).toContain('止まっている');
    expect(result.code).toBe(1);
  });

  // **回っている bash は、最初に読んだ版のまま。** 隣の道具は毎周読み直されるので、`SYNCED` で版が
  // 食い違うのはこの1本だけ——古い呼び手が新しい道具を叩き、手を1つも出さない周が続いた
  // （2026-09-05）。
  it('自分の版が入れ替わったら、新しい版で回り直す', () => {
    const real = readFileSync(join(AGENT, 'daemon.sh'), 'utf-8');
    const result = daemon({
      // `ONCE` を空にして周をまたがせる。入れ替わってなお回り続けることが見たいので、1周では足りない。
      env: { ONCE: '', INTERVAL: '1' },
      swap: [
        // 1周目は書き換えない。**変わっていない周で入れ替わらないこと**も、ここで見る。
        null,
        `${real}\n# 入れ替えた版\n`,
        // 立ったことを1行残して終わる版。これで回るのが止まるので、撃たずに済む。
        `${STUB_SHEBANG}\necho "入れ替わった先が立った"\n`,
      ],
    });

    expect(result.code).toBe(0);
    expect(result.rounds).toBe(3);
    expect(result.log.match(/新しい版で回り直す/g)).toHaveLength(2);
    // **錠は外さずに渡す。** 引き継げなければ、入れ替わった先は二本目として引き返してしまう
    // （＝3周目が回らない）。
    expect(result.log).not.toContain('既に走っている');
    expect(result.log).toContain('入れ替わった先が立った');
  });

  // 盤面を読む先はスマホなので、周（既定30秒）と同じ速さで書き換えても読み切れない
  // （`.claude/board-design.md` 2.20）。**間隔が満ちるまでは叩かない。**
  it('盤面の書き出しは、間隔が満ちたときだけ', () => {
    const result = daemon({ args: ['run'], then: [['run']], env: { PUBLISH_INTERVAL: '3600' } });

    expect(result.rounds).toBe(2);
    expect(result.publishes).toBe(1);
  });

  // **書けなくても周は止めない**（2.20.2）。古くなるのは読む先だけで、打つ手には関わらない。
  it('盤面を書き出せなくても、周は続く', () => {
    const result = daemon({ publishFails: true });

    expect(result.code).toBe(0);
    expect(result.rounds).toBe(1);
    expect(result.log).toContain('盤面を書き出せなかった');
  });

  // **叩いた時刻は成否によらず控える**（2.20.2）。失敗のたびに次の周で叩き直すと、GitHubが沈んで
  // いる間じゅう周と同じ速さで打ち続けることになる。
  it('書き出せなかった周も、次の周期までは叩き直さない', () => {
    const result = daemon({
      publishFails: true,
      args: ['run'],
      then: [['run']],
      env: { PUBLISH_INTERVAL: '3600' },
    });

    expect(result.rounds).toBe(2);
    expect(result.publishes).toBe(1);
  });

  // 引けなかった周は一覧そのものが無い（`board-round.mjs` が置く前に落ちる）。**前の周の写しへ
  // 新しい時刻を貼らない**——読む人は、動いていないことを最終更新の時刻で読む。
  it('盤面を引けなかった周は、書き出さない', () => {
    const result = daemon({ roundFails: true });

    expect(result.rounds).toBe(1);
    expect(result.publishes).toBe(0);
  });

  it('restart は、走っているものを入れ替える', () => {
    const result = daemon({
      args: ['start'],
      then: [['restart'], ['stop']],
      env: { ONCE: '', INTERVAL: '120', START_WAIT: '30', STOP_WAIT: '10' },
    });

    expect(result.logs[1]).toContain('止めた');
    expect(result.logs[1]).toContain('立てた');
    expect(result.logs[2]).toContain('止めた');
  });
});
