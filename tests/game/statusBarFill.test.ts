import { describe, expect, it } from 'vitest';
import { COLOR, fadedFill, fillColorFor } from '../../src/game/looks/theme';

/** 色を成分に分ける（塗りの色が緑寄りか茶寄りかを見るため）。 */
function channels(color: number): { red: number; green: number; blue: number } {
  return { red: (color >> 16) & 0xff, green: (color >> 8) & 0xff, blue: color & 0xff };
}

/**
 * ステータスバーの塗りの色（StatusArea.md）。満タンが良いステータスと悪い
 * ステータスが並ぶため、良し悪しは塗りの長さではなく色が表す。
 */
describe('ステータスバーの塗りの色', () => {
  it('安全域は緑、致命的域は茶で、両端は定義した色そのものになる', () => {
    expect(fillColorFor('safe')).toBe(COLOR.statusBarFillSafe);
    expect(fillColorFor('fatal')).toBe(COLOR.statusBarFillFatal);
  });

  it('域が深刻になるほど、緑から茶へ寄っていく', () => {
    const greens = (['safe', 'watch', 'caution', 'danger', 'fatal'] as const).map(
      (alert) => channels(fillColorFor(alert)).green,
    );

    // 緑成分が単調に減る＝深刻になるほど緑から離れる。
    for (let i = 1; i < greens.length; i++) expect(greens[i]).toBeLessThan(greens[i - 1]);
  });

  it('増えた分の帯は、塗りをトラック側へ薄めた色になる', () => {
    // 固定の1色ではなく塗りから引くので、青い水も黄色い油も「これから満ちる分」として読める
    // （StatusArea.md 4節 変わった分の帯）。
    const water = 0x2f86d8;
    const band = channels(fadedFill(water));
    const fill = channels(water);
    const track = channels(COLOR.statusBarTrack);

    for (const key of ['red', 'green', 'blue'] as const) {
      const [low, high] = [Math.min(fill[key], track[key]), Math.max(fill[key], track[key])];
      expect(band[key], `${key}が塗りとトラックの間に無い`).toBeGreaterThanOrEqual(low);
      expect(band[key], `${key}が塗りとトラックの間に無い`).toBeLessThanOrEqual(high);
    }
    expect(fadedFill(water), '塗りそのものではない（帯と塗りの境目が見える）').not.toBe(water);
    expect(fadedFill(water), '減った分の赤とは別物').not.toBe(COLOR.statusBarLag);
  });

  it('満たされ具合は色に影響しない（同じ域なら同じ色）', () => {
    // 値の位置ではなく域から引く。まだ安全域なら、満タンでなくても緑のまま。
    expect(fillColorFor('caution')).toBe(fillColorFor('caution'));
  });
});
