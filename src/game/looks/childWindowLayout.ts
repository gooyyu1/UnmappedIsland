import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from './ScreenMetrics';
import { SIZE } from './theme';

/**
 * 子ウィンドウ（探索・スロット・オブジェクト・プロパティ）で共通の寸法。
 * 個々のウィンドウ固有の寸法（横幅の決め方など）は各ウィンドウが持つ。
 */

/**
 * 子ウィンドウの**最低の横幅**（u単位）。中身の並びを持たないウィンドウ——説明文だけのタブ、
 * ステータスの詳細——はちょうどこの幅になる。狭い画面では中身ごと縮める。
 *
 * **枠の少ないスロットでも、これより狭くしない。** 幅は最下段の操作のボタンの幅でもあるので、
 * 中身の少なさに合わせて詰めると、映しているものとは関係のない都合でボタンが窮屈になる。
 */
export const MIN_WINDOW_WIDTH = 760;

/** 内側パディングと、内容同士の間隔。 */
export const WINDOW_PADDING = 32;
export const CONTENT_GAP = 24;

/** 操作ボタンの高さ（アイコンボタンと同じ最小タップ領域）と、幅の上限・間隔。 */
export const ACTION_HEIGHT = SIZE.iconButton;
export const ACTION_MAX_WIDTH = 420;
export const ACTION_GAP = 24;

/**
 * 最下段の「閉じる」の行。**窓の下端に置き、幅は上限つきで中央寄せ**——どの子ウィンドウでも同じ
 * 場所・同じ大きさで閉じられるようにする。
 */
export function closeRow(metrics: ScreenMetrics, window: Rect): Rect {
  const padding = metrics.px(WINDOW_PADDING);
  const height = metrics.px(ACTION_HEIGHT);
  const width = Math.min(metrics.px(ACTION_MAX_WIDTH), window.width - padding * 2);
  return {
    x: window.x + (window.width - width) / 2,
    y: window.y + window.height - padding - height,
    width,
    height,
  };
}

/** 子ウィンドウを領域の中央へ置いた矩形。領域に収まらない大きさでも、画面の外へは出さない。 */
export function centerWindow(metrics: ScreenMetrics, area: Rect, width: number, height: number): Rect {
  return {
    x: Math.max(0, Math.min(area.x + (area.width - width) / 2, metrics.width - width)),
    y: Math.max(0, Math.min(area.y + (area.height - height) / 2, metrics.height - height)),
    width,
    height,
  };
}
