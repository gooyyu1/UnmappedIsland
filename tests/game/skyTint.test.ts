import { describe, expect, it } from 'vitest';
import { skyTintFor } from '../../src/game/ui/skyTint';

/**
 * 日射に応じてフィールドエリアへかぶせる色（ScreenLayout.md 7.5節 空の演出）。
 * sunlightの値はcore.yamlの寄与から決まる（時間帯: 夜0/朝夕+2/日中+5、天気: 曇り+2/快晴+5/晴天+7/灼熱+10）。
 */
describe('skyTint(日射に応じた翳り・輝き)', () => {
  const alphaAt = (sunlight: number): number => skyTintFor(sunlight)?.alpha ?? 0;

  it('曇りの日中（7）は何もかぶせない', () => {
    expect(skyTintFor(7)).toBeUndefined();
  });

  it('日射が分からないCodexでは何もかぶせない', () => {
    expect(skyTintFor(undefined)).toBeUndefined();
  });

  it('曇りの日中より暗いほど濃く翳る', () => {
    // 嵐の日中(5) < 小雨の日中(6) < 曇りの日中(7)。夜(0)は天気によらず最も暗い。
    expect(alphaAt(0)).toBeGreaterThan(alphaAt(5));
    expect(alphaAt(5)).toBeGreaterThan(alphaAt(6));
    expect(alphaAt(6)).toBeGreaterThan(0);
    for (const sunlight of [0, 5, 6]) expect(skyTintFor(sunlight)!.additive, '翳りは加算しない').toBe(false);
  });

  it('曇りの日中より明るいほど強く輝く', () => {
    // 快晴の日中(10) < 晴天の日中(12) < 灼熱の日中(15)。
    expect(alphaAt(10)).toBeGreaterThan(0);
    expect(alphaAt(12)).toBeGreaterThan(alphaAt(10));
    expect(alphaAt(15)).toBeGreaterThan(alphaAt(12));
    for (const sunlight of [10, 12, 15])
      expect(skyTintFor(sunlight)!.additive, '輝きは加算合成（白く濁らせない）').toBe(true);
  });

  it('夜は天気によらず同じ暗さになる', () => {
    // sunlightは夜に0へクランプされるので、真夜中の快晴が明るくなることはない。
    expect(skyTintFor(0)).toEqual(skyTintFor(0));
    expect(alphaAt(0)).toBeGreaterThan(alphaAt(1));
  });

  it('翳りも輝きも、画面が読めなくなるほど強くしない', () => {
    for (let sunlight = 0; sunlight <= 20; sunlight++)
      expect(alphaAt(sunlight), `sunlight=${sunlight}`).toBeLessThan(0.5);
  });

  it('取りうる最大より明るくても、輝きは頭打ちになる', () => {
    expect(alphaAt(20)).toBe(alphaAt(15));
  });
});
