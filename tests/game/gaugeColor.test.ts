import { describe, expect, it } from 'vitest';
import { COLOR, gaugeColorFor } from '../../src/game/ui/theme';

/** 色を成分に分ける（塗りが緑寄りか赤寄りかを見るため）。 */
function channels(color: number): { red: number; green: number; blue: number } {
  return { red: (color >> 16) & 0xff, green: (color >> 8) & 0xff, blue: color & 0xff };
}

/**
 * ゲージの塗りの色（CardView.md 8節）。**両端の見せ方と割合だけで決まる**ので、耐久度も残っている傷も
 * 工程の進捗も、この1つの関数が塗る。
 */
describe('ゲージの塗りの色', () => {
  it('満タン側がgoodなら、満タンは緑・尽きる直前は赤になる', () => {
    expect(gaugeColorFor(1, 'bad', 'good')).toBe(COLOR.durabilityFull);
    expect(gaugeColorFor(0, 'bad', 'good')).toBe(COLOR.durabilityEmpty);
  });

  it('両端を入れ替えると、色も入れ替わる', () => {
    // 残っている傷・入れ物の詰まり具合のように、増えるほど悪い量。
    expect(gaugeColorFor(1, 'good', 'bad')).toBe(COLOR.durabilityEmpty);
    expect(gaugeColorFor(0, 'good', 'bad')).toBe(COLOR.durabilityFull);
  });

  it('両端が同じ見せ方なら、割合によらず1色', () => {
    // 工程の進捗のように良し悪しを言わない量。「まだ進んでいない」を赤で急かさない。
    for (const ratio of [0, 0.5, 1]) {
      expect(gaugeColorFor(ratio, 'neutral', 'neutral')).toBe(COLOR.gaugeNeutral);
    }
  });

  it('範囲外の値は両端の色に丸める', () => {
    expect(gaugeColorFor(1.5, 'bad', 'good')).toBe(COLOR.durabilityFull);
    expect(gaugeColorFor(-0.5, 'bad', 'good')).toBe(COLOR.durabilityEmpty);
  });

  it('goodな端から離れるほど赤へ寄っていく', () => {
    // 琥珀は緑成分も高いため、赤と緑のどちらが勝っているかで「どちら寄りか」を見る。
    const ratios = [1, 0.75, 0.5, 0.25, 0];
    const redness = ratios.map((ratio) => {
      const { red, green } = channels(gaugeColorFor(ratio, 'bad', 'good'));
      return red - green;
    });

    for (let i = 1; i < ratios.length; i++) {
      expect(redness[i], `残り${ratios[i]}の赤寄り具合`).toBeGreaterThan(redness[i - 1]);
    }
  });

  it('途中で琥珀を通る（緑から赤へ直接混ぜた濁った色にならない）', () => {
    const half = channels(gaugeColorFor(0.5, 'bad', 'good'));

    expect(half.red, '琥珀は赤も緑も高い').toBeGreaterThan(200);
    expect(half.green).toBeGreaterThan(140);
  });
});
