import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, sourcesIn } from '../support/sourceFiles';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * **綴りそのものが判断を決める語が、語彙の外に書かれていないか**の検査。
 *
 * `WorldVocabulary` の語の大半は「値や集合を引く鍵」でしかなく、どの綴りかに他の判断は依存しない。
 * ここで見るのはそうでないもの——**名前で突き合わせて分岐が決まる語**で、読む側が分かれている
 * （`domain/wrappers`・`analysis`・`game/view`）。2つ目の綴りがどこかに生えると、YAMLを直した誰かが
 * 片方だけを直して、もう片方が黙って効かなくなる。
 *
 * 語彙の側にも綴りは1つずつしか無いので、**ここが見るのは「語彙の外に同じ綴りが在るか」だけ**。
 * 新しく名前で突き合わせる語を足したら、下の一覧へも足す。
 */

/** 語彙を持つファイル。ここだけが綴りを書いてよい。 */
const VOCABULARY = 'src/domain/WorldVocabulary.ts';

describe('名前で突き合わせる語', () => {
  it('WorldVocabulary の外に、同じ綴りの文字列リテラルが無い', () => {
    const words = bundledCodex().vocabulary.world;
    const matchedByName = [words.exploreAction, words.travelAction, words.unconsciousStage];

    const found = sourcesIn('src')
      .filter((file) => file !== VOCABULARY)
      .flatMap((file) => {
        const text = readFileSync(join(ROOT, file), 'utf8');
        return matchedByName
          .filter((word) => text.includes(`'${word}'`) || text.includes(`"${word}"`))
          .map((word) => `${file}: '${word}'`);
      });

    expect(found, 'codex.vocabulary.world から引く（WorldVocabulary の冒頭）').toEqual([]);
  });
});
