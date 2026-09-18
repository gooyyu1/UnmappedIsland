import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 文書の規約がどこまで掛かるかを決める1つ（`docs/DocumentStyle.md` 10節）。
 *
 * **参照の書き方（同 5節）と確定度の印（同 6節）は、このリポジトリのMarkdownすべてに掛かる。**
 * 同じ規約を別々の検査が課しているので（参照の解決を見る `tests/docs/docReferences.test.ts`、
 * 説明が挙げる名前を見る `tests/docs/docMemberReferences.test.ts`）、**射程を別々に持つと片方だけが
 * `docs/` に取り残される。**
 *
 * **印の射程は、検査だけでなく関門も読む**（[`needs-user-review.sh`](daemon/needs-user-review.sh)）
 * ので、シェルから呼ぶ口を下に持つ。
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
 * コメントの印（`//` か `#` か）を [`commentsOnly`](codeComments.mjs) が知っている形式。**ここに
 * 挙がっていない形式は、コメントを持っていても読めない。**
 */
export const COMMENTED_EXTENSIONS = ['.ts', '.mts', '.mjs', '.js', '.sh', '.py', '.yaml', '.yml'];

/**
 * 節番号の参照（`docs/DocumentStyle.md` 5節）を課す側のファイル。文書自身と、節番号で文書を指す
 * コード・データ。
 *
 * **指し先が実在するかを見る検査（`tests/docs/docReferences.test.ts`）と、指した先にその話が
 * 書いてあるかを読む係（[`refAudit.mjs`](daemon/refAudit.mjs)）が、同じ1つを読む。** 別々に持つと、
 * 片方だけが新しい置き場を見ないまま緑になる。
 *
 * `tools/**` の JSON はコメントを持たないが、宣言の値が節番号で仕様を指すので入る。**外すのは、
 * 参照の検査自身の例と正規表現（`tests/docs/**`）と、当時の現物をそのまま残す記録**
 * （{@link isVerbatimRecord}）。
 *
 * @param {string} root リポジトリの根
 * @returns {string[]} 根からの相対パス（区切りはそのプラットフォームのもの）
 */
export function trackedRefSources(root) {
  return trackedFiles(root).filter(
    (rel) =>
      (rel.endsWith('.md') ||
        COMMENTED_EXTENSIONS.some((ext) => rel.endsWith(ext)) ||
        (rel.startsWith(join('tools') + sep) && rel.endsWith('.json'))) &&
      !rel.startsWith(join('tests', 'docs') + sep) &&
      !isVerbatimRecord(rel),
  );
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
 * **指した先の中身を読む係（[`refAudit.mjs`](daemon/refAudit.mjs)）も、ここを外す。** 書いてあるのは当時の
 * 観測で、**今と食い違っていても直す先ではない**ので、読んでも手の出しようが無い（そう決めて
 * いるのは `agent-ops/prompts/analysis-prompt.md` の、記録の書き方を渡している段）。
 *
 * @param {string} rel 根からの相対パス
 */
export function isAnalysisRecord(rel) {
  return rel.startsWith(join('agent-ops', 'analysis') + sep);
}

/**
 * 確定度の印の条件（`docs/DocumentStyle.md` 6節）が掛かる文書か。**印の意味は置き場で変わらない**
 * ので、`docs/` の中かでは絞らない。外れるのは記録の2種——どの規約も課さないもの
 * （{@link isVerbatimRecord}）と、印が**題材として**現れるその回の観測（{@link isAnalysisRecord}）。
 *
 * @param {string} rel 根からの相対パス
 */
export function isMarkRuleDoc(rel) {
  return rel.endsWith('.md') && !isVerbatimRecord(rel) && !isAnalysisRecord(rel);
}

/**
 * シェルから {@link isMarkRuleDoc} を引く口。標準入力の1行1パス（区切りは `/`。`gh pr view --json
 * files` が返す形）のうち、印の条件が掛かるものだけをそのまま出す。
 *
 * **ここを通さずにシェル側でパターンを書き写すと、射程が2つになる**——関門
 * （[`needs-user-review.sh`](daemon/needs-user-review.sh)）の掛け先が `docs/` に取り残されていたのが
 * その形で、`agent-ops/board-design.md` の確定節が印ごと素通りしていた（#1800）。
 */
function printMarkRuleDocs() {
  const kept = readFileSync(0, 'utf-8')
    .split('\n')
    .filter((line) => line !== '')
    .filter((line) => isMarkRuleDoc(line.split('/').join(sep)));
  process.stdout.write(kept.map((line) => `${line}\n`).join(''));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  printMarkRuleDocs();
