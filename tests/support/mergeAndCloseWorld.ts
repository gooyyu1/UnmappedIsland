import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { vi } from 'vitest';

import { STUB_SHEBANG } from './stubShebang';

/**
 * `scripts/agent/merge-and-close.sh` を実際に走らせるための世界。
 *
 * `gh`・`git`・`npm` を PATH の先頭に、関門を `NEEDS_USER_REVIEW` で差し替える。本体（`git` が差す先）
 * も作業用の一時ディレクトリに作るので、手元のリポジトリは動かない。
 *
 * **1回の実行で外部プロセスが数十個起きる**（スタブがさらに `jq` を呼ぶため）。Windowsではプロセス
 * 生成が1回10〜30msかかるので、これを叩く試験は1件あたり1.6秒前後になる（2026-08 に測ったとき）。
 * **1ファイルに詰め込むと
 * vitest のワーカーが本体へ返す `onTaskUpdate` の60秒を超えて落ちる**——同期の `execFileSync` が
 * イベントループを止めるので、本体からの返事を受け取る前にタイマーが鳴る。だから叩く側は責務ごとに
 * ファイルを分けてある。
 *
 * 身代わりの先頭の1行を直に書かず [`STUB_SHEBANG`](stubShebang.ts) から取るのも同じ理由。
 */

// 全件が実プロセス（bash + git + gh のスタブ）を起こすため、既定の5秒だと `npm test` 全体を並行実行
// したときのCPU競合だけで時間切れになりうる。**叩く側ではなくここが持つ**——世界がプロセスを起こす
// ことを知っているのはこちらで、叩く側は毎回それを覚えていなくてよい。
vi.setConfig({ testTimeout: 20000 });

const SCRIPT = resolve(__dirname, '../../scripts/agent/merge-and-close.sh');

/**
 * 実物のPR本文の末尾に Claude Code が付ける脚注。**この道具はセッションを引かない**
 * （`board-design.md` 2.10）ので、`## ユーザーへ` の節より前に置く中身としてだけ要る。
 */
export const DEFAULT_BODY = '_[Claude Code](https://claude.ai/code/session_01ZZZZZZZZZZZZZZZZZZZZZZ)_';

export interface World {
  readonly mergeable?: string;
  readonly body?: string;
  /** issue番号ごとの `state`。 */
  readonly issues?: Record<number, string>;
  /** PRに付いているコメント。`## ユーザーへ` をレビューから拾えるかを見るために使う。 */
  readonly comments?: readonly string[];
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

/** 世界を組んで叩く。 */
export function run(world: World): Run {
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

    // PRの `state` は、マージが呼ばれたかで変わる。**束ねて引かれたときは、絞り込まずに丸ごと返す**
    // ——本物の `gh` と同じで、選ぶのも符号化するのも呼び手の `jq`。ここが真似ると、式だけを変えても
    // 試験は緑のまま通る。
    const stub = join(work, 'gh');
    writeFileSync(
      stub,
      `${STUB_SHEBANG}
if [ "$1" = pr ] && [ "$2" = merge ]; then
  touch '${dir}/merged'
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = view ]; then
  if [ -e '${dir}/merged' ]; then state=MERGED; else state=OPEN; fi
  case "$5" in
    mergeable) printf '%s' '${world.mergeable ?? 'MERGEABLE'}' ;;
    state) printf '%s' "$state" ;;
    *) jq --arg state "$state" '. + {state: $state, headRefName: "claude/issue-999"}' '${dir}/pr.json' ;;
  esac
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = list ]; then
  for n in $(printf '%s' '${(world.stacked ?? []).join(' ')}'); do printf '%s\\n' "$n"; done
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
      `${STUB_SHEBANG}
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
    writeFileSync(npm, `${STUB_SHEBANG}\necho "$*" >> '${dir}/npm-calls'\n`, 'utf-8');
    chmodSync(npm, 0o755);

    // 関門。理由が1件でもあれば 0（＝該当あり）を返す。`needs-user-review.sh` と同じ約束。
    const gate = join(work, 'needs-user-review.sh');
    writeFileSync(
      gate,
      `${STUB_SHEBANG}\n${(world.gate ?? []).map((line) => `echo '${line}'`).join('\n')}\nexit ${
        world.gateStatus ?? ((world.gate ?? []).length > 0 ? 0 : 1)
      }\n`,
      'utf-8',
    );

    let status = 0;
    let out = '';
    try {
      out = execFileSync('bash', [SCRIPT, '1000', ...(world.userOk === true ? ['--user-ok'] : [])], {
        encoding: 'utf-8',
        env: {
          ...process.env,
          PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
          NEEDS_USER_REVIEW: gate,
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
