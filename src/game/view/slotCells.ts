import { COLOR } from '../looks/theme';
import type { CardContent } from '../ui/Card';
import type { LaneCell } from '../ui/laneCells';
import type { CraftingMaterial } from './craftingView';
import type { ObjectCardStack, SlotView } from './PlayScreenView';

/**
 * その場所を映すレーン（3つのレーンも子ウィンドウのタブも）に並べる枠（CardView.md 11節）。
 * **枠ごとの飾りを持つのは製作中オブジェクトの材料スロットだけ**で（materialCells）、他はスロットの
 * 宣言をそのまま形にする（plainCells）。
 *
 * cardsはstacksと同じ並びの札（空き枠はundefined）。cycleとcardOfTypeは材料の枠だけが使う。
 */
export function slotCells(
  slot: SlotView,
  stacks: readonly (ObjectCardStack | undefined)[],
  cards: readonly (CardContent | undefined)[],
  cycle: number,
  cardOfType: (objectGlobalId: number) => CardContent,
): readonly LaneCell[] {
  return slot.materials === undefined
    ? plainCells(slot, cards)
    : materialCells(slot.materials, stacks, cards, cycle, cardOfType);
}

/**
 * スロットの宣言（空けておく枠・受け入れの可否）をそのまま枠の並びにする。カードの入った枠を前から
 * 並べ、そのあとに空枠を足す。**クセの無い枠だけ**——縁の色も重ねる文字も持たない。
 *
 * - **枠数の決まったスロットは、埋まるまで常にその数だけ枠を見せる。** 1枠しか無い治療具の並びに
 *   2枠目が出ると「もう1つ当てられる」と誤って伝わる。
 * - **落とせば枠が増えるスロット（`cells: 'grows'`）は、末尾に1枠だけ添える。** 一度に増える枠は
 *   1つなので、見せる先も1つ。
 * - **受け入れないスロット（怪我）には添えない。** 出せば「落とせる」と誤って伝えることになる。
 */
export function plainCells(slot: SlotView, cards: readonly (CardContent | undefined)[]): readonly LaneCell[] {
  const cells: LaneCell[] = cards.map((card) => ({ card }));
  if (!slot.acceptsCards) return cells;

  const empties = slot.cells === 'grows' ? 1 : Math.max(0, slot.cells - cards.length);
  for (let i = 0; i < empties; i++) cells.push({});
  return cells;
}

/**
 * 製作中オブジェクトの材料スロットの枠（CardView.md 13節）。**縁の色と重ねる文字を持つのはこの枠だけ。**
 *
 * **枠は要求ごとに1つ。** 何がどれだけ要るかを見せるのがこのレーンの役目なので、並ぶのは
 * 「入っている物」と「まだ入っていない要求」で、それ以外の空き枠は出さない。
 *
 * **材料スロットの空き枠はここでは使わない。** スロットは要求ごとの枠を持つ（inProgressObjects）が、
 * どの枠がどの要求のものかは中身からしか辿れず、空の枠では決められない。空の枠をそのまま並べると、
 * 透かしの入らない枠が要求の数だけ並び、その後ろに透かしの入った枠が続くことになる。
 *
 * materialsは残りの工程が要求している型（要求の順、craftingMaterials）。cycleは拍で、タグで書かれた
 * 要求の空き枠に出す型をこれで順に送る。cardOfTypeは型そのものを表す札を引く。
 */
export function materialCells(
  materials: readonly CraftingMaterial[],
  stacks: readonly (ObjectCardStack | undefined)[],
  cards: readonly (CardContent | undefined)[],
  cycle: number,
  cardOfType: (objectGlobalId: number) => CardContent,
): readonly LaneCell[] {
  // 枠に入っている物から、それがどの要求のものかを引く。**タグの要求は当てはまる型が複数ある**ので、
  // 型からの逆引きは1対1にならない（先に書いた要求を採る、craftingのallocateと同じ順）。
  const materialOf = (objectGlobalId: number | undefined): CraftingMaterial | undefined =>
    objectGlobalId === undefined
      ? undefined
      : materials.find((material) => material.objectGlobalIds.includes(objectGlobalId));

  const marksFor = (material: CraftingMaterial | undefined): LaneCell => {
    // もう要求されない型は、取り出すための枠が残るだけで印は持たない。
    if (material === undefined) return {};
    return {
      // 空き枠のうちに何を入れる枠なのかを見せる（EmptyCard）。
      accepts: cardOfType(cyclingType(material, cycle)),
      borderColor: material.inCurrentStep ? COLOR.cellCurrentStep : COLOR.cellLaterStep,
      // 1つしか要らない枠に数を出しても、枠そのものが既に言っていることの繰り返しにしかならない。
      overlay: material.needed >= 2 ? `${material.held}/${material.needed}` : undefined,
    };
  };

  const shown = new Set(stacks.map((stack) => materialOf(stack?.objectGlobalId)));
  const cells: LaneCell[] = [];
  cards.forEach((card, index) => {
    if (card === undefined) return;
    cells.push({ card, ...marksFor(materialOf(stacks[index]?.objectGlobalId)) });
  });

  // まだ1つも入っていない要求の空き枠を、要求の順に足す。
  for (const material of materials) {
    if (!shown.has(material)) cells.push(marksFor(material));
  }
  return cells;
}

/**
 * その要求の空き枠に、今出す型。**タグの要求は当てはまる型を順に出す**——どれか1つを選んで出すと、
 * その型でなければ入らないように見えてしまう。
 */
function cyclingType(material: CraftingMaterial, cycle: number): number {
  const candidates = material.objectGlobalIds;
  return candidates[cycle % candidates.length] ?? candidates[0];
}
