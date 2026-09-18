import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, sourcesIn } from '../support/sourceFiles';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * **語彙が持つ綴りが、語彙の外にもう1つ書かれていないか**の検査。
 *
 * `WorldVocabulary` は「コードがYAMLの単語へ寄せている依存の一覧」を1箇所で答えると決めている
 * （同ファイルの冒頭）。同じ綴りがどこかにもう1つ生えると、その答えが嘘になり、YAMLの語を変えた
 * 誰かが片方だけを直して、もう片方が黙って効かなくなる。
 *
 * 見るのは、語彙が文字列のまま持つ語のうち、**その綴りが他の意味では書かれない**もの。
 * `'world'`・`'path'`・`'weight'` のように別の意味でも現れる語は、綴りだけでは見分けられないので
 * ここでは見ない。テストより外（`src`）だけを見るのは、YAMLの字面をそのまま突き合わせるのが
 * テストの仕事だから（`tests/world-codex` が実ファイルの綴りを直に書く）。
 *
 * 語彙へ新しく語を足したら、他の意味で現れない綴りなら下の一覧へも足す。
 */

/** 語彙を持つファイル。ここだけが綴りを書いてよい。 */
const VOCABULARY = 'src/domain/WorldVocabulary.ts';

describe('語彙が持つ綴り', () => {
  it('WorldVocabulary の外に、同じ綴りの文字列リテラルが無い', () => {
    const words = bundledCodex().vocabulary.world;
    const onlyMeaning = [words.exploreAction, words.travelAction, words.unconsciousStage];

    const found = sourcesIn('src')
      .filter((file) => file !== VOCABULARY)
      .flatMap((file) => {
        const text = readFileSync(join(ROOT, file), 'utf8');
        return onlyMeaning
          .filter((word) => text.includes(`'${word}'`) || text.includes(`"${word}"`))
          .map((word) => `${file}: '${word}'`);
      });

    expect(found, 'codex.vocabulary.world から引く（WorldVocabulary の冒頭）').toEqual([]);
  });
});
