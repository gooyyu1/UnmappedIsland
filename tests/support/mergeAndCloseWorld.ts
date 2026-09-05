import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { vi } from 'vitest';

/**
 * `scripts/agent/merge-and-close.sh` を実際に走らせるための世界。
 *
 * `gh`・`git`・`npm` を PATH の先頭に、`ccr-meta.sh` を `CCR_META` で差し替える。本体（`git` が差す先）
 * も作業用の一時ディレクトリに作るので、手元のリポジトリは動かない。
 *
 * **1回の実行で外部プロセスが約80個起きる**（スタブがさらに `jq` を呼ぶため）。Windowsではプロセス
 * 生成が1回10〜30msかかるので、これを叩く試験は1件あたり1.6秒前後になる。**1ファイルに詰め込むと
 * vitest のワーカーが本体へ返す `onTaskUpdate` の60秒を超えて落ちる**——同期の `execFileSync` が
 * イベントループを止めるので、本体からの返事を受け取る前にタイマーが鳴る。だから叩く側は責務ごとに
 * ファイルを分けてある。
 *
 * スタブのシェバングが `#!/bin/bash` なのも同じ理由。`#!/usr/bin/env bash` だと1回ごとに `env` の
 * プロセスが1つ増える。
 */

// 全件が実プロセス（bash + git + gh のスタブ）を起こすため、既定の5秒だと `npm test` 全体を並行実行
// したときのCPU競合だけで時間切れになりうる。**叩く側ではなくここが持つ**——世界がプロセスを起こす
// ことを知っているのはこちらで、叩く側は毎回それを覚えていなくてよい。
vi.setConfig({ testTimeout: 20000 });

const SCRIPT = resolve(__dirname, '../../scripts/agent/merge-and-close.sh');
/** 同じ世界で叩ける後片付けの片割れ。こちらはPRが**開いている**ときの経路を持つ。 */
export const ARCHIVE_REVIEWS = resolve(__dirname, '../../scripts/agent/archive-reviews.sh');

/** `ccr-env.sh` へ環境変数で渡す身代わり。実物のIDは試験に書き写さない。 */
const CLOUD = 'env_TEST_CLOUD';
const BRIDGE = 'env_TEST_BRIDGE';

/**
 * 脚注の無い本文は `NOSESSION` を出すので、脚注の話でない試験には既定でこれを持たせる。
 * 指す先は畳み済みなので、`ARCHIVED` の行も増えない。
 */
export const DEFAULT_BODY = '_[Claude Code](https://claude.ai/code/session_01ZZZZZZZZZZZZZZZZZZZZZZ)_';

export interface World {
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
  /** PRに付いているコメント。`## ユーザーへ` をレビューから拾えるかを見るために使う。 */
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
  /** このPRの head を base にしている開いたPR（＝上に積まれたPR）。 */
  readonly stacked?: readonly number[];
  /** `gh pr edit --base` が失敗するか。 */
  readonly retargetFails?: boolean;
  /** マージ済みのブランチが既に消えているか。既定は残っている。 */
  readonly branchGone?: boolean;
  /** そのブランチを消す `gh api -X DELETE` が失敗するか。 */
  readonly deleteFails?: boolean;
  /** `--user-ok` を付けて叩くか。 */
  readonly userOk?: boolean;
}

export interface Run {
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
  /** `gh api -X DELETE` に渡された参照。 */
  readonly deleted: string[];
}

/**
 * 世界を組んで叩く。`entry` を渡すと `merge-and-close.sh` 以外を同じ世界で叩ける——`gh` のスタブは
 * `gh pr merge` が呼ばれるまで `state` に `OPEN` を返すので、**PRが開いている経路**はこれでしか試せない。
 */
export function run(world: World, entry: readonly string[] = [SCRIPT, '1000']): Run {
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
      `#!/bin/bash
if [ "$1" = pr ] && [ "$2" = merge ]; then
  touch '${dir}/merged'
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = view ]; then
  case "$5" in
    body|comments) jq -r "\${@: -1}" '${dir}/pr.json' ;;
    mergeable) printf '%s' '${world.mergeable ?? 'MERGEABLE'}' ;;
    headRefName) printf '%s' 'claude/issue-999' ;;
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
  case "$*" in
    *--base*)
      for n in $(printf '%s' '${(world.stacked ?? []).join(' ')}'); do printf '%s\\n' "$n"; done
      exit 0 ;;
  esac
  for n in $(printf '%s' '${(world.openPrs ?? [1000]).join(' ')}'); do
    if [ "$n" = 1000 ] && [ -e '${dir}/merged' ]; then continue; fi
    printf '%s\\n' "$n"
  done
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = edit ]; then
  shift 3
  case "$*" in
    *--base*) exit ${world.retargetFails ? 1 : 0} ;;
  esac
  echo "$*" >> '${dir}/labels'
  exit ${world.labelFails ? 1 : 0}
fi
if [ "$1" = api ]; then
  case "$*" in
    *DELETE*)
      echo "\${@: -1}" >> '${dir}/deleted'
      exit ${world.deleteFails === true ? 1 : 0} ;;
  esac
  exit ${world.branchGone === true ? 1 : 0}
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
      `#!/bin/bash
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
    writeFileSync(npm, `#!/bin/bash\necho "$*" >> '${dir}/npm-calls'\n`, 'utf-8');
    chmodSync(npm, 0o755);

    // 関門。理由が1件でもあれば 0（＝該当あり）を返す。`needs-user-review.sh` と同じ約束。
    const gate = join(work, 'needs-user-review.sh');
    writeFileSync(
      gate,
      `#!/bin/bash\n${(world.gate ?? []).map((line) => `echo '${line}'`).join('\n')}\nexit ${
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
      `#!/bin/bash
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
      deleted: logged('deleted'),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
