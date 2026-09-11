import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runScript } from '../support/runScript';
import { STUB_SHEBANG } from '../support/stubShebang';

/**
 * `scripts/agent/dispatch-steps.sh` の `dispatch_session` が、**関門の終了コードをそのまま呼び手の
 * 終了コードにする**ことの検査（`.claude/board-design.md` 2.21）。
 *
 * **人が手綱で止めている周（3）と、それ以外で転んだ周（1）を、盤面が見分けられなくなると、
 * 手綱を引いているあいだじゅう「詰まっている」と読んで係を立て続ける。** 関門を抜けたところに
 * `if` が1つ挟まるだけで潰れる区別なので、**投入するスクリプトを実際に走らせて**見る。
 *
 * `gh` は PATH の先頭で差し替え、セッションの一覧はこの周のぶんの写しを渡す
 * （[`live-sessions.mjs`](../../scripts/agent/live-sessions.mjs)）。**写しに同じタグの1本を置くのは
 * 安全のため**——関門が壊れて手綱を素通りしても、占有が止めるので本物のセッションは立たない。
 */

// 実プロセス（bash + node + gh のスタブ）を起こすため、`npm test` 全体を並行実行したときのCPU競合
// だけで既定の5秒を超えうる。
vi.setConfig({ testTimeout: 20000 });

const SCRIPT = resolve(__dirname, '../../scripts/agent/dispatch-chore.sh');

/** 手綱の issue の番号。実物の番号は試験に書き写さない。 */
const BRAKE_ISSUE = '9999';

const brakeBody = (other: string) =>
  [
    '## 手綱',
    '',
    '- [x] 投入する（これを外すと下は全部止まる）',
    '  - [x] 新しいタスク',
    '  - [x] レビュー',
    '    - [x] task を持たないPRも読む',
    '  - [x] 直しの再開',
    `  - [${other}] その他のエージェント（周期で起きる係）`,
  ].join('\n');

/** `dispatch-chore.sh` を1本叩く。返すのは終了コード。 */
function dispatchChore(brake: string): number {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-dispatch-steps-'));
  try {
    const gh = join(work, 'gh');
    writeFileSync(
      gh,
      `${STUB_SHEBANG}
case "$1 $2" in
  "repo view") printf '%s' 'gooyyu1/UnmappedIsland' ;;
  "issue view") cat <<'BODY'
${brake}
BODY
    ;;
  *) exit 1 ;;
esac
`,
      'utf-8',
    );
    chmodSync(gh, 0o755);

    // 同じ仕事を既に持っている1本。**手綱を通ってしまった回は、ここで止まる。**
    const live = join(work, 'live.tsv');
    writeFileSync(
      live,
      'session_busy\tSESSION_STATUS_RUNNING\tSESSION_STATUS_BUCKET_WORKING\tchore-unstick\tbridge\n',
      'utf-8',
    );

    try {
      runScript(SCRIPT, ['unstick', '.claude/unstick-prompt.md'], {
        stdio: 'pipe',
        env: {
          ...process.env,
          PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
          LIVE_SESSIONS_TSV: live,
          BRAKE_ISSUE,
          CLOUD_ENV: 'env_TEST_CLOUD',
        },
      });
      return 0;
    } catch (error) {
      return (error as { status?: number }).status ?? -1;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe('dispatch-steps.sh', () => {
  it('人が手綱で止めていれば、3で終わる', () => {
    expect(dispatchChore(brakeBody(' '))).toBe(3);
  });

  // 3以外で転んだ周は、盤面から見れば詰まり。**占有で止まった回をここで見る**ので、
  // 「どんな失敗でも3になる」形の取り違えもここで落ちる。
  it('手綱以外で立てられなければ、1で終わる', () => {
    expect(dispatchChore(brakeBody('x'))).toBe(1);
  });
});
