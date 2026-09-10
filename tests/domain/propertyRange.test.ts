import { describe, expect, it } from 'vitest';
import { endMovedToward, movesTowardEnd, PropertyRange } from '../../src/domain/PropertyDef';

// `on_min`／`on_max`がrangeのどちらの端かを持つのは1箇所だけ（PropertyDef.tsのinwardOf）。ここが裏返ると
// 端で走る効果・端へ達したかの判定・端からの距離・その端へ向かっているかが揃って裏返るので、対応そのものを
// ここで留める。
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

  // tick毎の増減がその端へ向かうかは、rangeの上下限を知らずに増減量だけで決まる（定義から周期を読む
  // src/analysisが持っているのは位置ではなく増減量）。端の値と同じ対応から出ることを、ここで留める。
  it('端へ向かうのは、その端から内側への距離が縮む向き', () => {
    expect(movesTowardEnd('on_min', -1), '下端へは減って向かう').toBe(true);
    expect(movesTowardEnd('on_min', 1)).toBe(false);
    expect(movesTowardEnd('on_max', 1), '上端へは増えて向かう').toBe(true);
    expect(movesTowardEnd('on_max', -1)).toBe(false);
  });

  it('動かない増減は、どちらの端へも向かわない', () => {
    expect(movesTowardEnd('on_min', 0)).toBe(false);
    expect(movesTowardEnd('on_max', 0)).toBe(false);
  });

  // 向きから端を引く逆向きの問いも、同じ対応から出る（別に書くと片方だけ裏返っても気付けない）。
  it('増減が向かっていく端は、その端へ向かうと言えるほうの端', () => {
    expect(endMovedToward(-1), '減る値は下端へ向かう').toBe('on_min');
    expect(endMovedToward(1), '増える値は上端へ向かう').toBe('on_max');
  });

  it('動かない増減には、向かっていく端が無い', () => {
    expect(endMovedToward(0)).toBeUndefined();
  });
});
