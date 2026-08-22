import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 誰も輸入していないexportの検査。
 *
 * **exportは「この名前は外から使う」という宣言**なので、どこからも輸入されないまま残ると、モジュール
 * の表面について嘘をつくことになる（生成した参照ドキュメントにも並ぶ）。畳んだり呼び手を移したり
 * したときに残りやすい——初回の全数調査では12件あった。
 *
 * 見るのは`const`と`function`だけ。**型（interface・type）とクラスは、輸入されなくても署名で名乗る
 * ために公開する値打ちがある**（`ObjectWindowOptions`はコンストラクタの引数の型、`ObjectTexts`は
 * `Localization.object`の戻り値の型）。値の宣言だけが「輸入されるためだけに在る」と言い切れる。
 */

const ROOT = resolve(__dirname, '../..');

/** src以外で名前が現れうる置き場（テスト・ビルド用スクリプト・ルートの設定）。 */
const CONSUMERS = ['tests', 'scripts', '.claude'];

function filesIn(dir: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...filesIn(rel, extensions));
    else if (extensions.some((extension) => entry.endsWith(extension))) found.push(rel);
  }
  return found;
}

describe('exportの表面', () => {
  it('どこからも輸入されない値のexportが無い', () => {
    const sources = filesIn('src', ['.ts']);
    const consumers = [
      ...sources,
      ...CONSUMERS.flatMap((dir) => filesIn(dir, ['.ts', '.mjs'])),
      ...readdirSync(ROOT).filter((entry) => entry.endsWith('.ts')),
    ];
    const texts = new Map(consumers.map((file) => [file, readFileSync(join(ROOT, file), 'utf8')]));

    const declaration = /^export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/gm;
    const unused: string[] = [];
    for (const file of sources) {
      for (const [, name] of texts.get(file)!.matchAll(declaration)) {
        const referenced = [...texts].some(
          ([other, text]) => other !== file && new RegExp(`\\b${name}\\b`).test(text),
        );
        if (!referenced) unused.push(`${file}: ${name}`);
      }
    }

    expect(unused, 'exportしているが、どこからも輸入されていない（exportを外す）').toEqual([]);
  });
});
