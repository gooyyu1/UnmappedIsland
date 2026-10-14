import { describe, expect, it } from 'vitest';
import { rainStyleFor } from '../../src/game/looks/rainStyle';
import { rainyWeathersOf } from '../support/rainyWeathers';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * 雨の演出（rainStyle）を、世界の天気と繋いだまま通す試験（ScreenLayout.md 7.5.3節）。
 *
 * 見え方の表は天気の名前で引くので、**雨の段が増えても表へ足すまでは黙って降らない**。どの天気が
 * 雨で、どれが強いかは世界の側が持つ（`tests/support/rainyWeathers.ts`）ので、表がそれに揃っているかは
 * 実データ（core.yaml）と突き合わせないと分からない。
 */
describe('雨の演出（世界→意匠 通し）', () => {
  const codex = bundledCodex();
  const rainy = rainyWeathersOf(codex);
  const weathers = codex.objects
    .get(codex.objectNames.getId(codex.vocabulary.world.worldObject))
    .tryGetPropertyDef(codex.vocabulary.world.weatherId)!
    .stages.map((stage) => stage.name);

  it('雨の天気にはどれも見え方があり、雨の降らない天気には無い', () => {
    expect(rainy.length, '雨の天気が定義から引けない').toBeGreaterThan(1);
    for (const weather of weathers)
      if (rainy.includes(weather)) expect(rainStyleFor(weather), weather).toBeDefined();
      else expect(rainStyleFor(weather), weather).toBeUndefined();
  });

  it('多く降らせる雨ほど、多く・長く・速く・斜めになる', () => {
    const styles = rainy.map((weather) => rainStyleFor(weather)!);

    for (let i = 1; i < styles.length; i++) {
      const [weaker, stronger] = [styles[i - 1], styles[i]];
      const label = `${rainy[i - 1]} → ${rainy[i]}`;
      expect(stronger.drops, label).toBeGreaterThan(weaker.drops);
      expect(stronger.length, label).toBeGreaterThan(weaker.length);
      expect(stronger.slantDegrees, label).toBeGreaterThan(weaker.slantDegrees);
      expect(stronger.fallMs, `${label}: 強いほど速く落ちる`).toBeLessThan(weaker.fallMs);
    }
  });

  it('暗さは持たない（明るさは日射が決める、skyTint.ts）', () => {
    for (const weather of rainy) expect(rainStyleFor(weather)).not.toHaveProperty('dim');
  });
});
