import type { CardContent } from '../ui/Card';
import type { LaneCell } from '../ui/laneCells';

/**
 * 枠の数が決まっていないスロットか（前詰めで、末尾に受け皿の空枠を1つだけ添える）。
 *
 * 画面に一度に入る数（LANE_CELLS_MAX）とは無関係に判定する。入り切らない枠は横スクロールで送れるので、
 * 「あと何枠空いているか」は10枠のスロットでも見て取れる。
 */
export function unboundedSlot(cellCount: number | undefined): boolean {
  return cellCount === undefined;
}

/**
 * スロットの宣言（`cell_count`・受け入れの可否）をそのまま枠の並びにする。カードの入った枠を前から
 * 並べ、そのあとに空枠を足す。**クセの無い枠だけ**——縁の色も重ねる文字も持たない（持つのは材料の
 * 枠だけ、materialCells）。
 *
 * - **枠数の決まったスロットは、埋まるまで常にその数だけ枠を見せる。** 1枠しか無い治療具の並びに
 *   2枠目が出ると「もう1つ当てられる」と誤って伝わる。
 * - **無制限のスロットは末尾に1枠だけ添える。** 前詰めのレーンは中身が空だと何も描かれず、
 *   落とせる場所かどうかが見て分からないため。
 * - **受け入れないスロット（怪我）には添えない。** 出せば「落とせる」と誤って伝えることになる。
 *
 * cellCountはそのスロットが持つ枠の数（`cell_count`、SlotSystem.md 2節）。中身のかさの合計の
 * 上限（`capacity`）とは別物。
 */
export function plainCells(
  cards: readonly (CardContent | undefined)[],
  cellCount: number | undefined,
  acceptsCards: boolean,
): readonly LaneCell[] {
  const cells: LaneCell[] = cards.map((card) => ({ card }));
  for (let i = 0; i < emptyCells(cards.length, cellCount, acceptsCards); i++) cells.push({});
  return cells;
}

function emptyCells(cards: number, cellCount: number | undefined, acceptsCards: boolean): number {
  if (!acceptsCards) return 0;
  if (unboundedSlot(cellCount)) return 1;
  return Math.max(0, (cellCount ?? 0) - cards);
}
