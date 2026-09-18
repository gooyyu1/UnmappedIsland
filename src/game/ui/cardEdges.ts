/**
 * カードの端の操作の契約（CardInteraction.md）。
 *
 * **Cardから離してあるのは、画面を持たない層（ShownCards）が端の並びを組むため。** 向きの並びまで
 * 含めて渡さないと、どちらの端から調べるかを映しの側が書き写すことになる（cardFaceと同じ理由）。
 */

/** 移動先のレーンがカードのどちら側にあるか。 */
export type CardEdgeDirection = 'up' | 'down';

/** 端の向き（上が先）。カードが出す端はこの順で調べる。 */
export const EDGE_DIRECTIONS: readonly CardEdgeDirection[] = ['up', 'down'];

/**
 * カードの端（上下1/6）を押したときの操作。1回の呼び出しで束のうち1つが動く。
 * 押し続けている間は繰り返し呼ばれる（Card.addEdge参照）。
 */
export interface CardEdgeAction {
  readonly direction: CardEdgeDirection;
  readonly onTap: () => void;
}
