import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * `scripts/agent/daemon.sh` の検査。
 *
 * 1周の中身（引く・決める・打つ）は [`board-round.mjs`](../../scripts/agent/board-round.mjs)
 * （検査は `boardRound.test.ts`）なので、ここが守るのは**回し続けること**——二本目を立てないこと・
 * 落ちた跡の錠を取り上げること・立てて確かめて止められること・引けない周を数えて諦めること。
 *
 * デーモンを一時ディレクトリへ写し、隣の `board-round.mjs` を**走ったことだけを記録する身代わり**へ
 * 差し替える（`$HERE` は `BASH_SOURCE` から決まるので、写した先の隣が呼ばれる）。
 */

// 実プロセス（bash + node）を起こすため、`npm test` 全体を並行実行したときのCPU競合だけで
// 既定の5秒を超えうる。
vi.setConfig({ testTimeout: 20000 });

const AGENT = resolve(__dirname, '../../scripts/agent');

interface World {
  /** 1周が非0で終わるか（＝盤面を引けない周）。 */
  readonly roundFails?: boolean;
  /** 錠の中に置いておく心拍。 */
  readonly heartbeat?: string;
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
}

function daemon(world: World = {}): Result {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-daemon-'));
  try {
    const here = join(work, 'agent');
    mkdirSync(here);
    copyFileSync(join(AGENT, 'daemon.sh'), join(here, 'daemon.sh'));

    const rounds = join(work, 'rounds.txt');
    writeFileSync(rounds, '', 'utf-8');
    writeFileSync(
      join(here, 'board-round.mjs'),
      `import { appendFileSync } from 'node:fs';\n` +
        `appendFileSync(${JSON.stringify(rounds)}, '1\\n');\n` +
        `process.exit(${world.roundFails === true ? 1 : 0});\n`,
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
          execFileSync('bash', [join(here, 'daemon.sh'), ...args], {
            encoding: 'utf-8',
            stdio: 'pipe',
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

    return {
      code,
      logs,
      log: logs.join(''),
      rounds: readFileSync(rounds, 'utf-8').split('\n').filter(Boolean).length,
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

  // 認証切れや通信断で回り続けても、ログが埋まるだけ。
  it('続けて引けなければ、諦めて止まる', () => {
    const result = daemon({ roundFails: true, env: { ONCE: '', FAILURE_LIMIT: '1' } });

    expect(result.code).toBe(1);
    expect(result.log).toContain('1回続けて失敗したので止まる');
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
