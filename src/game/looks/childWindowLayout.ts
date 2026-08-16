import type { Rect, ScreenMetrics } from './ScreenMetrics';
import { SIZE } from './theme';

/**
 * 子ウィンドウ（探索・スロット・オブジェクト・プロパティ）で共通の寸法。
 * 個々のウィンドウ固有の寸法（横幅の決め方など）は各ウィンドウが持つ。
 */

/** 内側パディングと、内容同士の間隔。 */
export const WINDOW_PADDING = 32;
export const CONTENT_GAP = 24;

/** 操作ボタンの高さ（アイコンボタンと同じ最小タップ領域）と、幅の上限・間隔。 */
export const ACTION_HEIGHT = SIZE.iconButton;
export const ACTION_MAX_WIDTH = 420;
export const ACTION_GAP = 24;

/** 子ウィンドウを領域の中央へ置いた矩形。領域に収まらない大きさでも、画面の外へは出さない。 */
export function centerWindow(metrics: ScreenMetrics, area: Rect, width: number, height: number): Rect {
  return {
    x: Math.max(0, Math.min(area.x + (area.width - width) / 2, metrics.width - width)),
    y: Math.max(0, Math.min(area.y + (area.height - height) / 2, metrics.height - height)),
    width,
    height,
  };
}
