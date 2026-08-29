import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * 画面のことばが、コードではなく対応表（`ui_texts`、Localization.md）に居ることの検査。
 *
 * **画面に出る語をコードへ直接書くと、そこだけ載せ替えられなくなる。** 対応表を差し替えても
 * 変わらない語が混ざっていることは、日本語で読んでいる限り誰も気付けない——読めてしまうので、
 * 壊れて見えない。そこで、**`src/game/` の文字列リテラルに日本語の字が無いこと**を機械で見る
 * （語だけでなく、語をつなぐ全角の記号も。下のJAPANESE）。
 *
 * 引き方は `locale.uiText(...)`（`Localization`を持っている側）と `uiText(...)`（持たない窓）の
 * 2つで、答えを決めるのはどちらも `Localization.uiText` の1箇所（uiTexts.ts）。
 *
 * 見るのは**リテラル**だけなので、コメント・識別子は当たらない。それでも画面へ出ないものが
 * 残るため、外し方は2つだけ持つ——例外の文言（`new なんとかError`）と、下の許可一覧。
 */

const ROOT = resolve(__dirname, '../..');

/**
 * 画面の語とみなす字。かな・漢字・半角カナに加えて、**全角の記号**（`、`・`（）`・`〜`）も見る
 * ——**語のつなぎ方は言語をまたいで同じではない**（`A、B` は `A, B`、`X（Y）` は `X (Y)` になり、
 * 区切りの字も前後の空白も変わる）。語だけを対応表へ移してつなぎ方をコードに残すと、対応表を
 * 差し替えてもそこだけ日本語の組み方が残る。
 */
const JAPANESE = /[぀-ヿ一-鿿ｦ-ﾝ\u3000-\u303f\uff01-\uff60]/;

/**
 * 対応表を引けない・引く意味が無い文字列。**画面に出るものは1つも入れない**——ここへ足すのは、
 * 「その文字列が画面のラベルではない」と言い切れるときだけ。
 */
const ALLOWED: readonly { readonly file: string; readonly text: string }[] = [
  // 対応表そのものを読めなかったときの一文。ここで対応表を引けば、同じ失敗をもう一度踏む。
  { file: 'src/game/BootScene.ts', text: '定義ファイルのロードに失敗しました:\n' },
  // 行の高さを測るためだけの一文字（測ったらすぐ壊す）。画面には出ない。
  { file: 'src/game/NewGameScene.ts', text: 'あ' },
  // 字ではなく**記号の絵**。空きスロットの「足す」印と、影響の向きを表す記号
  // （`−`・`▲`・`▼` と一組で、そちらは全角ではないので当たらない）。
  { file: 'src/game/SlotSelectScene.ts', text: '＋' },
  { file: 'src/game/ui/StatusDetailWindow.ts', text: '＋' },
];

/** そのディレクトリ以下の.tsファイル（リポジトリ相対）。 */
function sourcesIn(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...sourcesIn(rel));
    else if (entry.endsWith('.ts')) found.push(rel);
  }
  return found;
}

/** `new なんとかError(...)` か。**例外の文言は開発者に宛てたもの**で、画面のラベルではない。 */
function isErrorConstruction(node: ts.Node): boolean {
  return ts.isNewExpression(node) && node.expression.getText().endsWith('Error');
}

/** そのファイルの文字列リテラル（差し込みのある書式は、その断片ごと）。 */
function literalsIn(rel: string): readonly { text: string; line: number }[] {
  const source = readFileSync(join(ROOT, rel), 'utf-8');
  const file = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true);
  const found: { text: string; line: number }[] = [];

  const walk = (node: ts.Node): void => {
    if (isErrorConstruction(node)) return;

    const isLiteral =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node);
    if (isLiteral) {
      found.push({
        text: (node as ts.LiteralLikeNode).text,
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      });
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  return found;
}

describe('画面のことば', () => {
  it('src/game に、画面へ出る日本語の文字列リテラルが無い', () => {
    const hardcoded = sourcesIn('src/game').flatMap((rel) =>
      literalsIn(rel)
        .filter(({ text }) => JAPANESE.test(text))
        .filter(({ text }) => !ALLOWED.some((entry) => entry.file === rel && entry.text === text))
        .map(({ text, line }) => `${rel}:${line} ${JSON.stringify(text)}`),
    );

    expect(hardcoded, 'ja.yamlのui_textsへ移して、uiTextで引く（Localization.md）').toEqual([]);
  });

  it('外している文字列が、まだそこに在る', () => {
    // 消えた・書き換わった除外を残すと、次に同じ文字列を書いた人が黙って通ってしまう。
    const missing = ALLOWED.filter(
      (entry) => !literalsIn(entry.file).some(({ text }) => text === entry.text),
    );
    expect(missing.map((entry) => `${entry.file} ${JSON.stringify(entry.text)}`)).toEqual([]);
  });
});
