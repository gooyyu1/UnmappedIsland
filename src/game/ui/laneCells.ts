/**
 * レーンに渡す枠の契約（LaneCell）と、**枠の数を画面の側が決めるもの**（一度に見せる枠数と、その
 * 枠数で要る幅）。枠の数をワールドの宣言が決めるもの——スロットの`cell_count`やレシピの要求から
 * 並べる枠（view/slotCells）——は映しの側にある（Layers.md 4節）。
 */

import type { CardContent } from './Card';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { SIZE } from '../looks/theme';
import { uiText } from '../../locale/uiTexts';

/** 頭打ちに掛かるときに覗かせる、次の枠の頭の幅。隙間ではなくカードの縁だと分かる幅を取る。 */
const PEEK_WIDTH = 40;

/**
 * 1つのレーンに**一度に見せる**枠の数の上限（子ウィンドウの幅を決める、SlotPane.width）。
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

/**
 * 絞り込みが隠している枚数を重ねた枠（ScreenLayout.md 8.1.7節）。**残っている札の有無によらず、
 * 1枚でも隠していれば出す**——見えている札がレーンの全部なのかどうかは、そこを見ないと分からない。
 *
 * 重ねるのは**先頭の空き枠**の1つ。空き枠は札の後ろに出るので、「この先に隠れているものがN枚ある」と
 * 読める並びになる。空き枠が1つも無い並び（枠数の決まったスロットが埋まっている）では末尾の枠に
 * 重ねる——そこが並びの終わりで、続きがあることを言う場所として最も近い。
 */
export function hiddenCountCells(cells: readonly LaneCell[], hidden: number): readonly LaneCell[] {
  if (hidden === 0) return cells;

  const empty = cells.findIndex((cell) => cell.card === undefined);
  const at = empty === -1 ? cells.length - 1 : empty;
  const overlay = uiText('lane_hidden_cards', { count: String(hidden) });
  return cells.map((cell, index) => (index === at ? { ...cell, overlay } : cell));
}

/**
 * その数の枠を並べるのに要るレーンの幅（左右の余白込み）。**一度に見せるのはLANE_CELLS_MAXまで**で、
 * それを超える枠を持つ並びは、右にまだ続くことが分かるよう次の枠の頭を覗かせる。
 *
 * カードの幅だけで決めると最後の枠がはみ出すので、レーンの左右の余白（CardLaneのSIZE.margin）も足す。
 */
export function laneWidthForCells(metrics: ScreenMetrics, wanted: number): number {
  const shown = Math.min(LANE_CELLS_MAX, wanted);
  const cards = shown * metrics.px(SIZE.cardWidth) + (shown - 1) * metrics.px(SIZE.gap);
  const peek = wanted > LANE_CELLS_MAX ? metrics.px(PEEK_WIDTH) : 0;
  return cards + peek + metrics.px(SIZE.margin) * 2;
}
