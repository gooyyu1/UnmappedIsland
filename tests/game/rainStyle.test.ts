import { describe, expect, it } from 'vitest';
import { rainStyleFor } from '../../src/game/ui/rainStyle';

/** 雨天ごとの雨の見え方（ScreenLayout.md 雨の演出節）。 */
describe('rainStyle(天気ごとの雨の見え方)', () => {
  const rainy = ['light_rain', 'heavy_rain', 'storm'] as const;

  it('雨の降らない天気では降らせない', () => {
    for (const weather of ['clear', 'cloudy', 'sunny', 'scorching'])
      expect(rainStyleFor(weather), weather).toBeUndefined();
    // 表に無い天気が増えても、降らないだけで画面は壊れない。
    expect(rainStyleFor('hail')).toBeUndefined();
  });

  it('雨天では、強いほど多く・長く・速く・斜めになる', () => {
    const [light, heavy, storm] = rainy.map((weather) => rainStyleFor(weather)!);

    for (const [weaker, stronger] of [
      [light, heavy],
      [heavy, storm],
    ]) {
      expect(stronger.drops).toBeGreaterThan(weaker.drops);
      expect(stronger.length).toBeGreaterThan(weaker.length);
      expect(stronger.slantDegrees).toBeGreaterThan(weaker.slantDegrees);
      expect(stronger.fallMs, '強いほど速く落ちる').toBeLessThan(weaker.fallMs);
    }
  });

  it('風の筋が混じるのは嵐だけ', () => {
    expect(rainStyleFor('storm')!.gusts).toBeGreaterThan(0);
    expect(rainStyleFor('light_rain')!.gusts).toBe(0);
    expect(rainStyleFor('heavy_rain')!.gusts).toBe(0);
  });

  it('暗さは持たない（明るさは日射が決める、skyTint.ts）', () => {
    for (const weather of rainy) expect(rainStyleFor(weather)).not.toHaveProperty('dim');
  });
});
