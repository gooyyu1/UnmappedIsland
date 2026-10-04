import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pathForBash, runScript } from '../support/runScript';
import { STUB_SHEBANG } from '../support/stubShebang';

import { timeoutOnWindows } from '../support/timeoutOnWindows';

/**
 * `scripts/daemon/archive-session.sh` の、**戻せない操作**だけを見る検査。
 *
 * セッションを畳むのは打ち直せるが、worktree を消すのは戻せない。`git` は本物を使い、一時
 * ディレクトリに本物のリポジトリと worktree を作って走らせる——スタブにすると「消したつもり」で
 * 緑になり、この検査が守るものが無くなる。`ccr-meta.sh` だけ `CCR_META` で差し替える。
 */

const SCRIPT = resolve(__dirname, '../../scripts/daemon/archive-session.sh');

const SESSION = 'session_01TESTTESTTESTTESTTEST';
/** worktree の名前は、IDから接頭辞を落として作る（スクリプトと同じ規約）。 */
const WORKTREE = 'bridge-cse_01TESTTESTTESTTESTTEST';

/**
 * 畳む口が断ったときの言い分。**2行で言わせる**——**出力は1行1件**なので、改行が空白へ畳まれて
 * いることもここで見る。
 */
const REFUSAL = ['失敗: HTTP 403 Forbidden', '（資格情報を読み直す）'];

/** 素性を引く口が届かなかったときの言い分。**こちらも2行**で、畳まれていることを見る。 */
const UNREACHABLE = ['失敗: fetch failed', '（ECONNRESET）'];

interface World {
  /** 既に畳まれているか。 */
  readonly archived?: boolean;
  /** `archive_session` が理由を標準エラーへ言って非0で終わるか。 */
  readonly refuses?: boolean;
  /** `get_session` が理由を標準エラーへ言って非0で終わるか（＝素性が引けない）。 */
  readonly unreachable?: boolean;
  /** 素性が途中で切れて返るか（＝引けたが、JSONとして読めない）。 */
  readonly truncated?: boolean;
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
  /** 渡さない相手が、このPCに残している作業ツリー（見回りが掃くかを見る）。 */
  readonly others?: readonly Other[];
}

/** 渡されていない相手の、登録の外れた殻。 */
interface Other {
  /** IDの `session_` を落とした部分。作業ツリーは `bridge-cse_<これ>`。 */
  readonly id: string;
  /** 素性。`unreachable` は引けない。 */
  readonly status: 'archived' | 'running' | 'unreachable';
  /** 中に未追跡のファイルを置くか。 */
  readonly dirty?: boolean;
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
  /** 渡さない相手のうち、作業ツリーのディレクトリが残っているものの `id`。 */
  readonly othersKept: string[];
  /** 畳む口を打たれた相手（渡した相手を含む）。 */
  readonly archivedIds: string[];
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
    const others = world.others ?? [];
    const otherTree = (other: Other): string => join(repo, '.claude', 'worktrees', `bridge-cse_${other.id}`);
    for (const other of others) {
      mkdirSync(otherTree(other), { recursive: true });
      if (other.dirty === true) writeFileSync(join(otherTree(other), 'scratch.txt'), 'y\n', 'utf-8');
    }
    const otherCases = others
      .map((other) => {
        const id = `session_${other.id}`;
        if (other.status === 'unreachable') return `  ${id}) echo 'fetch failed' >&2; exit 1 ;;`;
        const status = other.status === 'archived' ? 'SESSION_STATUS_ARCHIVED' : 'SESSION_STATUS_RUNNING';
        const body = JSON.stringify({ ccr: { session_status: status, tags: ['task-1'] } });
        return `  ${id}) echo '<other-session>'; echo '${body}'; exit 0 ;;`;
      })
      .join('\n');

    // 引数は標準入力のJSON。`ccr-meta.sh` と同じ包み（`<other-session>`）を付けて返す。
    const meta = join(work, 'ccr-meta.sh');
    writeFileSync(
      meta,
      `${STUB_SHEBANG}
payload=$(cat)
if [ "$1" = get_session ]; then
  case "$(printf '%s' "$payload" | jq -r '.session_id')" in
${otherCases}
  esac
fi
if [ "$1" = archive_session ]; then
  printf '%s' "$payload" | jq -r '.session_id' >> '${dir}/archived'
${
  world.refuses === true
    ? `  printf '%s\\n' ${REFUSAL.map((line) => `'${line}'`).join(' ')} >&2\n  exit 1`
    : '  exit 0'
}
fi
${
  world.unreachable === true
    ? `printf '%s\\n' ${UNREACHABLE.map((line) => `'${line}'`).join(' ')} >&2\nexit 1`
    : 'true'
}
echo '<other-session>'
echo '${((body: string) => (world.truncated === true ? body.slice(0, 20) : body))(
        JSON.stringify({
          ccr: {
            session_status:
              world.archived === true
                ? 'SESSION_STATUS_ARCHIVED'
                : (world.state?.[0] ?? 'SESSION_STATUS_IDLE'),
            status_bucket: world.state?.[1] ?? 'SESSION_STATUS_BUCKET_READY',
            tags: world.tags ?? ['task-1558'],
          },
        }),
      )}'
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
      othersKept: others.filter((other) => existsSync(otherTree(other))).map((other) => other.id),
      archivedIds: existsSync(join(work, 'archived'))
        ? readFileSync(join(work, 'archived'), 'utf-8')
            // Windows の `jq` は CRLF で書く。
            .split(/\r?\n/)
            .filter((line) => line !== '')
        : [],
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

describe('archive-session.sh', timeoutOnWindows(30_000), () => {
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
    // 断ったのが `rmdir` であることまで読めること。パスだけを見ると、理由が何であっても通る。
    expect(reason(result.text)).toContain('rmdir');
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

  // **タグと対象だけでは、失敗した事実しか運ばない**（issue #1864）。権限が足りないのか相手が
  // もう居ないのかへ辿り着けないと、読んだ側は同じコマンドを手で打ち直すところから始めることになる。
  it('畳めなかったら、打った口が言った理由を同じ行へ載せる', () => {
    const result = run({ refuses: true });

    expect(result.text.trim()).toBe(`UNARCHIVED ${SESSION}: ${REFUSAL.join(' ')}`);
    // 畳めていないので、worktree にも手を出さない。
    expect(result.kept).toBe(true);
  });

  // **`KEPT` は「畳んではいけない」という安定した答え**で、盤面は指紋に残して次の周からその相手を
  // 渡さなくなる。引けなかった1回をそこへ混ぜると、通信が落ちたその周かぎりでその相手が二度と
  // 畳まれない（issue #1865）。理由も同じ行へ載せる——**1行1件**なので、畳めていなければ理由の
  // 続きが次の行として現れて落ちる。
  it('素性を引けなければ、`KEPT` ではなく理由ごと1行の `UNKNOWN` を出す', () => {
    const result = run({ unreachable: true });

    expect(result.text.trim()).toBe(`UNKNOWN ${SESSION}: ${UNREACHABLE.join(' ')}`);
    // 畳んでよいかが分からないので、セッションにも worktree にも手を出さない。
    expect(result.archived).toBe(false);
    expect(result.kept).toBe(true);
  });

  // **`jq` は偽でも読めなくても非0。** タグの判定（`! jq -e`）へそのまま渡すと、読めなかったぶんが
  // 「どの接頭辞にも当たらない」＝ `KEPT` に化け、上と同じ形でその相手が二度と畳まれなくなる。
  it('素性が途中で切れていたら、`KEPT` でも `ARCHIVED` でもなく `UNKNOWN` を出す', () => {
    const result = run({ truncated: true, args: ['--keep-untagged', 'task-,review-'] });

    expect(result.text.trim().startsWith(`UNKNOWN ${SESSION}: `)).toBe(true);
    // 読めなかったのが `jq` であることまで読めること（理由が空の行では、次に打つ手が分からない）。
    expect(result.text).toContain('jq');
    expect(result.archived).toBe(false);
    expect(result.kept).toBe(true);
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

  // **一度畳んだ相手が二度渡ることは無い**ので、畳んだ瞬間に消し損ねた空の殻には、渡された相手とは
  // 別に見回らないと誰も手を出さない（issue #2107）。
  describe('取りこぼした空の殻の見回り', () => {
    const ARCHIVED_SHELL = { id: '01ARCHIVEDSHELL', status: 'archived' } as const;
    /** 掃く条件に当たらない殻からは何も出ないので、渡した相手の行だけが残る。 */
    const PASSED_ONLY = [`ARCHIVED ${SESSION}`, `REMOVED ${WORKTREE}`];

    it('畳まれていると引けた相手の空の殻は、渡されていなくても消す', () => {
      const result = run({ others: [ARCHIVED_SHELL] });

      expect(result.othersKept).toEqual([]);
      expect(result.text).toMatch(/^REMOVED .*\/bridge-cse_01ARCHIVEDSHELL$/m);
      // 見回りがするのは後始末だけで、渡されていない相手は畳まない。
      expect(result.archivedIds).toEqual([SESSION]);
    });

    it('渡された相手を何も畳まない回でも掃く', () => {
      const result = run({ unreachable: true, others: [ARCHIVED_SHELL] });

      expect(result.othersKept).toEqual([]);
    });

    // **空であることは、生きていないことを意味しない**——立ち上がったばかりの作業ツリーは一瞬空で
    // ありうる。空かどうかだけで掃く実装にすると、ここで落ちる。
    it('走っている相手の空の殻は、残して何も言わない', () => {
      const result = run({ others: [{ id: '01RUNNINGSHELL', status: 'running' }] });

      expect(result.othersKept).toEqual(['01RUNNINGSHELL']);
      expect(result.archivedIds).toEqual([SESSION]);
      expect(result.lines).toEqual(PASSED_ONLY);
    });

    // 引けないのは「畳まれていない」という答えではないが、畳まれているとも言えない。
    it('素性を引けない相手の殻は、残して何も言わない', () => {
      const result = run({ others: [{ id: '01UNREACHABLE', status: 'unreachable' }] });

      expect(result.othersKept).toEqual(['01UNREACHABLE']);
      expect(result.lines).toEqual(PASSED_ONLY);
    });

    // 戻せないものは消さない。呼ばれるたびに `DIRTY` を積もらせもしない。
    it('畳まれた相手でも、中身の在る殻は残して何も言わない', () => {
      const result = run({ others: [{ ...ARCHIVED_SHELL, dirty: true }] });

      expect(result.othersKept).toEqual([ARCHIVED_SHELL.id]);
      expect(result.lines).toEqual(PASSED_ONLY);
    });
  });
});
