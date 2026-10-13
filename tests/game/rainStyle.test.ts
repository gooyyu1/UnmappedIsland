import { describe, expect, it } from 'vitest';
import { rainLayersOf, rainStyleFor } from '../../src/game/looks/rainStyle';

/** 雨天ごとの雨の見え方（ScreenLayout.md 7.5.3節 雨の演出）。 */
describe('rainStyle(天気ごとの雨の見え方)', () => {
  it('表に無い天気では降らせない', () => {
    expect(rainStyleFor('clear')).toBeUndefined();
    expect(rainStyleFor(undefined)).toBeUndefined();
    // 表に無い天気が増えても、降らないだけで画面は壊れない。
    expect(rainStyleFor('hail')).toBeUndefined();
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
});
