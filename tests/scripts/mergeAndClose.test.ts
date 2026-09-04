import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * `scripts/agent/merge-and-close.sh` が出す行の検査。
 *
 * **後戻りできない操作をする唯一の司令塔スクリプト**なので、素通しの条件だけは機械で見る。
 * コンフリクトしたPRでマージへ進むと、失敗するだけでなく、司令塔は片付いたつもりで次へ行く。
 *
 * `gh`・`git`・`npm` を PATH の先頭に、`ccr-meta.sh` を `CCR_META` で差し替えて、実際にスクリプトを
 * 走らせる。本体（`git` が差す先）も作業用の一時ディレクトリに作るので、手元のリポジトリは動かない。
 */

// 全件が実プロセス（bash + git + gh のスタブ）を起こすため、既定の5秒だと `npm test` 全体を並行実行
// したときのCPU競合だけで時間切れになりうる（watchPrs.test.tsと同じ理由）。
vi.setConfig({ testTimeout: 20000 });

const SCRIPT = resolve(__dirname, '../../scripts/agent/merge-and-close.sh');
/** 同じ世界で叩ける後片付けの片割れ。こちらはPRが**開いている**ときの経路を持つ。 */
const ARCHIVE_REVIEWS = resolve(__dirname, '../../scripts/agent/archive-reviews.sh');

/** `ccr-env.sh` へ環境変数で渡す身代わり。実物のIDは試験に書き写さない。 */
const CLOUD = 'env_TEST_CLOUD';
const BRIDGE = 'env_TEST_BRIDGE';

/**
 * 脚注の無い本文は `NOSESSION` を出すので、脚注の話でない試験には既定でこれを持たせる。
 * 指す先は畳み済みなので、`ARCHIVED` の行も増えない。
 */
const DEFAULT_BODY = '_[Claude Code](https://claude.ai/code/session_01ZZZZZZZZZZZZZZZZZZZZZZ)_';

interface World {
  readonly mergeable?: string;
  readonly body?: string;
  /** issue番号ごとの `state`。 */
  readonly issues?: Record<number, string>;
  /** セッションIDごとの `session_status`。 */
  readonly sessions?: Record<string, string>;
  /**
   * セッションIDごとのタグ。`list_sessions` はここに挙げたものだけを返す（既定は空）。
   * `get_session` は挙がっていないIDにも `task-1000` を返す——**畳む相手であることが既定**で、
   * タグの話でない試験がそこで止まらないようにする。
   */
  readonly tags?: Record<string, string[]>;
  /**
   * `list_sessions` の**2ページ目**（`after_id` を渡したときだけ返る）。挙げると1ページ目に
   * `has_more` が付く。`limit` の上限は100なので、繰らないとここへは届かない。
   */
  readonly olderTags?: Record<string, string[]>;
  /**
   * ブリッジ（このPC）の環境で立ったセッション。**タグはクラウドと同じ**なので、これでしか
   * 区別が付かない。環境IDそのものは `ccr-env.sh` から環境変数で差し替える。
   */
  readonly onBridge?: readonly string[];
  /**
   * 走っている最中のセッション（`get_session` の `status_bucket` が `…_WORKING`）。
   * `session_status` とは別に持つ——**「走っているか」と「畳まれているか」は別の問い**で、
   * 畳む側が見るのは両方。
   */
  readonly working?: readonly string[];
  /**
   * `get_session` の応答にJSONが入らないセッション（引けない日）。タグも状態も環境も分からない。
   */
  readonly unknown?: readonly string[];
  /** PRに付いているコメント。`## 司令塔へ` をレビューから拾えるかを見るために使う。 */
  readonly comments?: readonly string[];
  /** `archive_session` が失敗するか。 */
  readonly archiveFails?: boolean;
  /** `gh pr edit` が失敗するか。 */
  readonly labelFails?: boolean;
  /** 本体に未コミットの変更（追跡済み）があるか。 */
  readonly mainDirty?: boolean;
  /** マージで `package-lock.json` が変わったか。 */
  readonly lockChanged?: boolean;
  /** 本体に依存が入っているか。既定は入っている。 */
  readonly mainInstalled?: boolean;
  /** 関門（`needs-user-review.sh`）が出す理由。既定は該当なしで、関門は開いている。 */
  readonly gate?: readonly string[];
  /** 関門の終了コード。既定は理由の有無から決まる（あれば 0、無ければ 1）。 */
  readonly gateStatus?: number;
  /** `gh pr view --json state` が失敗するか（PRの状態を引けない日）。 */
  readonly stateFails?: boolean;
  /**
   * 開いているPRの番号（`gh pr list`）。既定はこのPR（1000）だけで、**マージすると外れる**。
   * レビューを畳むかはPRごとにこれで決まる。
   */
  readonly openPrs?: readonly number[];
  /** `gh pr list` が失敗するか（開いているPRの一覧を引けない日）。 */
  readonly prListFails?: boolean;
  /** `--user-ok` を付けて叩くか。 */
  readonly userOk?: boolean;
}

interface Run {
  readonly lines: string[];
  readonly status: number;
  /** `gh pr merge` が呼ばれたか。 */
  readonly merged: boolean;
  /** `archive_session` を呼ばれたセッション。 */
  readonly archived: string[];
  /** `get_session` で素性を引かれたセッション。 */
  readonly probed: string[];
  /** 本体で `npm install` が走ったか。 */
  readonly installed: boolean;
  /** `git` に渡された引数。 */
  readonly git: string[];
  /** `gh pr edit` に渡されたラベルの操作。 */
  readonly labels: string[];
  /** PRへ書いたコメントの本文。 */
  readonly comments: string;
}

/**
 * 世界を組んで叩く。`entry` を渡すと `merge-and-close.sh` 以外を同じ世界で叩ける——`gh` のスタブは
 * `gh pr merge` が呼ばれるまで `state` に `OPEN` を返すので、**PRが開いている経路**はこれでしか試せない。
 */
function run(world: World, entry: readonly string[] = [SCRIPT, '1000']): Run {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-merge-and-close-'));
  try {
    const dir = work.replace(/\\/g, '/');
    // `gh pr view --json` が返すものを、そのままの形で持たせる（改行もバッククォートも含むので、
    // シェルへ埋め込まずファイルで渡す）。**絞り込みも符号化もここでは真似ない**——`--jq` の式は下の
    // スタブが本物の `jq` へ渡す。スタブが真似ると、式だけを変えても試験は緑のまま通る。
    writeFileSync(
      join(work, 'pr.json'),
      JSON.stringify({
        body: world.body ?? DEFAULT_BODY,
        comments: (world.comments ?? []).map((body) => ({ body })),
      }),
      'utf-8',
    );

    // 本体の身代わり。`.git` があることでスクリプトの `--git-common-dir` からの辿りが成り立つ。
    mkdirSync(join(work, 'main', '.git'), { recursive: true });
    if (world.mainInstalled ?? true) {
      mkdirSync(join(work, 'main', 'node_modules'), { recursive: true });
      writeFileSync(join(work, 'main', 'node_modules', '.package-lock.json'), '{}', 'utf-8');
    }

    const branches = (cases: Record<string | number, string>): string =>
      Object.entries(cases)
        .map(([key, value]) => `    ${key}) printf '%s' '${value}' ;;`)
        .join('\n');

    // PRの `state` は、マージが呼ばれたかで変わる。`--json body`・`--json comments` は、`--jq` の式
    // （最後の引数）を本物の `jq` へ渡して評価させる——本物の `gh` がするのと同じことなので、式を
    // 変えればここも一緒に動く。`-r` は `gh --jq` の出力に合わせたもの。
    const stub = join(work, 'gh');
    writeFileSync(
      stub,
      `#!/usr/bin/env bash
if [ "$1" = pr ] && [ "$2" = merge ]; then
  touch '${dir}/merged'
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = view ]; then
  case "$5" in
    body|comments) jq -r "\${@: -1}" '${dir}/pr.json' ;;
    mergeable) printf '%s' '${world.mergeable ?? 'MERGEABLE'}' ;;
    state) ${
      world.stateFails === true
        ? 'exit 1'
        : `if [ -e '${dir}/merged' ]; then printf '%s' MERGED; else printf '%s' OPEN; fi`
    } ;;
  esac
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = list ]; then
  ${world.prListFails === true ? 'exit 1' : ':'}
  for n in $(printf '%s' '${(world.openPrs ?? [1000]).join(' ')}'); do
    if [ "$n" = 1000 ] && [ -e '${dir}/merged' ]; then continue; fi
    printf '%s\\n' "$n"
  done
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = edit ]; then
  shift 3
  echo "$*" >> '${dir}/labels'
  exit ${world.labelFails ? 1 : 0}
fi
if [ "$1" = pr ] && [ "$2" = comment ]; then
  cat "$5" >> '${dir}/comments'
  exit 0
fi
if [ "$1" = issue ] && [ "$2" = view ]; then
  case "$3" in
${branches(world.issues ?? {})}
  esac
  exit 0
fi
exit 1
`,
      'utf-8',
    );
    chmodSync(stub, 0o755);

    // `HEAD:package-lock.json` の中身は、`checkout` を境に変わる（マージで依存が動いた場合）。
    const git = join(work, 'git');
    writeFileSync(
      git,
      `#!/usr/bin/env bash
echo "$*" >> '${dir}/git-calls'
case "$*" in
  *'rev-parse --git-common-dir'*) printf '%s' '${dir}/main/.git' ;;
  *'status --porcelain'*) printf '%s' '${world.mainDirty === true ? ' M docs/x.md' : ''}' ;;
  *'HEAD:package-lock.json'*)
    if [ -e '${dir}/checked-out' ]; then printf '%s' '${world.lockChanged === true ? 'bbb222' : 'aaa111'}'
    else printf '%s' 'aaa111'; fi ;;
  *'rev-parse --short HEAD'*) printf '%s' 'deadbee' ;;
  *checkout*) touch '${dir}/checked-out' ;;
esac
exit 0
`,
      'utf-8',
    );
    chmodSync(git, 0o755);

    const npm = join(work, 'npm');
    writeFileSync(npm, `#!/usr/bin/env bash\necho "$*" >> '${dir}/npm-calls'\n`, 'utf-8');
    chmodSync(npm, 0o755);

    // 関門。理由が1件でもあれば 0（＝該当あり）を返す。`needs-user-review.sh` と同じ約束。
    const gate = join(work, 'needs-user-review.sh');
    writeFileSync(
      gate,
      `#!/usr/bin/env bash\n${(world.gate ?? []).map((line) => `echo '${line}'`).join('\n')}\nexit ${
        world.gateStatus ?? ((world.gate ?? []).length > 0 ? 0 : 1)
      }\n`,
      'utf-8',
    );

    /** `list_sessions` の1ページぶん。 */
    const listed = (tags: Record<string, readonly string[]>): unknown[] =>
      Object.entries(tags).map(([id, value]) => ({
        id,
        tags: value,
        session_status: world.sessions?.[id] ?? 'SESSION_STATUS_IDLE',
        environment_id: (world.onBridge ?? []).includes(id) ? BRIDGE : CLOUD,
      }));

    // 引数は標準入力のJSON。`ccr-meta.sh` と同じ包み（`<other-session>`）を付けて返す。
    const meta = join(work, 'ccr-meta.sh');
    writeFileSync(
      meta,
      `#!/usr/bin/env bash
payload=$(cat)
id=$(printf '%s' "$payload" | jq -r '.session_id // ""')
after=$(printf '%s' "$payload" | jq -r '.after_id // ""')
if [ "$1" = list_sessions ]; then
  echo '<other-session>'
  if [ -n "$after" ]; then
    echo '${JSON.stringify({ ccr: { data: listed(world.olderTags ?? {}) } })}'
  else
    echo '${JSON.stringify({
      ccr: {
        data: listed(world.tags ?? {}),
        ...(Object.keys(world.olderTags ?? {}).length > 0
          ? {
              has_more: true,
              last_id: Object.keys(world.tags ?? {}).slice(-1)[0] ?? 'session_01PAGE1END0000000000',
            }
          : {}),
      },
    })}'
  fi
  exit 0
fi
if [ "$1" = archive_session ]; then
  echo "$id" >> '${dir}/archived'
  exit ${world.archiveFails === true ? 1 : 0}
fi
echo "$id" >> '${dir}/probed'
echo '<other-session>'
case "$id" in
${(world.unknown ?? []).map((id) => `  ${id}) : ;;`).join('\n')}
${Object.entries({ session_01ZZZZZZZZZZZZZZZZZZZZZZ: 'SESSION_STATUS_ARCHIVED', ...world.sessions })
  .map(
    ([id, status]) =>
      `  ${id}) echo '${JSON.stringify({
        ccr: {
          session_status: status,
          status_bucket: (world.working ?? []).includes(id)
            ? 'SESSION_STATUS_BUCKET_WORKING'
            : 'SESSION_STATUS_BUCKET_READY',
          tags: world.tags?.[id] ?? ['task-1000'],
          environment_id: (world.onBridge ?? []).includes(id) ? BRIDGE : CLOUD,
        },
      })}' ;;`,
  )
  .join('\n')}
${(world.onBridge ?? [])
  .filter((id) => !(id in { ...world.sessions }))
  .map(
    (id) =>
      `  ${id}) echo '${JSON.stringify({
        ccr: { tags: world.tags?.[id] ?? ['task-1000'], environment_id: BRIDGE },
      })}' ;;`,
  )
  .join('\n')}
  *) echo '${JSON.stringify({ ccr: { tags: ['task-1000'], environment_id: CLOUD } })}' ;;
esac
`,
      'utf-8',
    );

    let status = 0;
    let out = '';
    try {
      out = execFileSync('bash', [...entry, ...(world.userOk === true ? ['--user-ok'] : [])], {
        encoding: 'utf-8',
        env: {
          ...process.env,
          PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
          CCR_META: meta,
          NEEDS_USER_REVIEW: gate,
          CLOUD_ENV: CLOUD,
          BRIDGE_ENV: BRIDGE,
        },
      });
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      status = failure.status ?? 1;
      out = failure.stdout ?? '';
    }
    const lines = (text: string): string[] => text.split('\n').filter((line) => line.trim() !== '');
    const logged = (name: string): string[] =>
      existsSync(join(work, name)) ? lines(readFileSync(join(work, name), 'utf-8')) : [];
    return {
      lines: lines(out),
      status,
      merged: existsSync(join(work, 'merged')),
      archived: logged('archived'),
      probed: logged('probed'),
      installed: logged('npm-calls').length > 0,
      git: logged('git-calls'),
      labels: logged('labels'),
      comments: existsSync(join(work, 'comments')) ? readFileSync(join(work, 'comments'), 'utf-8') : '',
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe('merge-and-close.sh', () => {
  it('コンフリクトしているPRはマージせずに終わる', () => {
    const result = run({ mergeable: 'CONFLICTING' });

    expect(result.merged).toBe(false);
    expect(result.status).toBe(1);
  });

  // 司令塔の判断では越えられない関門。越えるにはユーザーの許可を引いて `--user-ok` で叩き直す。
  it('関門に掛かったPRはマージせず、判断待ちを付けて理由ごと HELD で返す', () => {
    const result = run({ gate: ['GRAMMAR src/domain/DeclaredNumber.ts'] });

    expect(result.merged).toBe(false);
    expect(result.lines).toEqual(['HELD 1000', '    GRAMMAR src/domain/DeclaredNumber.ts']);
    expect(result.labels).toEqual(['--add-label 判断待ち']);
    expect(result.status).toBe(1);
  });

  // 関門は「調べられなかった」ときも該当ありとして閉じる。開いたままにすると、`gh` が転んだ日は
  // 全部が素通しになる。
  it('関門が調べられなかったときも止める', () => {
    const result = run({ gate: ['PR #1000 のファイル一覧を引けなかった'], gateStatus: 2 });

    expect(result.merged).toBe(false);
    expect(result.lines).toEqual(['HELD 1000', '    PR #1000 のファイル一覧を引けなかった']);
  });

  it('--user-ok なら、許可を受けたことをPRへ残してからマージする', () => {
    const result = run({ gate: ['GRAMMAR src/domain/DeclaredNumber.ts'], userOk: true });

    expect(result.merged).toBe(true);
    expect(result.comments).toContain('GRAMMAR src/domain/DeclaredNumber.ts');
    expect(result.labels).toEqual(['--remove-label 判断待ち']);
    expect(result.status).toBe(0);
  });

  it('関門に掛からないPRは、--user-ok を付けなくてもコメントを残さずマージする', () => {
    const result = run({});

    expect(result.merged).toBe(true);
    expect(result.comments).toBe('');
    expect(result.labels).toEqual([]);
  });

  it('マージして、Closes の issue が閉じたことと、PRを出したセッションを畳んだことを出す', () => {
    const result = run({
      body: 'Closes #1033\n\n_[Claude Code](https://claude.ai/code/session_01AAAAAAAAAAAAAAAAAAAAAA)_',
      issues: { 1033: 'CLOSED' },
      sessions: { session_01AAAAAAAAAAAAAAAAAAAAAA: 'SESSION_STATUS_RUNNING' },
    });

    expect(result.merged).toBe(true);
    expect(result.lines).toEqual([
      'MERGED 1000',
      'CLOSED 1033',
      'ARCHIVED session_01AAAAAAAAAAAAAAAAAAAAAA',
      'SYNCED deadbee',
    ]);
    expect(result.archived).toEqual(['session_01AAAAAAAAAAAAAAAAAAAAAA']);
    expect(result.status).toBe(0);
  });

  it('閉じ損ねた issue は残りとして出し、終了コードで報せる', () => {
    const result = run({ body: `Closes #1033\n\n${DEFAULT_BODY}`, issues: { 1033: 'OPEN' } });

    expect(result.lines).toEqual(['MERGED 1000', 'OPEN 1033', 'SYNCED deadbee']);
    expect(result.status).toBe(2);
  });

  // 脚注は本文の一部なので書き手が消せるが、`task-<番号>` のタグは `dispatch-task.sh` が付ける。
  it('脚注が落ちていても、Closes の issue とタグで畳む相手を引く', () => {
    const result = run({
      body: 'Closes #1033',
      issues: { 1033: 'CLOSED' },
      tags: {
        session_01TAGGED0000000000000: ['task-1033'],
        session_01OTHER00000000000000: ['task-1034'],
      },
      sessions: { session_01TAGGED0000000000000: 'SESSION_STATUS_RUNNING' },
    });

    expect(result.lines).toEqual([
      'MERGED 1000',
      'CLOSED 1033',
      'ARCHIVED session_01TAGGED0000000000000',
      'SYNCED deadbee',
    ]);
    expect(result.archived).toEqual(['session_01TAGGED0000000000000']);
    expect(result.status).toBe(0);
  });

  // 相談役は issue を持たず、PRを何本も出す。PR1本のマージで畳むと、ユーザーが話している窓口が
  // 閉じる（2026-08-30 に PR #1240 のマージで実際に畳んでしまった）。
  it('issue を持たないセッションは、PRがマージされても畳まない', () => {
    const result = run({
      body: '_[Claude Code](https://claude.ai/code/session_01ADVISER000000000000)_',
      sessions: { session_01ADVISER000000000000: 'SESSION_STATUS_RUNNING' },
      tags: { session_01ADVISER000000000000: ['adviser-parallel-agents'] },
    });

    expect(result.lines).toEqual(['MERGED 1000', 'KEPT session_01ADVISER000000000000', 'SYNCED deadbee']);
    expect(result.archived).toEqual([]);
    expect(result.status).toBe(0);
  });

  // レビューのセッションはPRを出さないので `session-of-pr.sh` では引けず、`review-` のタグで引く。
  // PRが閉じれば読む相手が無くなるので、ここがこのPRの分を畳む最後の場所。
  it('マージしたら、そのPRのレビューのセッションも畳む', () => {
    const result = run({
      tags: {
        session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'],
        session_01REVIEWBBBBBBBBBBBBBB: ['review-1000'],
        // 直す側。こちらは `task-` のタグで引く別の経路が畳む（この試験では脚注が指していない）。
        session_01TASKAAAAAAAAAAAAAAAA: ['task-1000'],
      },
    });

    expect(result.lines).toEqual([
      'MERGED 1000',
      'ARCHIVED session_01REVIEWAAAAAAAAAAAAAA',
      'ARCHIVED session_01REVIEWBBBBBBBBBBBBBB',
      'SYNCED deadbee',
    ]);
    expect(result.archived).toEqual(['session_01REVIEWAAAAAAAAAAAAAA', 'session_01REVIEWBBBBBBBBBBBBBB']);
    expect(result.status).toBe(0);
  });

  // 掃く範囲がこのPRの分だけだと、`判断待ち`／`直し待ち` で止まったPR——次の投入もマージも来ない
  // PR——のレビューが永久に残る（2026-08-30 に16本溜まった）。**畳める理由はPRごとに違わない**ので、
  // マージのついでに全部を渡す。開いているPRのぶんは走行中なら守る。
  it('マージのついでに、別のPRのレビューも畳む', () => {
    const result = run({
      // 1001 は開いたまま止まっているPR。1002 は投入もマージも通らずに閉じたPR。
      openPrs: [1000, 1001],
      sessions: {
        session_01REVIEWAAAAAAAAAAAAAA: 'SESSION_STATUS_IDLE',
        session_01REVIEWWORKING00000: 'SESSION_STATUS_RUNNING',
        session_01REVIEWIDLE00000000: 'SESSION_STATUS_IDLE',
      },
      tags: {
        session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'],
        session_01REVIEWWORKING00000: ['review-1001'],
        session_01REVIEWIDLE00000000: ['review-1002'],
      },
      working: ['session_01REVIEWWORKING00000'],
    });

    expect(result.lines).toEqual([
      'MERGED 1000',
      'KEPT session_01REVIEWWORKING00000',
      'ARCHIVED session_01REVIEWAAAAAAAAAAAAAA',
      'ARCHIVED session_01REVIEWIDLE00000000',
      'SYNCED deadbee',
    ]);
    expect(result.status).toBe(0);
  });

  // `claude remote-control` が落ちている間にブリッジのセッションを畳むと、worktree がロックされた
  // まま残る。タグはクラウドと同じなので、環境IDでしか区別が付かない。
  it('ブリッジで立てたセッションは、レビューも直す側も畳まない', () => {
    const result = run({
      body: 'Closes #1033\n\n_[Claude Code](https://claude.ai/code/session_01BRIDGETASK00000000)_',
      issues: { 1033: 'CLOSED' },
      sessions: { session_01BRIDGETASK00000000: 'SESSION_STATUS_IDLE' },
      tags: {
        session_01BRIDGETASK00000000: ['task-1033'],
        session_01BRIDGEREVIEW000000: ['review-1000'],
        session_01CLOUDREVIEW0000000: ['review-1000'],
      },
      onBridge: ['session_01BRIDGETASK00000000', 'session_01BRIDGEREVIEW000000'],
    });

    expect(result.lines).toEqual([
      'MERGED 1000',
      'CLOSED 1033',
      'KEPT session_01BRIDGETASK00000000',
      'KEPT session_01BRIDGEREVIEW000000',
      'ARCHIVED session_01CLOUDREVIEW0000000',
      'SYNCED deadbee',
    ]);
    expect(result.archived).toEqual(['session_01CLOUDREVIEW0000000']);
    expect(result.status).toBe(0);
  });

  // 本文を書き直した拍子に脚注が落ちる（PR #1083 で実際に落ちた）。黙って畳まずに済ませると、
  // 走ったままのセッションが誰にも数えられずに残る。
  it('脚注もタグも無ければ、畳む相手が分からなかったことを残りとして報せる', () => {
    const result = run({ body: 'Closes #1033', issues: { 1033: 'CLOSED' } });

    expect(result.lines).toEqual(['MERGED 1000', 'CLOSED 1033', 'NOSESSION 1000', 'SYNCED deadbee']);
    expect(result.archived).toEqual([]);
    expect(result.status).toBe(2);
  });

  // 本文が脚注の**書き方を説明している**ことがある（このPR自身がそうだった）。
  it('脚注の書き方を引用しているだけの文字列は、畳む相手にしない', () => {
    const result = run({
      body: `末尾に \`https://claude.ai/code/session_...\` が入る。\n\n${DEFAULT_BODY}`,
    });

    expect(result.archived).toEqual([]);
    expect(result.lines).toEqual(['MERGED 1000', 'SYNCED deadbee']);
    expect(result.status).toBe(0);
  });

  // マージは済んでいるので、ここで落ちると `main` の追随ごと落ちる。
  it('畳めなかったときも止まらず、後片付けを済ませてから残りとして報せる', () => {
    const result = run({
      sessions: { session_01ZZZZZZZZZZZZZZZZZZZZZZ: 'SESSION_STATUS_RUNNING' },
      archiveFails: true,
    });

    expect(result.lines).toEqual([
      'MERGED 1000',
      'UNARCHIVED session_01ZZZZZZZZZZZZZZZZZZZZZZ',
      'SYNCED deadbee',
    ]);
    expect(result.status).toBe(2);
  });

  it('畳み済みのセッションは畳み直さない', () => {
    const result = run({
      body: 'https://claude.ai/code/session_01AAAAAAAAAAAAAAAAAAAAAA',
      sessions: { session_01AAAAAAAAAAAAAAAAAAAAAA: 'SESSION_STATUS_ARCHIVED' },
    });

    expect(result.archived).toEqual([]);
    expect(result.lines).toEqual(['MERGED 1000', 'SYNCED deadbee']);
  });

  // 畳み済みには何も言わない、は `archive-session.sh` が持つ出力の規約。issue を持たない相手を
  // 選り分ける側（このスクリプト）だけがそれを知らないと、同じ相手に片方だけが口を利く。
  it('畳み済みなら、issue を持たないセッションにも何も出さない', () => {
    const result = run({
      body: 'https://claude.ai/code/session_01ADVISER000000000000',
      sessions: { session_01ADVISER000000000000: 'SESSION_STATUS_ARCHIVED' },
      tags: { session_01ADVISER000000000000: ['adviser-parallel-agents'] },
    });

    expect(result.archived).toEqual([]);
    expect(result.lines).toEqual(['MERGED 1000', 'SYNCED deadbee']);
  });

  // 走行中を守ると `KEPT` として残るだけで、誰かがもう一度渡さない限り二度と畳まれない。**マージ済みの
  // PRへは、レビューの投入も次のマージも二度と来ない**——ここが渡す最後の機会なので、走行中でも畳む。
  // 判定を書き終えても読む相手（開いているPR）が無い、というのが守らない理由。
  it('マージのときは、走っている最中のセッションも畳む', () => {
    const result = run({
      body: 'Closes #1033\n\n_[Claude Code](https://claude.ai/code/session_01TASKAAAAAAAAAAAAAAAA)_',
      issues: { 1033: 'CLOSED' },
      sessions: {
        session_01TASKAAAAAAAAAAAAAAAA: 'SESSION_STATUS_RUNNING',
        session_01REVIEWAAAAAAAAAAAAAA: 'SESSION_STATUS_RUNNING',
      },
      tags: {
        session_01TASKAAAAAAAAAAAAAAAA: ['task-1033'],
        session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'],
      },
      working: ['session_01TASKAAAAAAAAAAAAAAAA', 'session_01REVIEWAAAAAAAAAAAAAA'],
    });

    expect(result.lines).toEqual([
      'MERGED 1000',
      'CLOSED 1033',
      'ARCHIVED session_01TASKAAAAAAAAAAAAAAAA',
      'ARCHIVED session_01REVIEWAAAAAAAAAAAAAA',
      'SYNCED deadbee',
    ]);
    expect(result.archived).toEqual(['session_01TASKAAAAAAAAAAAAAAAA', 'session_01REVIEWAAAAAAAAAAAAAA']);
  });

  // 作業ツリーは本体の `node_modules` を共有するので、本体が古いままだと版が食い違う。
  // `main` を動かしているのはこのスクリプトなので、ここで一緒に進める。
  it('マージしたら、本体のチェックアウトをブランチを持たせずに新しい main へ進める', () => {
    const result = run({});

    expect(result.git.some((call) => call.includes('fetch --quiet origin main'))).toBe(true);
    expect(result.git.some((call) => call.includes('checkout --quiet --detach origin/main'))).toBe(true);
    expect(result.installed).toBe(false);
    expect(result.status).toBe(0);
  });

  it('依存が変わったときだけ、本体で npm install する', () => {
    expect(run({ lockChanged: true }).installed).toBe(true);
    expect(run({ lockChanged: true }).lines).toContain('INSTALLED');
    expect(run({ lockChanged: false }).installed).toBe(false);
  });

  it('本体に依存が入っていなければ、変わっていなくても入れる', () => {
    expect(run({ mainInstalled: false }).installed).toBe(true);
  });

  it('本体に未コミットの変更があれば触らず、残りとして報せる', () => {
    const result = run({ mainDirty: true });

    expect(result.lines.some((line) => line.startsWith('DIRTY '))).toBe(true);
    expect(result.git.some((call) => call.includes('checkout'))).toBe(false);
    expect(result.installed).toBe(false);
    expect(result.status).toBe(2);
  });

  // 印を置くだけで、下ろすのは司令塔の手番。`watch-prs.sh` がこのラベルを見て `RELAY` を毎周出す。
  it('本文に `## 司令塔へ` があれば、司令塔へ ラベルを付けて RELAY を出す', () => {
    const result = run({ body: `${DEFAULT_BODY}\n\n## 司令塔へ\n\n- #1353 を立てた（範囲外）\n` });

    expect(result.lines).toContain('RELAY 1000');
    expect(result.labels).toContain('--add-label 司令塔へ');
  });

  // 「回されたものが無い」と「読み落とした」を、司令塔が区別できなくなる。
  it('節が無ければ、ラベルも RELAY も出さない', () => {
    const result = run({ body: `${DEFAULT_BODY}\n\n## 司令塔の案\n\n- 積ではなく加算で表す\n` });

    expect(result.lines.some((line) => line.startsWith('RELAY '))).toBe(false);
    expect(result.labels.some((label) => label.includes('司令塔へ'))).toBe(false);
  });

  // 書く口はPR本文とレビューのコメントの2つある（`review-prompt.md`）。読む口が1つだと、
  // レビューが回したものだけが黙って落ちる。**本文には節が無い世界で見る。**
  it('レビューのコメントの `## 司令塔へ` も拾う', () => {
    const result = run({
      comments: [
        '[レビュー] 通してよい\n\n## 司令塔へ\n\n- `parseActiveEffects.ts` の doc に同じ誤りが残っている\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_\n',
      ],
    });

    expect(result.lines).toContain('RELAY 1000');
    expect(result.labels).toContain('--add-label 司令塔へ');
  });

  // 回す側はレビューだけ。司令塔自身の指示やユーザーの却下を拾うと、下ろす相手の居ない印が残る。
  it('`[レビュー]` で始まらないコメントの節は拾わない', () => {
    const result = run({
      comments: ['[司令塔] 直し待ちにします。\n\n## 司令塔へ\n\n- これは回す側ではない\n'],
    });

    expect(result.lines.some((line) => line.startsWith('RELAY '))).toBe(false);
    expect(result.labels.some((label) => label.includes('司令塔へ'))).toBe(false);
  });

  // `## 仮決め` は「なし」と書かせる規約なので、書く側は取り違える。中身の無い印が残ると `RELAY` が
  // 毎周出て、合図が1件でも出た見張りはそこで終わる（他の待ちに使えなくなる）。
  it('節はあっても中身が「なし」なら、ラベルも RELAY も出さない', () => {
    const result = run({
      body: `${DEFAULT_BODY}\n\n## 司令塔へ\n\nなし（この変更自体が司令塔の道具への直し）。\n`,
    });

    expect(result.lines.some((line) => line.startsWith('RELAY '))).toBe(false);
    expect(result.labels.some((label) => label.includes('司令塔へ'))).toBe(false);
  });

  // 節を閉じるのが `##` の見出しだけだと、**本文の末尾に置かれた節がレビューのコメントへ伸びる**。
  // レビュー側はこの節をコメントの末尾に置く（`review-prompt.md`）ので、これは常に起きる。
  it('本文の末尾の節が「なし」なら、レビューのコメントが付いていてもラベルを付けない', () => {
    const result = run({
      body: `${DEFAULT_BODY}\n\n## 司令塔へ\n\nなし（この変更自体が司令塔の道具への直し）。\n`,
      comments: ['[レビュー] 通してよい\n\n本文の実測は自分でも数え直して一致した。\n'],
    });

    expect(result.lines.some((line) => line.startsWith('RELAY '))).toBe(false);
    expect(result.labels.some((label) => label.includes('司令塔へ'))).toBe(false);
  });

  // レビューのコメントには Claude Code の署名（`---` と `_Generated by …_`）が必ず付く。節の後ろに
  // 常に続くので、署名を節の中身と数えると**レビュー側では「なし」の判定が一度も働かない**。
  it('レビューが「なし」と書いたら、後ろに署名が続いてもラベルを付けない', () => {
    const result = run({
      comments: [
        '[レビュー] 通してよい\n\n## 司令塔へ\n\nなし。\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_\n',
      ],
    });

    expect(result.lines.some((line) => line.startsWith('RELAY '))).toBe(false);
    expect(result.labels.some((label) => label.includes('司令塔へ'))).toBe(false);
  });

  // コメントどうしの境目も同じ。1本に繋いで読むと、末尾に節を置いたコメントの節が次のコメントへ
  // 伸びる。繋ぎ目の綴りで塞ぐ形だと、綴りが片側だけずれてもここが緑のまま通ってしまう。
  it('コメントの末尾の節が「なし」なら、後ろに別のコメントが続いてもラベルを付けない', () => {
    const result = run({
      comments: [
        '[レビュー] 通してよい\n\n## 司令塔へ\n\nなし。\n',
        '[レビュー] 通してよい\n\n差分を読み直したが、他に直すところは無い。\n',
      ],
    });

    expect(result.lines.some((line) => line.startsWith('RELAY '))).toBe(false);
    expect(result.labels.some((label) => label.includes('司令塔へ'))).toBe(false);
  });

  // 1件ずつ読むので、読み落とせば**後ろのコメントだけ**が黙って落ちる。
  it('2件目以降のレビューのコメントの `## 司令塔へ` も拾う', () => {
    const result = run({
      comments: [
        '[レビュー] 通してよい\n\n## 司令塔へ\n\nなし。\n',
        '[レビュー] 通してよい\n\n## 司令塔へ\n\n- #1353 を立てた（範囲外）\n',
      ],
    });

    expect(result.lines).toContain('RELAY 1000');
    expect(result.labels).toContain('--add-label 司令塔へ');
  });

  // マージは済んでいるので、印を置けなかっただけで後片付け（`main` の追随）ごと落としてはいけない。
  it('印を置けなくても止まらず、後片付けを済ませてから残りとして報せる', () => {
    const result = run({
      body: `${DEFAULT_BODY}\n\n## 司令塔へ\n\n- #1353 を立てた（範囲外）\n`,
      labelFails: true,
    });

    expect(result.lines).toContain('UNRELAYED 1000');
    expect(result.lines.some((line) => line.startsWith('SYNCED '))).toBe(true);
    expect(result.status).toBe(2);
  });
});

/**
 * マージのときと対になる、**PRが開いているとき**の経路（`dispatch-review.sh` が次を立てる直前に呼ぶ）。
 * 上の `describe` と同じ世界を使う——`gh pr merge` を呼ばないので `state` は `OPEN` のまま。
 */
describe('archive-reviews.sh', () => {
  // ここで畳むと、書きかけの判定はコメントに出ないまま消える。守っても、次の投入かマージで
  // もう一度渡されるので取りこぼしにはならない——**これが成り立つのはPRが開いている間だけ**。
  it('PRが開いている間は、走っている最中のレビューを守る', () => {
    const result = run(
      {
        sessions: {
          session_01REVIEWAAAAAAAAAAAAAA: 'SESSION_STATUS_RUNNING',
          session_01REVIEWBBBBBBBBBBBBBB: 'SESSION_STATUS_IDLE',
        },
        tags: {
          session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'],
          session_01REVIEWBBBBBBBBBBBBBB: ['review-1000'],
        },
        working: ['session_01REVIEWAAAAAAAAAAAAAA'],
      },
      [ARCHIVE_REVIEWS],
    );

    expect(result.lines).toEqual([
      'KEPT session_01REVIEWAAAAAAAAAAAAAA',
      'ARCHIVED session_01REVIEWBBBBBBBBBBBBBB',
    ]);
    expect(result.archived).toEqual(['session_01REVIEWBBBBBBBBBBBBBB']);
    expect(result.status).toBe(0);
  });

  // 掃く範囲を「呼ばれた瞬間のPR1本」に絞ると、**次の投入もマージも来ないPR**のレビューが永久に
  // 残る。開いていないPRのぶんは、走行中でも畳む——判定を書き終えても読む相手が無い。
  it('開いていないPRのレビューは、走っている最中でも畳む', () => {
    const result = run(
      {
        openPrs: [1000],
        sessions: {
          session_01REVIEWAAAAAAAAAAAAAA: 'SESSION_STATUS_RUNNING',
          session_01REVIEWCLOSED000000: 'SESSION_STATUS_RUNNING',
        },
        tags: {
          session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'],
          session_01REVIEWCLOSED000000: ['review-1001'],
        },
        working: ['session_01REVIEWAAAAAAAAAAAAAA', 'session_01REVIEWCLOSED000000'],
      },
      [ARCHIVE_REVIEWS],
    );

    expect(result.lines).toEqual([
      'KEPT session_01REVIEWAAAAAAAAAAAAAA',
      'ARCHIVED session_01REVIEWCLOSED000000',
    ]);
    expect(result.status).toBe(0);
  });

  // 状態を引けない日に「開いていない」へ倒れると、書きかけの判定を畳んでしまう。畳んで消えた
  // コメントは戻せないが、守って残ったものは手で畳める。畳むのは「閉じていると分かったとき」だけ。
  it('開いているPRの一覧を引けなかったときも、走っている最中のレビューを守る', () => {
    const result = run(
      {
        prListFails: true,
        sessions: { session_01REVIEWAAAAAAAAAAAAAA: 'SESSION_STATUS_RUNNING' },
        tags: { session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'] },
        working: ['session_01REVIEWAAAAAAAAAAAAAA'],
      },
      [ARCHIVE_REVIEWS],
    );

    expect(result.lines).toEqual(['KEPT session_01REVIEWAAAAAAAAAAAAAA']);
    expect(result.archived).toEqual([]);
    expect(result.status).toBe(0);
  });

  // 「引けなかった」と「1本も開いていない」を空かどうかで分けると、最後の1本をマージした直後が
  // 引けなかった日と同じ扱いになり、そのPRのレビューが `KEPT` のまま残る。分けるのは終了コード。
  it('開いているPRが1本も無いときは、引けなかった日とは違って畳む', () => {
    const result = run(
      {
        openPrs: [],
        sessions: { session_01REVIEWAAAAAAAAAAAAAA: 'SESSION_STATUS_RUNNING' },
        tags: { session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'] },
        working: ['session_01REVIEWAAAAAAAAAAAAAA'],
      },
      [ARCHIVE_REVIEWS],
    );

    expect(result.lines).toEqual(['ARCHIVED session_01REVIEWAAAAAAAAAAAAAA']);
    expect(result.status).toBe(0);
  });

  // 引けなければ、走行中かもブリッジかも分からない。空の応答から全部のキーが `""` に落ちるので、
  // 何も書かなければ「走行中でもブリッジでもない」＝畳む側へ倒れる。上と同じ理由で守る側にする。
  it('セッションを引けなかったときは畳まない', () => {
    const result = run(
      {
        tags: { session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'] },
        unknown: ['session_01REVIEWAAAAAAAAAAAAAA'],
      },
      [ARCHIVE_REVIEWS],
    );

    expect(result.lines).toEqual(['KEPT session_01REVIEWAAAAAAAAAAAAAA']);
    expect(result.archived).toEqual([]);
    expect(result.status).toBe(0);
  });

  // `list_sessions` の `limit` は上限100なので、それより古いものは `has_more`／`last_id` を繰らないと
  // 届かない。1ページで済ませると**古いものほど掃かれない**——実測（2026-08-30）で全715件・8ページ、
  // 1ページ目に見えた生きたレビューは4本、繰った先に35本残っていた。
  it('1ページ目に収まらない古いレビューも畳む', () => {
    const result = run(
      {
        sessions: {
          session_01REVIEWNEW000000000: 'SESSION_STATUS_IDLE',
          session_01REVIEWOLD000000000: 'SESSION_STATUS_IDLE',
        },
        tags: { session_01REVIEWNEW000000000: ['review-1000'] },
        olderTags: { session_01REVIEWOLD000000000: ['review-1000'] },
      },
      [ARCHIVE_REVIEWS],
    );

    expect(result.lines).toEqual([
      'ARCHIVED session_01REVIEWNEW000000000',
      'ARCHIVED session_01REVIEWOLD000000000',
    ]);
    expect(result.status).toBe(0);
  });

  // 畳み済みも `list_sessions` に残る（実測で73件中59件）。渡すと `get_session` を打つだけ打って
  // 何も出さないので、ここで外す。
  it('畳み済みのレビューには `get_session` を打たない', () => {
    const result = run(
      {
        sessions: {
          session_01REVIEWDONE00000000: 'SESSION_STATUS_ARCHIVED',
          session_01REVIEWBBBBBBBBBBBBBB: 'SESSION_STATUS_IDLE',
        },
        tags: {
          session_01REVIEWDONE00000000: ['review-1000'],
          session_01REVIEWBBBBBBBBBBBBBB: ['review-1000'],
        },
      },
      [ARCHIVE_REVIEWS],
    );

    expect(result.lines).toEqual(['ARCHIVED session_01REVIEWBBBBBBBBBBBBBB']);
    expect(result.probed).toEqual(['session_01REVIEWBBBBBBBBBBBBBB']);
    expect(result.status).toBe(0);
  });
});
