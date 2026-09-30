import { describe, expect, it } from 'vitest';
import { categoryTabSpan, propertiesPaneHeight } from '../../src/game/looks/propertiesPaneLayout';
import { ScreenMetrics } from '../../src/game/looks/ScreenMetrics';

/**
 * プロパティのタブ（Windows.md 6節）の縦タブが、面の高さに収まるか。**縦タブは送らない**ので、
 * 面からはみ出したタブは窓の下の操作のボタンに重なる。カテゴリはタグを宣言するたびに増えるので、
 * 収まる本数を前提にできない。
 */
describe('プロパティのタブの縦タブ', () => {
  /** 行の高さ（StatusBarのBAR_HEIGHT、u=1の画面）。 */
  const ROW_HEIGHT = 36;

  it.each([1, 4, 5, 8, 12])('カテゴリが%i個でも、末尾の縦タブが面の中に入る', (count) => {
    const metrics = new ScreenMetrics(900, 640);
    const last = categoryTabSpan(metrics, count - 1);

    expect(last.top + last.height).toBeLessThanOrEqual(
      propertiesPaneHeight(metrics, metrics.px(ROW_HEIGHT), count),
    );
  });
});
