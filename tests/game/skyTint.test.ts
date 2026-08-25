import { describe, expect, it } from 'vitest';
import { skyTintFor } from '../../src/game/looks/skyTint';

/**
 * 明るさに応じてフィールドエリアへかぶせる色（ScreenLayout.md 7.5節 空の演出）。
 * `ambient_brightness` の値はcore.yamlの寄与から決まる（太陽高度: 夜-6/正午+16、天気の透過率:
 * 曇り-5/晴れ-2/雲なし0）。EVスケールなので、1段が明るさの2倍にあたる。
 */
describe('skyTint(明るさに応じた翳り・輝き)', () => {
  const alphaAt = (brightness: number): number => skyTintFor(brightness)?.alpha ?? 0;

  it('曇りの正午（+11）は何もかぶせない', () => {
    expect(skyTintFor(11)).toBeUndefined();
  });

  it('明るさが分からないCodexでは何もかぶせない', () => {
    expect(skyTintFor(undefined)).toBeUndefined();
  });

  it('曇りの正午より暗いほど濃く翳る', () => {
    // 嵐の正午(6) < 大雨の正午(8) < 曇りの正午(11)。夜(-6)は天気によらず最も暗い。
    expect(alphaAt(-6)).toBeGreaterThan(alphaAt(6));
    expect(alphaAt(6)).toBeGreaterThan(alphaAt(8));
    expect(alphaAt(8)).toBeGreaterThan(0);
    for (const brightness of [-6, 6, 8])
      expect(skyTintFor(brightness)!.additive, '翳りは加算しない').toBe(false);
  });

  it('曇りの正午より明るいほど強く輝く', () => {
    // 晴れの正午(14) < 雲の無い正午(16)。
    expect(alphaAt(12)).toBeGreaterThan(0);
    expect(alphaAt(14)).toBeGreaterThan(alphaAt(12));
    expect(alphaAt(16)).toBeGreaterThan(alphaAt(14));
    for (const brightness of [12, 14, 16])
      expect(skyTintFor(brightness)!.additive, '輝きは加算合成（白く濁らせない）').toBe(true);
  });

  it('夜は天気によらず同じ暗さになる', () => {
    // 明るさは夜に底（-6）へ均されるので、真夜中の快晴が明るくなることはない。
    expect(alphaAt(-6)).toBeGreaterThan(alphaAt(-5));
  });

  it('翳りも輝きも、画面が読めなくなるほど強くしない', () => {
    for (let brightness = -6; brightness <= 17; brightness++)
      expect(alphaAt(brightness), `brightness=${brightness}`).toBeLessThan(0.5);
  });

  it('取りうる最大より明るくても、輝きは頭打ちになる', () => {
    expect(alphaAt(17)).toBe(alphaAt(16));
  });

  it('底より暗くても、翳りは頭打ちになる', () => {
    expect(alphaAt(-9)).toBe(alphaAt(-6));
  });
});
