import { describe, expect, it } from 'vitest';
import { COLOR, capacityColorFor, fillColorFor } from '../../src/game/ui/theme';

/**
 * 入れ物の詰まり具合のバーの塗りの色（ScreenLayout.md カードの状態バー節）。
 * ステータスバーと同じ色域を、域ではなく値そのもので辿る。
 */
describe('入れ物の詰まり具合のバーの塗りの色', () => {
  it('空はステータスバーの安全域、満杯は致命的域と同じ色になる', () => {
    expect(capacityColorFor(0)).toBe(COLOR.statusBarFillSafe);
    expect(capacityColorFor(1)).toBe(COLOR.statusBarFillFatal);
    // 色域を共有していることを、ステータスバー側の両端と突き合わせて確かめる。
    expect(capacityColorFor(0)).toBe(fillColorFor('safe'));
    expect(capacityColorFor(1)).toBe(fillColorFor('fatal'));
  });

  it('範囲外の値は両端の色に丸める', () => {
    expect(capacityColorFor(1.5)).toBe(COLOR.statusBarFillFatal);
    expect(capacityColorFor(-0.5)).toBe(COLOR.statusBarFillSafe);
  });

  it('詰まるほど緑から離れていく', () => {
    const ratios = [0, 0.25, 0.5, 0.75, 1];
    const greens = ratios.map((ratio) => (capacityColorFor(ratio) >> 8) & 0xff);

    for (let i = 1; i < ratios.length; i++) {
      expect(greens[i], `${ratios[i]}まで詰まったときの緑成分`).toBeLessThan(greens[i - 1]);
    }
  });
});
