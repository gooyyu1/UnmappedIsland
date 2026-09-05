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

import { STUB_SHEBANG } from '../support/stubShebang';

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
  /** `gh issue view <番号> --json state` が返す `state`。挙がっていない番号は引けない。 */
  readonly issueStates?: Record<number, string>;
  /** PRごとの、コミットの `Claude-Session:` トレーラが指すセッション。 */
  readonly prSessions?: Record<number, string>;
  /** そのトレーラを引く `gh api graphql` が失敗するか。 */
  readonly prSessionsFail?: boolean;
  /** `main` の先頭のCI。既定は緑。 */
  readonly mainChecks?: readonly { readonly status: string; readonly conclusion: string }[];
  /** `archive-session.sh` が渡された相手について返す行の頭。既定は畳めた。 */
  readonly archiveVerdict?: 'ARCHIVED' | 'KEPT' | 'UNARCHIVED';
  /** 非0で終わらせる打ち手（`PLAYS` の名前）。 */
  readonly fails?: readonly string[];
  readonly ghFails?: boolean;
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
  readonly calls: readonly string[];
  /** `gh` に渡された引数。閉じた issue を引きに行った回数を見るのに使う。 */
  readonly gh: readonly string[];
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
      writeFileSync(path, `${STUB_SHEBANG}\n${body}\n`, 'utf-8');
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
    // 畳んでよいかの判定は持たない（それは `archive-session.sh` の仕事）。渡された相手について、
    // 決めた行を1本返すだけ。
    stub(
      'archive-session.sh',
      `echo "archive-session.sh $*" >>'${posix(calls)}'\nread -r id\necho "${world.archiveVerdict ?? 'ARCHIVED'} $id"`,
    );

    writeFileSync(join(work, 'prs.json'), JSON.stringify(world.prs ?? []), 'utf-8');
    writeFileSync(join(work, 'issues.json'), JSON.stringify(world.issues ?? []), 'utf-8');
    const ghCalls = join(work, 'gh-calls.txt');
    writeFileSync(ghCalls, '', 'utf-8');
    const gh = join(work, 'gh');
    writeFileSync(
      gh,
      `${STUB_SHEBANG}
echo "$*" >>'${posix(ghCalls)}'
${world.ghFails === true ? 'exit 1' : ''}
case "$1 $2" in
'issue view')
  case "$3" in
${Object.entries(world.issueStates ?? {})
  .map(([number, state]) => `    ${number}) printf '%s' '${state}' ;;`)
  .join('\n')}
    *) exit 1 ;;
  esac
  ;;
'api graphql')
${world.prSessionsFail === true ? '  exit 1' : ''}
${Object.entries(world.prSessions ?? {})
  .map(([number, session]) => `  printf '%s\\t%s\\n' '${number}' '${session}'`)
  .join('\n')}
  ;;
'api '*check-runs)
  printf '%s' '${JSON.stringify(world.mainChecks ?? [{ status: 'COMPLETED', conclusion: 'SUCCESS' }])}'
  ;;
'pr list') cat '${posix(join(work, 'prs.json'))}' ;;
'issue list') cat '${posix(join(work, 'issues.json'))}' ;;
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
              PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
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

    const ledgerPath = join(state, 'taken.json');
    return {
      code,
      logs,
      log: logs.join(''),
      calls: readFileSync(calls, 'utf-8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
      gh: readFileSync(ghCalls, 'utf-8')
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

  // 畳む条件は担当の issue が閉じたこと（2.10）。**PRがマージされたかでは決めない**ので、PRが
  // 1本も無くても畳む。
  it('担当の issue が閉じたワーカーを畳む', () => {
    const result = daemon({
      sessions: ['session_a\tSESSION_STATUS_IDLE\tSESSION_STATUS_BUCKET_WORKING\ttask-8'],
      issueStates: { 8: 'CLOSED' },
    });

    expect(result.calls).toEqual(['archive-session.sh --keep-untagged task-,review-']);
    expect(result.log).toContain('ARCHIVED session_a');
    // 畳めたので、台帳へは残さない（相手も次の周には消える）。
    expect(result.ledger).toEqual({});
  });

  // `KEPT` は「畳んではいけない」という安定した答え。残さないと、1周1手のうちの1手がこれで埋まり続ける。
  it('畳めない相手だと分かったら、指紋を残して次の周は打たない', () => {
    const result = daemon({
      sessions: ['session_a\tSESSION_STATUS_IDLE\tSESSION_STATUS_BUCKET_WORKING\ttask-8'],
      issueStates: { 8: 'CLOSED' },
      archiveVerdict: 'KEPT',
    });

    expect(result.log).toContain('KEPT session_a');
    expect(result.ledger).toEqual({ 'archive:session_a': 'closed:8' });
  });

  // 失敗は答えではないので、次の周にもう一度試す。
  it('畳もうとして失敗したら、指紋を残さない', () => {
    const result = daemon({
      sessions: ['session_a\tSESSION_STATUS_IDLE\tSESSION_STATUS_BUCKET_WORKING\ttask-8'],
      issueStates: { 8: 'CLOSED' },
      archiveVerdict: 'UNARCHIVED',
    });

    expect(result.calls).toEqual(['archive-session.sh --keep-untagged task-,review-']);
    expect(result.ledger).toEqual({});
  });

  // 探すのはワーカーの側から（2.10）。開いている一覧に載っているぶんは既に盤面が持っているので、
  // 引き直さない。
  it('開いている issue を担当しているワーカーのぶんは、issue を引き直さない', () => {
    const result = daemon({
      issues: [{ number: 8, labels: [{ name: 'task' }], blockedBy: { nodes: [] } }],
      sessions: ['session_a\tSESSION_STATUS_RUNNING\tSESSION_STATUS_BUCKET_WORKING\ttask-8'],
    });

    expect(result.gh.filter((call) => call.startsWith('issue view'))).toEqual([]);
  });

  // 差し戻す相手はコミットのトレーラで引く（2.11）。`task-` のタグではない——`Closes` は
  // どの issue が閉じるかの印であって、誰が書いたかを指していない。
  it('差し戻す相手を、コミットのトレーラが指すセッションから引く', () => {
    const result = daemon({
      prs: [pr(10, { statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] })],
      prSessions: { 10: 'session_writer' },
      sessions: [
        'session_writer\tSESSION_STATUS_IDLE\tSESSION_STATUS_BUCKET_WORKING\t',
        'session_holder\tSESSION_STATUS_IDLE\tSESSION_STATUS_BUCKET_WORKING\ttask-9',
      ],
    });

    expect(result.calls).toEqual(['resume-session.sh session_writer mend 10']);
  });

  // `main` の色が盤面へ載っていなければ、判定の側は緑と読んで差し戻してしまう（2.14）。
  // **止まることを見るのは、載っていることを見ること。**
  it('main が赤い周は、直しの手を打たない', () => {
    const result = daemon({
      mainChecks: [{ status: 'COMPLETED', conclusion: 'FAILURE' }],
      prs: [pr(10, { statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] })],
      prSessions: { 10: 'session_writer' },
      sessions: ['session_writer\tSESSION_STATUS_IDLE\tSESSION_STATUS_BUCKET_WORKING\t'],
    });

    expect(result.calls).toEqual([]);
  });

  // 引けない日に盤面ごと落とすと、差し戻し以外の手まで止まる。
  it('トレーラを引けなかった周も、他の手は打つ', () => {
    const result = daemon({ prs: [pr(10, passed)], prSessionsFail: true });

    expect(result.log).not.toContain('盤面を引けなかった');
    expect(result.calls).toEqual(['merge-and-close.sh 10']);
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
    expect(result.calls).toEqual([]);
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
