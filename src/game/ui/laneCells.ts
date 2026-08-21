/**
 * レーンに渡す枠の契約（LaneCell）と、**画面の寸法が枠の数を決める**もの。枠の数をワールドの宣言が
 * 決めるもの——スロットの`cell_count`から並べる枠（view/plainCells）と、レシピの要求から並べる枠
 * （view/materialCells）——は映しの側にある（Layers.md 4節）。
 */

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
