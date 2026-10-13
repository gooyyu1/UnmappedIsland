import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rainyWeathersOf } from '../support/rainyWeathers';
import { ROOT, sourcesIn } from '../support/sourceFiles';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * **雨の天気の集合が、検査やコードの中に写しで書かれていないか**の検査。
 *
 * 雨の天気は定義（天気の段）から引ける（`tests/support/rainyWeathers.ts`）。字で並べた写しは、雨の段が
 * 増えても古いまま緑で通り、「全部の雨で見る」と言っている検査が新しい雨を見ないまま残る。
 *
 * 見るのは、**雨の天気の名前を2つ以上、引用符付きで並べた配列リテラル**。1つだけを名指すのは
 * 「小雨のとき」のような個別の主張で、集合の写しではない。
 */
describe('雨の天気の写し', () => {
  it('雨の天気を並べた配列リテラルが、検査にもコードにも無い', () => {
    const rainy = rainyWeathersOf(bundledCodex());
    expect(rainy.length, '雨の天気が定義から引けない').toBeGreaterThan(1);

    const found = [...sourcesIn('src'), ...sourcesIn('tests')].flatMap((file) => {
      const text = readFileSync(join(ROOT, file), 'utf8');
      return [...text.matchAll(/\[[^[\]]*\]/g)]
        .filter(
          ([list]) =>
            rainy.filter((name) => list.includes(`'${name}'`) || list.includes(`"${name}"`)).length > 1,
        )
        .map(([list]) => `${file}: ${list}`);
    });

    expect(found, 'rainyWeathersOf から引く（tests/support/rainyWeathers.ts）').toEqual([]);
  });
});
