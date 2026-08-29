import { describe, expect, it } from 'vitest';
import { SCREEN_DEPTH } from '../../src/game/looks/screenDepth';

/**
 * 画面に重ねる層の階梯（SCREEN_DEPTH）の自動テスト。
 *
 * 確かめるのは**離れた2つの前後関係**だけ。宣言の並びは奥から手前だが、並びだけでは「この2つは
 * 入れ替えてはいけない」が読めず、値を1つ動かしたときに気付けない。
 *
 * Phaserの表示物そのものは節点（jsdomの無いnode環境）で作れないので、層の値で留める。
 */
describe('画面の層', () => {
  it('吹き出しは、レーンに並ぶ札より手前', () => {
    // レーンの中のカードは既定の層（0）に居る（CardLane）。生成順に頼っていたときは、後から
    // 作られた札やボタンが吹き出しの手前に入っていた。
    expect(SCREEN_DEPTH.tooltip).toBeGreaterThan(0);
  });

  it('吹き出しは、飛んでいる札・運んでいる札より手前', () => {
    // 掴んで運んでいる札は自前の層に居る（CardTable）ので、生成順では越えられない。
    expect(SCREEN_DEPTH.tooltip).toBeGreaterThan(SCREEN_DEPTH.flyingCard);
  });

  it('吹き出しも時間帯の翳りを受ける', () => {
    // 翳りは画面全体にかぶる（ScreenLayout.md 7.5.2節）。夜でも変わらず読めている必要があるのは
    // ドーナツグラフと致命的域の枠だけで、吹き出しは他の表示物と同じ明るさで読む。
    expect(SCREEN_DEPTH.tooltip).toBeLessThan(SCREEN_DEPTH.skyTint);
    expect(SCREEN_DEPTH.ring).toBeGreaterThan(SCREEN_DEPTH.skyTint);
    expect(SCREEN_DEPTH.alertFrame).toBeGreaterThan(SCREEN_DEPTH.skyTint);
  });
});
