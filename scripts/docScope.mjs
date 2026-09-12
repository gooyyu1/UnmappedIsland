import { execSync } from 'node:child_process';
import { join, sep } from 'node:path';

/**
 * 文書の規約がどこまで掛かるかを決める1つ（`docs/DocumentStyle.md` 10節）。
 *
 * **参照の書き方（同 5節）と確定度の印（同 6節）は、このリポジトリのMarkdownすべてに掛かる。**
 * 同じ規約を別々の検査が課しているので（参照の解決を見る `tests/docs/docReferences.test.ts`、
 * 説明が挙げる名前を見る `tests/docs/docMemberReferences.test.ts`）、**射程を別々に持つと片方だけが
 * `docs/` に取り残される。**
 */

/**
 * 追跡しているファイル。**在り処を列挙せず git に訊く**——一覧は足した日にしか更新されないので、
 * フォルダを1つ作るたびに黙って射程の外が増える。追跡されていないもの（`site/`・`worktrees/`）は
 * 初めから入らない。
 *
 * **裏を返せば、`git add` する前の新しい文書はここに現れない。** 検査が素通しになるのは手元で
 * 書いている間だけで、コミットした時点で射程へ入る（CIでは起きない）。
 *
 * @param {string} root リポジトリの根
 * @param {string} [pathspec] git の pathspec で絞る
 * @returns {string[]} 根からの相対パス（区切りはそのプラットフォームのもの）
 */
export function trackedFiles(root, pathspec) {
  const spec = pathspec === undefined ? '' : ` -- "${pathspec}"`;
  return execSync(`git ls-files -z${spec}`, { cwd: root, encoding: 'utf-8' })
    .split('\0')
    .filter((path) => path !== '')
    .map((path) => path.split('/').join(sep));
}

/**
 * 追跡しているMarkdown。文書の規約を課す側も、指し先も、ここから絞って作る。
 *
 * @param {string} root リポジトリの根
 * @returns {string[]} 根からの相対パス（区切りはそのプラットフォームのもの）
 */
export function trackedDocs(root) {
  return trackedFiles(root, '*.md');
}

/**
 * **どの規約も課さない記録**か（`docs/DocumentStyle.md` 10節）。当時の現物をそのまま残す場所で、
 * **緑へ戻す手が記録の書き換えしか無い**ため、指し先の候補としてだけ生かす。
 *
 * @param {string} rel 根からの相対パス
 */
export function isVerbatimRecord(rel) {
  return (
    rel.startsWith(join('agent-ops', 'decisions') + sep) ||
    new RegExp(`^review\\${sep}\\d{4}-\\d{2}-\\d{2}`).test(rel)
  );
}

/**
 * その回の観測の記録か（`agent-ops/analysis/**`）。参照は今のリポジトリを指すので規約が掛かり、
 * **確定度の印だけが外れる**——印はそこでは題材として現れる。
 *
 * @param {string} rel 根からの相対パス
 */
export function isAnalysisRecord(rel) {
  return rel.startsWith(join('agent-ops', 'analysis') + sep);
}
