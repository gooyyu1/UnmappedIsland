import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rainyWeathersOf } from '../support/rainyWeathers';
import { bundledCodex, worldCodexYamlPaths } from '../support/worldCodexFiles';

/**
 * 雨の天気の見分け方（`tests/support/rainyWeathers.ts`）が、定義の条件が「雨」として名指す天気と
 * 揃っているか。
 *
 * 検査は雨の天気を見分け方から引くので、見分け方が条件とずれると、検査は条件の見ていない天気を
 * 「雨」として確かめる（あるいは見落とす）。**天気を集合で見る条件（`in`・`not_in`）は、どれも雨の
 * 天気をちょうど名指す**——雨か否かの他に天気を集合で分ける条件は、今の世界には無い。
 */
describe('雨の天気', () => {
  const codex = bundledCodex();
  const weathers = new Set(
    codex.objects
      .get(codex.objectNames.getId(codex.vocabulary.world.worldObject))
      .tryGetPropertyDef(codex.vocabulary.world.weatherId)!
      .stages.map((stage) => stage.name),
  );

  it('天気を集合で見る条件は、どれも雨の天気をちょうど名指す', () => {
    const rainy = [...rainyWeathersOf(codex)].sort();
    const lists = worldCodexYamlPaths().flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(/\b(?:not_)?in:\s*\[([^\]]*)\]/g)]
        .map(([, items]) => items.split(',').map((item) => item.trim()))
        .filter((items) => items.some((item) => weathers.has(item)))
        .map((items) => ({ path, items: [...items].sort() })),
    );

    expect(lists.length, '天気を集合で見る条件が1つも見つからない').toBeGreaterThan(0);
    for (const { path, items } of lists) expect(items, path).toEqual(rainy);
  });
});
