import { describe, expect, it } from 'vitest';
import { COLOR, durabilityColorFor } from '../../src/game/ui/theme';

/** 色を成分に分ける（塗りが緑寄りか赤寄りかを見るため）。 */
function channels(color: number): { red: number; green: number; blue: number } {
  return { red: (color >> 16) & 0xff, green: (color >> 8) & 0xff, blue: color & 0xff };
}

/**
 * 耐久度バーの塗りの色（CardView.md 8節 カードの状態バー）。残りが減るほど緑から赤へ寄る。
 */
describe('耐久度バーの塗りの色', () => {
  it('満タンは緑、尽きる直前は赤で、両端は定義した色そのものになる', () => {
    expect(durabilityColorFor(1)).toBe(COLOR.durabilityFull);
    expect(durabilityColorFor(0)).toBe(COLOR.durabilityEmpty);
  });

  it('範囲外の値は両端の色に丸める', () => {
    expect(durabilityColorFor(1.5)).toBe(COLOR.durabilityFull);
    expect(durabilityColorFor(-0.5)).toBe(COLOR.durabilityEmpty);
  });

  it('減るほど緑から赤へ寄っていく', () => {
    // 琥珀は緑成分も高いため、赤と緑のどちらが勝っているかで「どちら寄りか」を見る。
    const ratios = [1, 0.75, 0.5, 0.25, 0];
    const redness = ratios.map((ratio) => {
      const { red, green } = channels(durabilityColorFor(ratio));
      return red - green;
    });

    for (let i = 1; i < ratios.length; i++) {
      expect(redness[i], `残り${ratios[i]}の赤寄り具合`).toBeGreaterThan(redness[i - 1]);
    }
  });

  it('途中で琥珀を通る（緑から赤へ直接混ぜた濁った色にならない）', () => {
    const half = channels(durabilityColorFor(0.5));

    expect(half.red, '琥珀は赤も緑も高い').toBeGreaterThan(200);
    expect(half.green).toBeGreaterThan(140);
  });
});
