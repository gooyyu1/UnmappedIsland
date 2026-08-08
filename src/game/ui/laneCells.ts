import type { CardContent } from './Card';

/**
 * 1つのレーンに並べて見せる枠の数の上限。**枠数の決まったスロットは、その数だけ枠を見せる**
 * （容量3なら3枠、1なら1枠）が、それ以上並べると画面からはみ出すのでここで頭打ちにし、
 * 入り切らない分は横スクロールで送る。
 *
 * これを超える枠数を宣言したスロットは、無制限として扱う（並べ切れないので違いが出ない）。
 */
export const LANE_CELLS_MAX = 4;

/**
 * レーンに並ぶ枠1つ（ScreenLayout.md 枠（セル）を一級の単位にする節）。**位置＝添字**で、
 * カードが入っているかどうかによらず枠そのものが1つの単位になる。
 *
 * 縁の色も重ねる文字も枠が持ち、カード（CardContent）は持たない。Cardは設置物・アイテム・手持ち・
 * 装備・怪我・レシピ一覧のすべてが通る共通のクラスなので、1つの画面の都合で契約を広げない。
 */
export interface LaneCell {
  /** その枠に入っているカード。空き枠ならundefined。 */
  readonly card?: CardContent;

  /**
   * 枠の縁を染める色（省略すると染めない）。**塗りではなく縁**なのは、塗るとカードが入った枠で
   * 隠れてしまうため。
   */
  readonly borderColor?: number;

  /** カードに重ねて出す短い文字（材料の「2/3」など）。他に書ける場所が無い情報だけを載せる。 */
  readonly overlay?: string;
}

/**
 * 枠の数が決まっていないスロットか。**並べ切れない数を宣言したスロットも同じ扱い**にする
 * （並べられない以上、無制限との違いが画面に出ない）。
 */
export function unboundedSlot(cellCount: number | undefined): boolean {
  return cellCount === undefined || cellCount > LANE_CELLS_MAX;
}

/**
 * カードの並びから、レーンへ渡す枠の並びを作る。カードの入った枠を前から並べ、そのあとに空枠を足す。
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
export function cellsFor(
  cards: readonly (CardContent | undefined)[],
  cellCount: number | undefined,
  acceptsCards: boolean,
): readonly LaneCell[] {
  const cells: LaneCell[] = cards.map((card) => ({ card }));
  for (let i = 0; i < emptyCellsFor(cards.length, cellCount, acceptsCards); i++) cells.push({});
  return cells;
}

function emptyCellsFor(cards: number, cellCount: number | undefined, acceptsCards: boolean): number {
  if (!acceptsCards) return 0;
  if (unboundedSlot(cellCount)) return 1;
  return Math.max(0, (cellCount ?? 0) - cards);
}
