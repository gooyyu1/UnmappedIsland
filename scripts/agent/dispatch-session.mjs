// セッションを1本立てて、届いたことを確かめるところまでを、1つの node の中で済ませる。
//
//   node scripts/agent/dispatch-session.mjs task --env env_… --tag task-1029 \
//     --issue 1029 --issue-json <gh の出力> --prompt <送る本文>
//
// **入口は [`dispatch-steps.sh`](dispatch-steps.sh) の `dispatch_session`。** 呼び方・出る行・
// 投入する前の関門はそちら。**投入するものごとに違うのは、題と、リポジトリのどのリビジョンで
// 起こすかだけ**なので、そこだけを種類で割る。
//
// ## なぜ1つの node に入れるのか
//
// 引数の組み立て（`node -e`）と通信（`bash ccr-meta.sh` → `node ccr-meta.mjs`）を分けると、投入1回
// あたり node が2つ以上起きる。Windowsでは `node` の起動だけで1回44.5msかかるので、境界の数が
// そのまま常時の固定費になる（[`ccr-meta.mjs`](../../.claude/ccr-meta.mjs)「node から呼ぶ側は」）。
//
// **題も本文もシェルの文字列にしない**という約束は変わらない。危ないのは文字の符号ではなく
// **シェルの展開**なので（[`ccr-meta.sh`](../../.claude/ccr-meta.sh)「指示は Write で書く」）、
// `gh` の出力も送る本文もファイルのまま受け取って、ここで読む。

import { readFileSync, writeFileSync } from 'node:fs';

import { callMeta, metaJson } from '../../.claude/ccr-meta.mjs';
import { checkPrompt } from '../../.claude/ccr-check-prompt.mjs';
import { readVersion, verdicts } from './review-verdicts.mjs';

/** `--<名前> <値>` だけを受ける。**旗（値の無い引数）を作らない**ので、読む側に場合分けが要らない。 */
function options(argv) {
  const found = {};
  for (let at = 0; at < argv.length; at += 2) {
    if (!argv[at].startsWith('--')) throw new Error(`--<名前> <値> の形でない引数: ${argv[at]}`);
    found[argv[at].slice(2)] = argv[at + 1] ?? '';
  }
  return found;
}

/**
 * 投入するものごとに違う分。**題は頭の語で種類が分かる形**（`.claude/board-design.md` 2.9）で、
 * `revision` は起こすリビジョン。
 */
const KINDS = {
  task: (given) => ({
    title: `作業 #${given.issue} ${JSON.parse(readFileSync(given['issue-json'], 'utf8')).title.trim()}`,
    revision: 'main',
  }),

  // レビューは**送る本文をここで作る**——埋める値（下の `previous`）がここでしか出せない。
  review: (given) => {
    const info = JSON.parse(readFileSync(given['pr-json'], 'utf8'));
    const written = verdicts(info.comments);
    // 何回目の判定になるはずか。**数えて出すので状態を持たない。** 判定を書かずに落ちたレビューは
    // 数に入らず、次の1本が同じ番号を名乗る。
    const round = written.length + 1;
    // 前の周が読んだ版（`review-prompt.md`「読んだ版」の節）。**盤面の指紋では引かない**——あちらは
    // 投入するたびに動くので、判定を書かずに落ちた周のぶんだけ進み、次の1本が読んでいない範囲を
    // 「前の周が見た」ことにしてしまう。数と版が同じコメントから出れば、その食い違いが起きない。
    const previous = readVersion(written.at(-1)) ?? 'なし';
    writeFileSync(
      given.prompt,
      readFileSync(given.template, 'utf8').replaceAll('<番号>', given.pr).replaceAll('<前の版>', previous),
    );
    return {
      title: `レビュー #${given.pr}:${round} ${info.title.trim()}`,
      // **`main` ではなくPRのブランチで起動する**（`dispatch-review.sh` の同名の節）。
      revision: info.headRefName,
    };
  },

  chore: (given) => ({ title: readFileSync(given.title, 'utf8').trim(), revision: 'main' }),
};

/** `DRY_RUN` が見せる引数。**本文は頭だけに切る**——`full` なら切らない（`dispatch-steps.sh`）。 */
function dryRun(args, how) {
  const shown =
    how === 'full' ? args : { ...args, prompt: `${args.prompt.split('\n').slice(0, 3).join('\n')}\n…` };
  console.log(JSON.stringify(shown, null, 2));
}

/** 立てて、確かめる。**返すのは終了コード。** */
async function dispatch(kind, given) {
  const build = KINDS[kind];
  if (build === undefined) throw new Error(`知らない種類: ${kind}`);
  const { title, revision } = build(given);

  const args = {
    environment_id: given.env,
    title,
    prompt: readFileSync(given.prompt, 'utf8'),
    // **タグは投入する側が決める**——同じ文字列を関門（`may-dispatch.sh`）にも渡すので、ここで組み
    // 立てると**判定は通るのに二重に立つ**という形で食い違う。
    tags: [given.tag],
  };
  // ブリッジはリポジトリを既に持っているので、渡らない（`ccr-env.sh`）。
  if (given.source) {
    args.source_url = given.source;
    args.source_revision = revision;
  }
  // **空なら渡さない。** 渡さないこと自体が1つの選択（`ccr-env.sh`）。
  if (given.mode) args.permission_mode = given.mode;

  if (given['dry-run']) {
    dryRun(args, given['dry-run']);
    return 0;
  }

  const created = metaJson(await callMeta('create_session', args))?.ccr;
  if (!created?.id) {
    console.error('セッションを立てられなかった');
    return 1;
  }
  console.log(`SESSION ${created.id}`);

  // **渡した `source_url` が入ったかを見る**ので、渡していない（ブリッジ）なら確かめるものが無い。
  if (given.source) {
    const got = metaJson(await callMeta('get_session', { session_id: created.id }))?.ccr;
    const sources = (got?.session_context?.sources ?? [])
      .map((source) => source.git_repository)
      .filter((repository) => repository !== undefined && repository !== null)
      .map((repository) => `${repository.url}@${repository.revision}`);
    if (sources.length === 0) {
      console.error('リポジトリが入っていない（空の箱で起動している）。畳んで立て直す。');
      return 1;
    }
    console.log(`SOURCES ${sources.join('\n')}`);
  }

  return (await checkPrompt(created.id, given.prompt)) ? 0 : 1;
}

const [kind, ...rest] = process.argv.slice(2);
try {
  process.exit(await dispatch(kind, options(rest)));
} catch (error) {
  // **投入のログを読むのは人間。** 積み上がった呼び出しではなく、何が起きたかだけを残す。
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
