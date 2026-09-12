import { describe, expect, it } from 'vitest';
import { cssColor, cssColorWithAlpha } from '../../src/util/cssColor';

/**
 * 16進の色をCSSの文字列へ直す道具の検査。
 *
 * **書き出す形そのものを見る。** Phaserは落ち影や縁取りの色を文字列で受け取り、読めない形を渡されても
 * 例外を投げずに黒か透明で描くので、形が崩れても画面は静かに変わるだけになる。
 */
describe('CSSの色', () => {
  it('上の桁が0でも6桁で書く', () => {
    // '#0' のように縮むと、CSSは色として読めない。
    expect(cssColor(0x000000)).toBe('#000000');
    expect(cssColor(0x1b3a4b)).toBe('#1b3a4b');
  });

  it('濃さを添えるときは、色を3つの成分へ割る', () => {
    expect(cssColorWithAlpha(0x000000, 0.7)).toBe('rgba(0,0,0,0.7)');
    expect(cssColorWithAlpha(0x1b3a4b, 0.35)).toBe('rgba(27,58,75,0.35)');
  });
});
