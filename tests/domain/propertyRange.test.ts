import { describe, expect, it } from 'vitest';
import { PropertyRange } from '../../src/domain/PropertyDef';

// `on_min`／`on_max`がrangeのどちらの端かを持つのはPropertyRangeだけ（PropertyDef.ts）。ここが裏返ると
// 端で走る効果・端へ達したかの判定・端からの距離が揃って裏返るので、対応そのものをここで留める。
describe('PropertyRangeの端', () => {
  const range = new PropertyRange(10, 20);

  it('on_minは下端を、on_maxは上端を指す', () => {
    expect(range.endValue('on_min')).toBe(10);
    expect(range.endValue('on_max')).toBe(20);
  });

  it('端からrangeの内側への距離は、どちらの端でも正', () => {
    expect(range.inwardFrom('on_min', 12)).toBe(2);
    expect(range.inwardFrom('on_max', 18)).toBe(2);
  });

  it('端を越えた値の内側への距離は負', () => {
    expect(range.inwardFrom('on_min', 9)).toBe(-1);
    expect(range.inwardFrom('on_max', 21)).toBe(-1);
  });

  it('端に達したかは、端そのものでも越えた先でも真', () => {
    expect(range.hasReached('on_min', 10)).toBe(true);
    expect(range.hasReached('on_min', 9)).toBe(true);
    expect(range.hasReached('on_min', 11)).toBe(false);
    expect(range.hasReached('on_max', 20)).toBe(true);
    expect(range.hasReached('on_max', 21)).toBe(true);
    expect(range.hasReached('on_max', 19)).toBe(false);
  });
});
