import { stackedLength } from '../../ui/scroll';
import type { ScreenMetrics } from './ScreenMetrics';
import { SIZE } from './theme';

/**
 * プロパティのタブ（Windows.md 6節）の寸法。左にカテゴリの縦タブ、右にバーの列。
 */

/** カテゴリの縦タブの幅・高さと、タブ同士の間隔。 */
export const CATEGORY_WIDTH = 180;
const CATEGORY_HEIGHT = SIZE.iconButton;
export const CATEGORY_GAP = 12;

/** 行同士の間隔。 */
export const ROW_GAP = 16;

/**
 * この面が要る高さを決める行数。**プロパティの数で窓の寸法を変えない**ので、これを超える分は
 * 縦にスクロールして送る。
 */
const ROWS_SHOWN = 5;

/** index番目（0始まり）のカテゴリの縦タブが占める縦の範囲（面の上端から）。 */
export function categoryTabSpan(metrics: ScreenMetrics, index: number): { top: number; height: number } {
  const height = metrics.px(CATEGORY_HEIGHT);
  return { top: index * (height + metrics.px(CATEGORY_GAP)), height };
}

/**
 * この面が要る高さ。**行の列と縦タブの列の、高いほう**——縦タブは送らないので、カテゴリが増えれば
 * 面ごと伸ばさないと末尾のタブが窓の外（下の操作のボタンの上）へはみ出す。カテゴリの数は型で決まり、
 * タブを切り替えても変わらないので、窓の寸法は開いている間は動かない。
 */
export function propertiesPaneHeight(
  metrics: ScreenMetrics,
  rowHeight: number,
  categoryCount: number,
): number {
  const rows = stackedLength(rowHeight, metrics.px(ROW_GAP), ROWS_SHOWN);
  // 縦タブの末尾は、並べる側と同じ式（categoryTabSpan）から出す——別の式で足すと丸めで食い違う。
  const last = categoryCount === 0 ? undefined : categoryTabSpan(metrics, categoryCount - 1);
  const tabs = last === undefined ? 0 : last.top + last.height;
  return Math.max(rows, tabs);
}
