import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { pathForBash, runScript } from '../support/runScript';
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

const SESSION = 'session_01TESTTESTTESTTESTTEST';
/** worktree の名前は、IDから接頭辞を落として作る（スクリプトと同じ規約）。 */
const WORKTREE = 'bridge-cse_01TESTTESTTESTTESTTEST';

interface World {
  /** 既に畳まれているか。 */
  readonly archived?: boolean;
  /** `session_status` と `status_bucket`。既定は手が空いている。 */
  readonly state?: readonly [string, string];
  /** 畳む相手が名乗るタグ。既定は盤面が立てたワーカー。 */
  readonly tags?: readonly string[];
  /**
   * worktree の形。既定は git に登録された作業ツリー。`orphan` は**登録だけが消えて残った
   * ディレクトリ**（実物のディスクに在る形）、`none` は worktree を持たないセッション。
   */
  readonly worktree?: 'registered' | 'orphan' | 'none';
  /** worktree に未追跡のファイルを置くか。 */
  readonly dirty?: boolean;
  /** 渡す引数。 */
  readonly args?: readonly string[];
}

interface Run {
  /** 一時ディレクトリの分を落とした出力。`DIRTY` の理由も落とす（それは `text` で見る）。 */
  readonly lines: string[];
  /** 出力そのまま。理由まで見たい検査が読む。 */
  readonly text: string;
  /** `archive_session` を打たれたか。 */
  readonly archived: boolean;
  /** worktree のディレクトリが残っているか。 */
  readonly kept: boolean;
}

function run(world: World = {}): Run {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-archive-session-'));
  try {
    const dir = pathForBash(work);
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
    const shape = world.worktree ?? 'registered';
    if (shape === 'registered') {
      git('worktree', 'add', '--detach', tree);
      // 実物と同じく、`claude remote-control` がロックした状態から始める。
      git('worktree', 'lock', tree);
    } else if (shape === 'orphan') {
      mkdirSync(tree, { recursive: true });
    }
    if (shape !== 'none' && world.dirty === true) writeFileSync(join(tree, 'scratch.txt'), 'y\n', 'utf-8');

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
          tags: world.tags ?? ['task-1558'],
        },
      })}'
`,
      'utf-8',
    );
    chmodSync(meta, 0o755);

    const out = runScript(SCRIPT, world.args ?? [], {
      cwd: repo,
      input: `${SESSION}\n`,
      env: {
        ...process.env,
        PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
        CCR_META: meta,
      },
    });
    return {
      text: out,
      lines: out
        .split('\n')
        .filter((line) => line.trim() !== '')
        // パスは一時ディレクトリごとに変わるので、名前だけを見る。理由は `text` の側で見る。
        .map((line) =>
          line.replace(new RegExp(`^(REMOVED|DIRTY) .*?/${WORKTREE}(?::.*)?$`), `$1 ${WORKTREE}`),
        ),
      archived:
        existsSync(join(work, 'archived')) && readFileSync(join(work, 'archived'), 'utf-8').includes(SESSION),
      kept: existsSync(tree),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** `DIRTY` の行に載った理由（パスの後ろ）。載っていなければ `undefined`。 */
function reason(text: string): string | undefined {
  const line = text.split(/\r?\n/).find((candidate) => candidate.startsWith('DIRTY '));
  const at = line?.indexOf(': ') ?? -1;
  return at >= 0 ? line?.slice(at + 2) : undefined;
}

describe('archive-session.sh', () => {
  // **ブリッジで立てたものも同じ条件で畳む。** worktree を持つことは畳んでよいかの条件ではなく、
  // 畳んだ後に何を片付けるかの話。
  it('このPCの worktree を持つセッションを、畳んでロックを外して消す', () => {
    const result = run();

    expect(result.lines).toEqual([`ARCHIVED ${SESSION}`, `REMOVED ${WORKTREE}`]);
    expect(result.archived).toBe(true);
    expect(result.kept).toBe(false);
  });

  // **戻せないものを黙って消さない。** `--force` を渡していないことが、ここで守られる。
  it('未追跡のファイルがある worktree は消さずに `DIRTY` として残す', () => {
    const result = run({ dirty: true });

    expect(result.lines).toEqual([`ARCHIVED ${SESSION}`, `DIRTY ${WORKTREE}`]);
    expect(result.kept).toBe(true);
    // パスだけでは失敗した事実しか運ばない。断ったのが git であることが読めるように、その標準
    // エラーを同じ行へ載せる（issue #1557）。
    expect(reason(result.text)).toContain('--force');
  });

  // `git worktree remove` が登録を外した後、ディレクトリだけが残ることがある（ディスクに実際に
  // 在った形）。一覧から引いていた間は、この形が永久に拾われなかった。
  it('登録が消えてディレクトリだけ残った残骸も片付ける', () => {
    const result = run({ worktree: 'orphan' });

    expect(result.lines).toEqual([`ARCHIVED ${SESSION}`, `REMOVED ${WORKTREE}`]);
    expect(result.kept).toBe(false);
  });

  // 残骸を外すのは `rmdir`。**中に何か在れば断る**ので、`--force` を渡さないのと同じ守りになる。
  it('登録の消えた残骸に中身が在れば、消さずに `DIRTY` として残す', () => {
    const result = run({ worktree: 'orphan', dirty: true });

    expect(result.lines).toEqual([`ARCHIVED ${SESSION}`, `DIRTY ${WORKTREE}`]);
    expect(result.kept).toBe(true);
    expect(reason(result.text)).toContain(WORKTREE);
  });

  // 畳む口と外す口が別だった間の残骸。畳み直しはしないが、後始末だけはやる。
  it('既に畳まれていても、残っている worktree は消す', () => {
    const result = run({ archived: true });

    expect(result.lines).toEqual([`REMOVED ${WORKTREE}`]);
    expect(result.archived).toBe(false);
  });

  // **走っている相手を除くのは渡す側**（`board-move.mjs`）。ここで除くと `KEPT` が返り、盤面は
  // それを安定した答えとして指紋に残すので、その相手が二度と畳まれなくなる。
  it('走っているセッションでも、渡されたら畳む', () => {
    const state = ['SESSION_STATUS_RUNNING', 'SESSION_STATUS_BUCKET_WORKING'] as const;
    const result = run({ state });

    expect(result.archived).toBe(true);
  });

  it('worktree の無いセッションは、畳むだけで終わる', () => {
    const result = run({ worktree: 'none' });

    expect(result.lines).toEqual([`ARCHIVED ${SESSION}`]);
    expect(result.archived).toBe(true);
  });

  // 仕事の単位を持たない相手（相談役など）を畳むと、ユーザーが話している窓口ごと閉じる。
  it('接頭辞のどれにも当たらないタグの相手は、worktree ごと残す', () => {
    const result = run({ args: ['--keep-untagged', 'task-,review-'], tags: ['soudanyaku'] });

    expect(result.lines).toEqual([`KEPT ${SESSION}`]);
    expect(result.archived).toBe(false);
    expect(result.kept).toBe(true);
  });

  it('接頭辞に当たるタグの相手は、`--keep-untagged` を渡されても畳む', () => {
    const result = run({ args: ['--keep-untagged', 'task-,review-'] });

    expect(result.lines).toEqual([`ARCHIVED ${SESSION}`, `REMOVED ${WORKTREE}`]);
    expect(result.archived).toBe(true);
  });
});
