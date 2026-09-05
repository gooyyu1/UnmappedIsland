import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { STUB_SHEBANG } from '../support/stubShebang';

/**
 * `scripts/agent/dispatch-task.sh` の**投入する前の関門**の検査。
 *
 * ここが守るのは**同じ仕事へ2本立てないこと**。生きているセッションは
 * [`may-dispatch.sh`](../../scripts/agent/may-dispatch.sh) が塞ぐが、畳まれた後にPRだけ残っている
 * 場合はそこを素通りする（#1415 は同じ issue が2本へ渡り、push の瞬間まで誰も気づかなかった）。
 *
 * `DRY_RUN=1` で叩くので、セッションは立たない——関門は全部その手前にある。`gh` は PATH の先頭で
 * 差し替え、環境IDは `ccr-env.sh` へ環境変数で渡す。
 */

// 実プロセス（bash + node + gh のスタブ）を起こすため、`npm test` 全体を並行実行したときのCPU競合
// だけで既定の5秒を超えうる。
vi.setConfig({ testTimeout: 20000 });

const SCRIPT = resolve(__dirname, '../../scripts/agent/dispatch-task.sh');

interface World {
  /** issue の `state`。既定は開いている。 */
  readonly state?: string;
  /** issue の本文。 */
  readonly body?: string;
  /** issue に付いているラベル。 */
  readonly labels?: readonly string[];
  /** 開いているPR。 */
  readonly prs?: readonly { number: number; body: string }[];
  /** `--bridge` を付けて叩くか。 */
  readonly onBridge?: boolean;
}

interface Run {
  readonly code: number;
  readonly stderr: string;
  /** `DRY_RUN` が出した `create_session` の引数。関門で止まった回は空。 */
  readonly stdout: string;
}

function run(issue: number, world: World = {}): Run {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-dispatch-task-'));
  const dir = work.replace(/\\/g, '/');
  try {
    writeFileSync(
      join(work, 'issue.json'),
      JSON.stringify({
        title: '題',
        state: world.state ?? 'OPEN',
        body: world.body ?? '## 担当\n\nsrc/x.ts\n',
        labels: (world.labels ?? ['task']).map((name) => ({ name })),
      }),
      'utf-8',
    );
    writeFileSync(join(work, 'prs.json'), JSON.stringify(world.prs ?? []), 'utf-8');
    writeFileSync(join(work, 'supplement.md'), '', 'utf-8');

    const gh = join(work, 'gh');
    writeFileSync(
      gh,
      `${STUB_SHEBANG}
case "$1 $2" in
  "repo view") printf '%s' 'gooyyu1/UnmappedIsland' ;;
  "issue view") cat '${dir}/issue.json' ;;
  "pr list") cat '${dir}/prs.json' ;;
  *) exit 1 ;;
esac
`,
      'utf-8',
    );
    chmodSync(gh, 0o755);

    try {
      const where = world.onBridge === true ? ['--bridge'] : [];
      const stdout = execFileSync('bash', [SCRIPT, String(issue), join(work, 'supplement.md'), ...where], {
        encoding: 'utf-8',
        stdio: 'pipe',
        env: {
          ...process.env,
          PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
          // 本文まで見るので切らせない（`dispatch-task.sh` の `DRY_RUN=full`）。
          DRY_RUN: 'full',
          CLOUD_ENV: 'env_TEST_CLOUD',
          BRIDGE_ENV: 'env_TEST_BRIDGE',
        },
      });
      return { code: 0, stderr: '', stdout };
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      return { code: failure.status ?? -1, stderr: failure.stderr ?? '', stdout: '' };
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** 組み立てて渡す指示の本文。 */
function prompt(issue: number, world: World = {}): string {
  const result = run(issue, world);
  expect(result.code).toBe(0);
  return (JSON.parse(result.stdout) as { prompt: string }).prompt;
}

describe('dispatch-task.sh', () => {
  it('関門をどれも踏まなければ、渡す引数まで組み立てる', () => {
    const result = run(1415);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('その issue を閉じるPRが既に開いていれば、投入しない', () => {
    const result = run(1415, { prs: [{ number: 1500, body: 'Closes #1415\n' }] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('PR #1500');
  });

  // 番号の前方一致で止めると、#1415 の投入が #14150 のPRに塞がれる。
  it('番号が前方一致するだけのPRでは止まらない', () => {
    expect(run(1415, { prs: [{ number: 1500, body: 'Closes #14150\n' }] }).code).toBe(0);
  });

  // 番号だけの参照（`#1415`）では issue が閉じないので、投入を塞ぐ根拠にもしない。
  it('番号だけの参照を持つPRでは止まらない', () => {
    expect(run(1415, { prs: [{ number: 1500, body: '#1415 に関係する\n' }] }).code).toBe(0);
  });

  it('閉じた issue へは投入しない', () => {
    expect(run(1415, { state: 'CLOSED' }).code).toBe(1);
  });

  // 返された issue は `task` が付いたまま残る（`.claude/board-design.md` 2.15.2）ので、**ここで
  // 見なければ次の周にそのまま投入し直される。** 不変条件を持つのは投入する側（1.4）。
  it('人へ返された issue へは投入しない', () => {
    const result = run(1376, { labels: ['task', '判断待ち'] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('判断待ち');
  });

  // 盤面の道具そのものを直す仕事は、担当がここにしか無い。**止まる理由（書き込みのたびの承認）は
  // クラウドにしか無い**ので、関門もクラウドへ投入するときだけ見る。
  it('クラウドへは、担当にユーザーの領域が挙がっていれば投入しない', () => {
    const result = run(1551, { body: '## 担当\n\n- `.claude/ccr-meta.sh`\n' });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('.claude/ccr-meta.sh');
  });

  it('ブリッジへなら、同じ担当でも投入する', () => {
    expect(run(1551, { body: '## 担当\n\n- `.claude/ccr-meta.sh`\n', onBridge: true }).code).toBe(0);
  });

  // **受け取る側は、自分がどちらで走っているかを知らない。** 本体へ無条件に書くと、当たらない
  // ほうのセッションにもそのまま渡り、`.claude/**` を直すために立てたブリッジのセッションが
  // 着手した時点で仕事をせずに返す（PR #1567 のレビュー指摘）。
  it('クラウドへは、ユーザーの領域を触らずブリッジへ回せと渡す', () => {
    const body = prompt(1415);

    expect(body).toContain('[ブリッジ]');
    expect(body).not.toContain('ユーザーのPCで走っています');
  });

  it('ブリッジへは、担当に挙がっていれば書き換えてよいと渡す', () => {
    const body = prompt(1415, { onBridge: true });

    expect(body).toContain('ユーザーのPCで走っています');
    expect(body).not.toContain('[ブリッジ]');
  });

  // 差し替えそのものが落ちたときは、目印の行が本文に残る。**渡す相手には読めない行**なので、
  // 落ちたことがここで分かるようにする。
  it('走る場所の目印は、本文に残さない', () => {
    expect(prompt(1415)).not.toContain('<走る場所で変わる制約');
  });
});
