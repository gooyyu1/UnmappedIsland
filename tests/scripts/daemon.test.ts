import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * `scripts/agent/daemon.sh` の検査。
 *
 * 手を決めるのは [`board-move.mjs`](../../scripts/agent/board-move.mjs)（検査は `boardMove.test.ts`）
 * なので、ここが守るのは**引くことと打つこと**——盤面を組み立てられること・1周に1手しか打たないこと・
 * 打てなかった手で周ごと止まらないこと・台帳が育っても回り続けること。
 *
 * デーモンを一時ディレクトリへ写し、隣に置く道具を全部差し替える（`$HERE` は `BASH_SOURCE` から
 * 決まるので、写した先の隣が呼ばれる）。`gh` は PATH の先頭で差し替える。
 */

// 実プロセス（bash + node）を起こすため、`npm test` 全体を並行実行したときのCPU競合だけで
// 既定の5秒を超えうる。
vi.setConfig({ testTimeout: 20000 });

const AGENT = resolve(__dirname, '../../scripts/agent');

/** 打つ側の道具。全部、呼ばれたことだけを記録する。 */
const PLAYS = ['merge-and-close.sh', 'dispatch-review.sh', 'dispatch-task.sh', 'resume-session.sh'];

interface World {
  readonly prs?: readonly unknown[];
  readonly issues?: readonly unknown[];
  /** `live-sessions.sh` が返す `ID<TAB>session_status<TAB>bucket<TAB>tags` の行。 */
  readonly sessions?: readonly string[];
  readonly ledger?: Record<string, string>;
  /** 非0で終わらせる打ち手（`PLAYS` の名前）。 */
  readonly fails?: readonly string[];
  readonly ghFails?: boolean;
  /** 錠の中に置いておく心拍。 */
  readonly heartbeat?: string;
  readonly env?: Record<string, string>;
  readonly args?: readonly string[];
}

interface Result {
  readonly code: number;
  readonly log: string;
  readonly calls: readonly string[];
  readonly ledger: Record<string, string>;
}

function daemon(world: World = {}): Result {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-daemon-'));
  const posix = (path: string) => path.replace(/\\/g, '/');
  try {
    const here = join(work, 'agent');
    mkdirSync(here);
    copyFileSync(join(AGENT, 'daemon.sh'), join(here, 'daemon.sh'));
    copyFileSync(join(AGENT, 'board-move.mjs'), join(here, 'board-move.mjs'));

    const stub = (name: string, body: string) => {
      const path = join(here, name);
      writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`, 'utf-8');
      chmodSync(path, 0o755);
    };

    const calls = join(work, 'calls.txt');
    writeFileSync(calls, '', 'utf-8');
    for (const name of PLAYS) {
      const code = (world.fails ?? []).includes(name) ? 1 : 0;
      stub(name, `echo "${name} $*" >>'${posix(calls)}'\nexit ${code}`);
    }
    stub('usage-record.sh', ':');
    stub('live-sessions.sh', `cat <<'TSV'\n${(world.sessions ?? []).join('\n')}\nTSV`);

    writeFileSync(join(work, 'prs.json'), JSON.stringify(world.prs ?? []), 'utf-8');
    writeFileSync(join(work, 'issues.json'), JSON.stringify(world.issues ?? []), 'utf-8');
    const gh = join(work, 'gh');
    writeFileSync(
      gh,
      `#!/usr/bin/env bash
${world.ghFails === true ? 'exit 1' : ''}
case "$1" in
pr) cat '${posix(join(work, 'prs.json'))}' ;;
issue) cat '${posix(join(work, 'issues.json'))}' ;;
*) exit 1 ;;
esac
`,
      'utf-8',
    );
    chmodSync(gh, 0o755);

    const state = join(work, 'state');
    mkdirSync(state);
    if (world.ledger !== undefined) {
      writeFileSync(join(state, 'taken.json'), JSON.stringify(world.ledger), 'utf-8');
    }
    if (world.heartbeat !== undefined) {
      mkdirSync(join(state, 'lock'));
      writeFileSync(join(state, 'lock', 'heartbeat'), world.heartbeat, 'utf-8');
    }

    let code = 0;
    let log = '';
    try {
      log = execFileSync('bash', [join(here, 'daemon.sh'), ...(world.args ?? [])], {
        encoding: 'utf-8',
        stdio: 'pipe',
        env: {
          ...process.env,
          PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
          BOARD_STATE: state,
          ONCE: '1',
          ...world.env,
        },
      });
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      code = failure.status ?? -1;
      log = failure.stdout ?? '';
    }

    const ledgerPath = join(state, 'taken.json');
    return {
      code,
      log,
      calls: readFileSync(calls, 'utf-8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
      ledger: JSON.parse(readFileSync(ledgerPath, 'utf-8')),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** 緑のPR。本文の `Closes` は、直しの相手を引くのに使われる。 */
function pr(number: number, over: Record<string, unknown> = {}) {
  return {
    number,
    isDraft: false,
    labels: [],
    mergeable: 'MERGEABLE',
    statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    updatedAt: '2026-01-01T00:00:00Z',
    headRefOid: 'aaa111',
    body: `Closes #${number - 1}\n`,
    ...over,
  };
}

const passed = { labels: [{ name: '通してよい' }] };
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

describe('daemon.sh', () => {
  it('打つのは1周に1手だけ', () => {
    const result = daemon({ prs: [pr(10, passed), pr(20, passed)] });

    expect(result.calls).toEqual(['merge-and-close.sh 10']);
  });

  // 打てなかった手で周ごと止めると、止まっている種類と関係のない手まで巻き添えになる。
  it('打てなかった手の次へ進む', () => {
    const result = daemon({ prs: [pr(10, passed), pr(20)], fails: ['merge-and-close.sh'] });

    expect(result.calls).toEqual(['merge-and-close.sh 10', 'dispatch-review.sh 20']);
  });

  it('打った手は、そのときの指紋とともに台帳へ残る', () => {
    const result = daemon({ prs: [pr(10)] });

    expect(result.calls).toEqual(['dispatch-review.sh 10']);
    expect(result.ledger).toEqual({ 'review:10': 'aaa111' });
  });

  // 台帳が空でなくなった最初の周で刈り込みの jq が落ち、`FAILURE_LIMIT` でデーモンが死んでいた。
  it('台帳に記録が入っていても、盤面を引ける', () => {
    const result = daemon({
      prs: [pr(10)],
      sessions: ['session_a\tSESSION_STATUS_RUNNING\tSESSION_STATUS_BUCKET_WORKING\ttask-9'],
      ledger: { 'review:10': 'aaa111', 'review:99': 'zzz999', 'resume:session_gone': 'stall:5' },
    });

    expect(result.log).not.toContain('盤面を引けなかった');
    // 消えたPRと畳まれたセッションの記録は捨てる。残すと、番号が回り込んだときに古い指紋が効く。
    expect(result.ledger).toEqual({ 'review:10': 'aaa111' });
  });

  // デーモンは起動時の `daemon.sh` を握ったまま回るので、走っている最中に `live-sessions.sh` の
  // 列を足すと、こちらだけが古いまま噛み合う。黙って読み違えると `tags` が空になり、**占有が全部
  // 「無い」に見えて投入が止まらない**——2026-09-05 に、書くセッションが6本立った。
  it('セッションの列がずれていたら、引けなかったのと同じに扱う', () => {
    const result = daemon({
      prs: [pr(10, passed)],
      sessions: ['session_a\tSESSION_STATUS_BUCKET_WORKING\ttask-9'],
    });

    expect(result.calls).toEqual([]);
    expect(result.log).toContain('盤面を引けなかった');
  });

  it('盤面を引けなかった周は、手を1つも打たない', () => {
    const result = daemon({ prs: [pr(10, passed)], ghFails: true });

    expect(result.calls).toEqual([]);
    expect(result.log).toContain('盤面を引けなかった');
  });

  it('DRY_RUN では、手を並べるだけで打たない', () => {
    const result = daemon({ prs: [pr(10, passed)], env: { DRY_RUN: '1' } });

    expect(result.calls).toEqual([]);
    expect(result.log).toContain('打たない手: MERGE 10');
  });

  // 起こす側に「もう走っているか」を確かめさせない（`pgrep` はブリッジの bash に無い）。
  it('心拍が新しければ、二本目は何もせずに終わる', () => {
    const result = daemon({ prs: [pr(10, passed)], heartbeat: now() });

    expect(result.code).toBe(0);
    expect(result.calls).toEqual([]);
    expect(result.log).toContain('既に走っている');
  });

  it('心拍が途切れていれば、落ちた跡の錠を取り上げる', () => {
    const result = daemon({ prs: [pr(10, passed)], heartbeat: '2020-01-01T00:00:00Z' });

    expect(result.log).toContain('錠を取り上げる');
    expect(result.calls).toEqual(['merge-and-close.sh 10']);
  });

  it('--status は、一度も起きていなければ非0', () => {
    const result = daemon({ args: ['--status'] });

    expect(result.code).toBe(1);
    expect(result.log).toContain('一度も起きていない');
  });

  it('--status は、心拍が新しければ0', () => {
    const result = daemon({ args: ['--status'], heartbeat: now() });

    expect(result.code).toBe(0);
    expect(result.log).toContain('生きている');
  });
});
