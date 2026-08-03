import { describe, expect, it } from 'vitest';
import { COLOR, fillColorFor } from '../../src/game/ui/theme';

/** 色を成分に分ける（塗りの色が緑寄りか茶寄りかを見るため）。 */
function channels(color: number): { red: number; green: number; blue: number } {
  return { red: (color >> 16) & 0xff, green: (color >> 8) & 0xff, blue: color & 0xff };
}

/**
 * ステータスバーの塗りの色（ScreenLayout.md ステータスエリア節）。満タンが良いステータスと悪い
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

  it('満たされ具合は色に影響しない（同じ域なら同じ色）', () => {
    // 値の位置ではなく域から引く。まだ安全域なら、満タンでなくても緑のまま。
    expect(fillColorFor('caution')).toBe(fillColorFor('caution'));
  });
});
