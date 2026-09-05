import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { STUB_SHEBANG } from '../support/stubShebang';

/**
 * `scripts/agent/archive-session.sh` の、**戻せない操作**だけを見る検査。
 *
 * セッションを畳むのは打ち直せるが、worktree を消すのは戻せない。`git` は本物を使い、一時
 * ディレクトリに本物のリポジトリと worktree を作って走らせる——スタブにすると「消したつもり」で
 * 緑になり、この検査が守るものが無くなる。`ccr-meta.sh` だけ `CCR_META` で差し替える。
 */

// 実際にgitでworktreeまで作る重いテストなので、`npm test` 全体を並行実行したときのCPU競合だけで
// 既定の5秒を超えうる。
vi.setConfig({ testTimeout: 20000 });

const SCRIPT = resolve(__dirname, '../../scripts/agent/archive-session.sh');

/** `ccr-env.sh` へ環境変数で渡す身代わり。実物のIDは試験に書き写さない。 */
const CLOUD = 'env_TEST_CLOUD';
const BRIDGE = 'env_TEST_BRIDGE';

const SESSION = 'session_01TESTTESTTESTTESTTEST';
/** worktree の名前は、IDから接頭辞を落として作る（スクリプトと同じ規約）。 */
const WORKTREE = 'bridge-cse_01TESTTESTTESTTESTTEST';

interface World {
  /** 畳む相手がブリッジ（このPC）で立ったものか。既定はブリッジ。 */
  readonly onBridge?: boolean;
  /** 既に畳まれているか。 */
  readonly archived?: boolean;
  /** `session_status` と `status_bucket`。既定は手が空いている。 */
  readonly state?: readonly [string, string];
  /** worktree を作るか。既定は作る。 */
  readonly worktree?: boolean;
  /** worktree に未追跡のファイルを置くか。 */
  readonly dirty?: boolean;
  /** 渡す引数。 */
  readonly args?: readonly string[];
}

interface Run {
  readonly lines: string[];
  /** `archive_session` を打たれたか。 */
  readonly archived: boolean;
  /** worktree のディレクトリが残っているか。 */
  readonly kept: boolean;
}

function run(world: World = {}): Run {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-archive-session-'));
  try {
    const dir = work.replace(/\\/g, '/');
    const repo = join(work, 'repo');
    const tree = join(repo, '.claude', 'worktrees', WORKTREE);
    const git = (...args: string[]): void => {
      execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
        cwd: repo,
        stdio: 'ignore',
      });
    };
    mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init', repo], { stdio: 'ignore' });
    writeFileSync(join(repo, 'README.md'), 'x\n', 'utf-8');
    git('add', 'README.md');
    git('commit', '-m', 'x');
    if (world.worktree ?? true) {
      git('worktree', 'add', '--detach', tree);
      // 実物と同じく、`claude remote-control` がロックした状態から始める。
      git('worktree', 'lock', tree);
      if (world.dirty === true) writeFileSync(join(tree, 'scratch.txt'), 'y\n', 'utf-8');
    }

    // 引数は標準入力のJSON。`ccr-meta.sh` と同じ包み（`<other-session>`）を付けて返す。
    const meta = join(work, 'ccr-meta.sh');
    writeFileSync(
      meta,
      `${STUB_SHEBANG}
payload=$(cat)
if [ "$1" = archive_session ]; then
  printf '%s' "$payload" | jq -r '.session_id' >> '${dir}/archived'
  exit 0
fi
echo '<other-session>'
echo '${JSON.stringify({
        ccr: {
          session_status:
            world.archived === true ? 'SESSION_STATUS_ARCHIVED' : (world.state?.[0] ?? 'SESSION_STATUS_IDLE'),
          status_bucket: world.state?.[1] ?? 'SESSION_STATUS_BUCKET_READY',
          tags: ['commander'],
          environment_id: (world.onBridge ?? true) ? BRIDGE : CLOUD,
        },
      })}'
`,
      'utf-8',
    );
    chmodSync(meta, 0o755);

    const out = execFileSync('bash', [SCRIPT, ...(world.args ?? [])], {
      cwd: repo,
      input: `${SESSION}\n`,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
        CCR_META: meta,
        CLOUD_ENV: CLOUD,
        BRIDGE_ENV: BRIDGE,
      },
    });
    return {
      lines: out
        .split('\n')
        .filter((line) => line.trim() !== '')
        // パスは一時ディレクトリごとに変わるので、名前だけを見る。
        .map((line) => line.replace(/^(REMOVED|DIRTY) .*\//, '$1 ')),
      archived:
        existsSync(join(work, 'archived')) && readFileSync(join(work, 'archived'), 'utf-8').includes(SESSION),
      kept: existsSync(tree),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe('archive-session.sh', () => {
  it('ブリッジのセッションは、既定では畳まず worktree も触らない', () => {
    const result = run();

    expect(result.lines).toEqual([`KEPT ${SESSION}`]);
    expect(result.archived).toBe(false);
    expect(result.kept).toBe(true);
  });

  // `claude remote-control` が生きていることを知っているのは呼び手だけなので、引数で受ける。
  it('`--force-bridge` を渡すと、畳んで worktree のロックを外して消す', () => {
    const result = run({ args: ['--force-bridge'] });

    expect(result.lines).toEqual([`ARCHIVED ${SESSION}`, `REMOVED ${WORKTREE}`]);
    expect(result.archived).toBe(true);
    expect(result.kept).toBe(false);
  });

  // **戻せないものを黙って消さない。** `--force` を渡していないことが、ここで守られる。
  it('未追跡のファイルがある worktree は消さずに `DIRTY` として残す', () => {
    const result = run({ args: ['--force-bridge'], dirty: true });

    expect(result.lines).toEqual([`ARCHIVED ${SESSION}`, `DIRTY ${WORKTREE}`]);
    expect(result.kept).toBe(true);
  });

  // 畳む口と外す口が別だった間の残骸。畳み直しはしないが、後始末だけは同じ引数でやる。
  it('既に畳まれていても、残っている worktree は消す', () => {
    const result = run({ args: ['--force-bridge'], archived: true });

    expect(result.lines).toEqual([`REMOVED ${WORKTREE}`]);
    expect(result.archived).toBe(false);
  });

  // 判定を書いている最中のレビューを畳むと、そのコメントは出ないまま消える。
  it('`--keep-working` は、走っているセッションを畳まない', () => {
    const state = ['SESSION_STATUS_RUNNING', 'SESSION_STATUS_BUCKET_WORKING'] as const;
    const result = run({ args: ['--force-bridge', '--keep-working'], state });

    expect(result.lines).toEqual([`KEPT ${SESSION}`]);
    expect(result.archived).toBe(false);
  });

  // **見るのは `session_status`。** `status_bucket` は手が空いても `..._WORKING` のまま固まることが
  // あり（board-design 1.6）、そちらで見ると畳めないセッションが溜まり続ける。
  it('`--keep-working` でも、手が空いていれば status_bucket が WORKING でも畳む', () => {
    const state = ['SESSION_STATUS_IDLE', 'SESSION_STATUS_BUCKET_WORKING'] as const;
    const result = run({ args: ['--force-bridge', '--keep-working'], state });

    expect(result.archived).toBe(true);
  });

  it('クラウドのセッションには worktree が無いので、畳むだけで終わる', () => {
    const result = run({ onBridge: false, worktree: false });

    expect(result.lines).toEqual([`ARCHIVED ${SESSION}`]);
    expect(result.archived).toBe(true);
  });
});
