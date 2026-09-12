import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { vi } from 'vitest';

import { pathForBash, runScript } from './runScript';
import { STUB_SHEBANG } from './stubShebang';

/**
 * `scripts/agent/tidy-merged-pr.sh` を実際に走らせるための世界。
 *
 * `gh`・`git`・`npm` を PATH の先頭に置く。本体（`git` が差す先）も作業用の一時ディレクトリに作るので、
 * 手元のリポジトリは動かない。
 *
 * **1回の実行で外部プロセスが数十個起きる**（スタブがさらに `jq` を呼ぶため）。Windowsではプロセス
 * 生成が1回10〜30msかかるので、これを叩く試験は1件あたり1.6秒前後になる（2026-08 に測ったとき）。
 * **1ファイルに詰め込むと vitest のワーカーが本体へ返す `onTaskUpdate` の60秒を超えて落ちる**
 * ——同期の `execFileSync` がイベントループを止めるので、本体からの返事を受け取る前にタイマーが鳴る。
 * だから叩く側は責務ごとにファイルを分けてある。
 *
 * 身代わりの先頭の1行を直に書かず [`STUB_SHEBANG`](stubShebang.ts) から取るのも同じ理由。
 */

// 全件が実プロセス（bash + git + gh のスタブ）を起こすため、既定の5秒だと `npm test` 全体を並行実行
// したときのCPU競合だけで時間切れになりうる。**叩く側ではなくここが持つ**——世界がプロセスを起こす
// ことを知っているのはこちらで、叩く側は毎回それを覚えていなくてよい。
vi.setConfig({ testTimeout: 20000 });

const SCRIPT = resolve(__dirname, '../../scripts/agent/tidy-merged-pr.sh');

/** 後片付けするPRのブランチ。積まれていたPRの `oldBase` はこれと突き合わされる。 */
export const HEAD = 'claude/issue-999';

/**
 * 実物のPR本文の末尾に Claude Code が付ける脚注。**この道具が本文から読むのは `Closes #N` だけ**
 * なので、既定の本文はこれで足りる。`Closes` を持つ世界でも末尾に置いて、実物の並びに寄せる。
 */
export const DEFAULT_BODY = '_[Claude Code](https://claude.ai/code/session_01ZZZZZZZZZZZZZZZZZZZZZZ)_';

/** GitHub が張り替えた時刻の既定。押し返しの既定（`PUSHED`）より後。 */
export const RETARGETED = '2026-09-10T12:00:00Z';
/** 積まれたPRの先頭コミットの既定。 */
export const PUSHED = '2026-09-10T11:00:00Z';

/**
 * 失敗した `gh`・`git` が標準エラーへ書く理由。**身代わりにも言わせる**——黙って転ぶ身代わりでは、
 * 理由を落とす実装がそのまま緑で通る。複数行のものが混じるのは、**1行1件**の出力へ畳めていることを
 * 叩く側から見るため。
 */
export const REFUSALS = {
  stacked: 'gh: Something went wrong while executing your query. (HTTP 502)\nTry again later.',
  note: 'gh: Unable to create comment. Issue is locked. (HTTP 403)',
  sendBack: 'gh: Resource not accessible by integration (HTTP 403)',
  checkout:
    'error: The following untracked working tree files would be overwritten by checkout:\n' +
    '  agent-ops/decisions/x.md\nPlease move or remove them before you switch branches.\nAborting',
} as const;

/** 身代わりが理由を吐いて転ぶところ。失敗しない世界では、何も言わずに通す。 */
function refuse(fails: boolean | undefined, refusal: string): string {
  return fails === true ? `printf '%s\\n' '${refusal}' >&2; exit 1` : 'true';
}

/** 開いているPR1本ぶん。GraphQL がこの形で返す（`tidy-merged-pr.sh` の `STACKED_QUERY`）。 */
export interface OpenPr {
  readonly number: number;
  /** GitHub が張り替える前の base。省くと張り替えの記録が無い（＝積まれていなかった）。 */
  readonly oldBase?: string;
  /** 張り替えが記録された時刻。 */
  readonly retargetedAt?: string;
  /** 先頭コミットの時刻。既定は張り替えより前（＝まだ押し返されていない）。 */
  readonly pushedAt?: string;
  readonly labels?: readonly string[];
}

export interface World {
  readonly body?: string;
  /** PRの `state`。既定はマージ済み。 */
  readonly state?: string;
  /** issue番号ごとの `state`。 */
  readonly issues?: Record<number, string>;
  /** 本体に未コミットの変更（追跡済み）があるか。 */
  readonly mainDirty?: boolean;
  /** 本体を進める `git checkout` が失敗するか（未追跡のものが妨げになった場合など）。 */
  readonly checkoutFails?: boolean;
  /** マージで `package-lock.json` が変わったか。 */
  readonly lockChanged?: boolean;
  /** 本体に依存が入っているか。既定は入っている。 */
  readonly mainInstalled?: boolean;
  /** 開いているPR。GraphQL がこのまま返る。 */
  readonly open?: readonly OpenPr[];
  /** 開いているPRを引く GraphQL が失敗するか（＝張り替えられたPRが在るかどうかが分からない）。 */
  readonly stackedUnknown?: boolean;
  /** 差し戻す理由を残す `gh pr comment` が失敗するか。 */
  readonly noteFails?: boolean;
  /** `直し待ち` を付ける `gh pr edit` が失敗するか。 */
  readonly sendBackFails?: boolean;
}

export interface Run {
  readonly lines: string[];
  readonly status: number;
  /** 本体で `npm install` が走ったか。 */
  readonly installed: boolean;
  /** `git` に渡された引数。 */
  readonly git: string[];
  /** `gh pr edit` に渡されたラベルの操作。 */
  readonly labels: string[];
  /** PRへ書いたコメントの本文。 */
  readonly comments: string;
}

/** GraphQL の返り。**絞り込みは真似ない**——`--jq` の式は下のスタブが本物の `jq` へ渡す。 */
function graphql(open: readonly OpenPr[]): string {
  return JSON.stringify({
    data: {
      repository: {
        pullRequests: {
          nodes: open.map((pr) => ({
            number: pr.number,
            labels: { nodes: (pr.labels ?? []).map((name) => ({ name })) },
            commits: { nodes: [{ commit: { committedDate: pr.pushedAt ?? PUSHED } }] },
            timelineItems: {
              nodes:
                pr.oldBase === undefined
                  ? []
                  : [{ oldBase: pr.oldBase, createdAt: pr.retargetedAt ?? RETARGETED }],
            },
          })),
        },
      },
    },
  });
}

/** 世界を組んで叩く。 */
export function run(world: World): Run {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-tidy-merged-pr-'));
  try {
    const dir = pathForBash(work);
    // `gh pr view --json` が返すものを、そのままの形で持たせる（改行もバッククォートも含むので、
    // シェルへ埋め込まずファイルで渡す）。**絞り込みも符号化もここでは真似ない**——`--jq` の式は下の
    // スタブが本物の `jq` へ渡す。スタブが真似ると、式だけを変えても試験は緑のまま通る。
    writeFileSync(join(work, 'pr.json'), JSON.stringify({ body: world.body ?? DEFAULT_BODY }), 'utf-8');
    writeFileSync(join(work, 'graphql.json'), graphql(world.open ?? []), 'utf-8');

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

    // **束ねて引かれたときは、絞り込まずに丸ごと返す**——本物の `gh` と同じで、選ぶのも符号化するのも
    // 呼び手の `jq`。GraphQL のぶんは `--jq` の式をそのまま本物の `jq` へ渡す（**gh 内蔵の `jq` は
    // Windowsでも LF を出す**ので、外部 `jq` の CRLF はここで落とす）。
    const stub = join(work, 'gh');
    writeFileSync(
      stub,
      `${STUB_SHEBANG}
if [ "$1" = api ] && [ "$2" = graphql ]; then
  ${refuse(world.stackedUnknown, REFUSALS.stacked)}
  filter='.'
  while [ "$#" -gt 0 ]; do
    if [ "$1" = --jq ]; then filter="$2"; fi
    shift
  done
  jq -r "$filter" '${dir}/graphql.json' | tr -d '\\r'
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = view ]; then
  jq '. + {state: "${world.state ?? 'MERGED'}", headRefName: "${HEAD}"}' '${dir}/pr.json'
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = edit ]; then
  shift 3
  echo "$*" >> '${dir}/labels'
  ${refuse(world.sendBackFails, REFUSALS.sendBack)}
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = comment ]; then
  ${refuse(world.noteFails, REFUSALS.note)}
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
  *'status --porcelain'*) printf '%s' '${world.mainDirty === true ? ' M docs/x.md\n M src/y.ts' : ''}' ;;
  *'HEAD:package-lock.json'*)
    if [ -e '${dir}/checked-out' ]; then printf '%s' '${world.lockChanged === true ? 'bbb222' : 'aaa111'}'
    else printf '%s' 'aaa111'; fi ;;
  *'rev-parse --short HEAD'*) printf '%s' 'deadbee' ;;
  *checkout*) ${refuse(world.checkoutFails, REFUSALS.checkout)}; touch '${dir}/checked-out' ;;
esac
exit 0
`,
      'utf-8',
    );
    chmodSync(git, 0o755);

    const npm = join(work, 'npm');
    writeFileSync(npm, `${STUB_SHEBANG}\necho "$*" >> '${dir}/npm-calls'\n`, 'utf-8');
    chmodSync(npm, 0o755);

    let status = 0;
    let out = '';
    try {
      out = runScript(SCRIPT, ['1000'], {
        env: { ...process.env, PATH: `${work}${delimiter}${process.env.PATH ?? ''}` },
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
      installed: logged('npm-calls').length > 0,
      git: logged('git-calls'),
      labels: logged('labels'),
      comments: existsSync(join(work, 'comments')) ? readFileSync(join(work, 'comments'), 'utf-8') : '',
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
