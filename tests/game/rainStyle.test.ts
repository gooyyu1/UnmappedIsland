import { describe, expect, it } from 'vitest';
import { rainLayersOf, rainStyleFor } from '../../src/game/looks/rainStyle';

/** 雨天ごとの雨の見え方（ScreenLayout.md 7.5.3節 雨の演出）。 */
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

  it('層は雨粒の1つ、嵐だけ風の筋が加わる', () => {
    expect(rainLayersOf(rainStyleFor('light_rain')!)).toHaveLength(1);

    const [drops, gusts] = rainLayersOf(rainStyleFor('storm')!);
    const style = rainStyleFor('storm')!;
    expect(drops.count).toBe(style.drops);
    expect(gusts.count).toBe(style.gusts);
    // 風の筋は雨粒と同じ向きで、長く・太く・薄く・速い。
    expect(gusts.slantDegrees).toBe(drops.slantDegrees);
    expect(gusts.length).toBeGreaterThan(drops.length);
    expect(gusts.thickness).toBeGreaterThan(drops.thickness);
    expect(gusts.alpha).toBeLessThan(drops.alpha);
    expect(gusts.fallMs).toBeLessThan(drops.fallMs);
  });

  it('暗さは持たない（明るさは日射が決める、skyTint.ts）', () => {
    for (const weather of rainy) expect(rainStyleFor(weather)).not.toHaveProperty('dim');
  });
});
