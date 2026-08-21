import type { CardContent } from './Card';

/**
 * 1つのレーンに**一度に見せる**枠の数の上限（子ウィンドウの幅を決める、ObjectWindow.laneWidthFor）。
 * これを超える枠を持つスロットは、次の枠の頭を覗かせて横スクロールで送る。
 *
 * **枠数そのものの上限ではありません。** 10枠のスロットは10枠を並べ、そのうち4枠が見えます。
 */
export const LANE_CELLS_MAX = 4;

/**
 * レーンに並ぶ枠1つ（CardView.md 11節 枠（セル）を一級の単位にする）。**位置＝添字**で、
 * カードが入っているかどうかによらず枠そのものが1つの単位になる。
 *
 * 縁の色も重ねる文字も枠が持ち、カード（CardContent）は持たない。Cardは設置物・アイテム・手持ち・
 * 装備・怪我・レシピ一覧のすべてが通る共通のクラスなので、1つの画面の都合で契約を広げない。
 */
export interface LaneCell {
  /** その枠に入っているカード。空き枠ならundefined。 */
  readonly card?: CardContent;

  /**
   * その枠が受け入れる物（1つに決まっていなければundefined）。空き枠のときだけ、そのカードを薄く
   * 敷いて何を入れる枠なのかを示す。
   */
  readonly accepts?: CardContent;

  /**
   * 枠の縁を染める色（省略すると染めない）。**塗りではなく縁**なのは、塗るとカードが入った枠で
   * 隠れてしまうため。
   */
  readonly borderColor?: number;

  /** カードに重ねて出す短い文字（材料の「2/3」など）。他に書ける場所が無い情報だけを載せる。 */
  readonly overlay?: string;
}

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
 * カードの並びから、レーンへ渡す枠の並びを作る。カードの入った枠を前から並べ、そのあとに空枠を足す。
 * **クセの無い枠だけ**——縁の色も重ねる文字も持たない（持つのは材料の枠だけ、materialCells）。
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

/** 発見物の枠の数（Windows.md 5.1節）。1枠はレーンのカードと同じ幅。 */
export const FOUND_CELLS = 4;

/**
 * 見つかったものを並べる枠。**常にFOUND_CELLS個は空けておく**——見つかっていない分も破線の空枠と
 * して出すことで、そこが「見つかったものの居場所」だと分かる。収まらない分はレーンの横スクロールで
 * 送る（枠は縮めない、Windows.md 5.1節）。
 *
 * スロットの枠（plainCells）と違い、受け皿の空枠という考え方は無い——ここはプレイヤーが落とせる場所
 * ではなく、見つかったものが**通り過ぎる**場所なので。
 */
export function foundCells(found: readonly CardContent[]): readonly LaneCell[] {
  const cells: LaneCell[] = found.map((card) => ({ card }));
  while (cells.length < FOUND_CELLS) cells.push({});
  return cells;
}
