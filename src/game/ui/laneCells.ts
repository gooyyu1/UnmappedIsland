/**
 * 1つのレーンに並べて見せる枠の数の上限。**枠数の決まったスロットは、その数だけ枠を見せる**
 * （容量3なら3枠、1なら1枠）が、それ以上並べると画面からはみ出すのでここで頭打ちにし、
 * 入り切らない分は横スクロールで送る。
 *
 * これを超える枠数を宣言したスロットは、無制限として扱う（並べ切れないので違いが出ない）。
 */
export const LANE_CELLS_MAX = 4;

/**
 * 並びの末尾に足す、受け皿の空枠の数（CardLaneOptions.emptyCells）。
 *
 * - **枠数の決まったスロットは、埋まるまで常にその数だけ枠を見せる。** 1枠しか無い治療具の並びに
 *   2枠目が出ると「もう1つ当てられる」と誤って伝わる。
 * - **無制限のスロットは末尾に1枠だけ添える。** 前詰めのレーンは中身が空だと何も描かれず、
 *   落とせる場所かどうかが見て分からないため。
 *
 * unitCapacityはそのスロットが持つ枠の数（SlotSystem.md 2節）。中身の合計サイズの上限
 * （`capacity`）でも、型ごとの個数の制約（`accepts`の`max`）でもない。
 */
export function emptyCellsFor(
  cards: number,
  unitCapacity: number | undefined,
  acceptsCards: boolean,
): number {
  if (!acceptsCards) return 0;
  if (unitCapacity === undefined || unitCapacity > LANE_CELLS_MAX) return 1;
  return Math.max(0, unitCapacity - cards);
}
