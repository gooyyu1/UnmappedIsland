import { readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commentsOnly } from '../../scripts/codeComments.mjs';
import {
  historyDocs,
  historyRuleSources,
  isProseData,
  trackedDocs,
} from '../../scripts/docScope.mjs';

/**
 * 経緯を主題としない文書とコメントに、過去の姿を語る記述が生えていないかの検査
 * （[`docs/DocumentStyle.md`](../../docs/DocumentStyle.md) 9.1節、
 * [`CLAUDE.md`](../../CLAUDE.md)「ドキュメント・コメントのスタイル」）。
 *
 * **射程は [`docScope.mjs`](../../scripts/docScope.mjs) から引く**（{@link historyRuleSources}。
 * どこまで掛かるかを決めているのは同 10節）。写すと、表や置き場を増やしたときにずれる。表に無い
 * 文書やコメントで過去の姿から書き始めた記述は、旧仕様を知らない読み手には要らないものになる
 * （issue #1936）。
 */

const ROOT = resolve(__dirname, '../..');

/**
 * リポジトリルートからの相対パスを `/` 区切りで持つ。**この検査でパスを組むのは、どこもここを通す**
 * ——`path.join` も `path.relative` も Windows では `\` を返すので、片側だけ素で組むと照合が一度も
 * 当たらない。**当たらないことは Windows で打ったときにしか見えない**ので、揃える手段を2通りにしない。
 */
function repoPath(...segments: string[]): string {
  return join(...segments)
    .split(sep)
    .join('/');
}

/** 印そのものを持つこのファイル。中身が印と一致するので、自分自身は見られない。 */
const SELF = repoPath(relative(ROOT, __filename));

/**
 * 過去の姿を語り出す印。**過去の姿を指すことがその語の意味であるものだけを挙げる。** 単なる
 * 過去形（「〜でした」）は測定の報告にも使うので、見ない。
 */
const MARKERS = ['かつて', '以前は', 'ていた頃', 'だった頃', '時期があ'];

/**
 * 読む本文。**Markdown と宣言の値へ散文を置くデータは全文、それ以外はコメントだけ**——コードや
 * データの値の中の語まで見ると、文字列リテラルに入れた例が赤くなる。
 */
function proseOf(file: string): string {
  const text = readFileSync(join(ROOT, file), 'utf-8');
  // `docScope.mjs` の判定はプラットフォームの区切りで受ける（`file` は `repoPath` の `/` 区切り）。
  const native = file.split('/').join(sep);
  return file.endsWith('.md') || isProseData(native) ? text : commentsOnly(text, file);
}

function historyIn(file: string): string[] {
  const found: string[] = [];
  proseOf(file)
    .split('\n')
    .forEach((line, index) => {
      for (const marker of MARKERS) {
        if (line.includes(marker)) found.push(`${file}:${index + 1} 「${marker}」 ${line.trim()}`);
      }
    });
  return found;
}

const ALLOWED = [...historyDocs(ROOT)].map((doc) => repoPath(doc));
const SCANNED = historyRuleSources(ROOT)
  .map((file) => repoPath(file))
  .filter((file) => file !== SELF);

describe('射程が、決めた先へ届いている', () => {
  // 9.1節の表と噛み合っていないと**除外が1つも当たらない**が、赤くなるのは表の文書がマーカー語を
  // 持つときだけ——綴りの取り違えはここで落ちる。
  //
  // **パス区切りのずれが落ちるのは Windows で打ったときだけ。** `path.join` が `/` を返す
  // Linux では、{@link repoPath} を素の `join` へ戻しても照合は当たり続ける——CI で見ているのは
  // `tests.yml` の `windows` job だけ。
  it.each(ALLOWED)('%s が追跡しているMarkdownに在る', (doc) => {
    expect(trackedDocs(ROOT).map((rel) => repoPath(rel))).toContain(doc);
  });

  // 射程を `docs/` とソースのコメントに戻しても、他の検査はどれも緑のまま——10節が決めた
  // 「盤面を回す文書にも、スクリプト・データ・ワークフローのコメントにも掛かる」を守るのはここだけ。
  // 形式ごとに1つずつ置く（どれか1つの形式が射程から落ちても赤くなるように）。
  it.each([
    'agent-ops/parallel-work.md',
    'scripts/daemon/usage.sh',
    '.github/workflows/pages.yml',
    'src/assets/world-codex/timber.yaml',
    'tools/comfyui/recipes/campfire.json',
  ])('%s を読んでいる', (file) => {
    expect(SCANNED).toContain(file);
    // 走査先に在っても、その形式のコメントを読めなければ何も見ていないのと同じ。
    expect(proseOf(file).trim()).not.toBe('');
  });
});

describe('経緯を主題としない文書とコメントは、過去の姿を語らない', () => {
  it.each(SCANNED)('%s', (file) => {
    expect(historyIn(file)).toEqual([]);
  });
});
