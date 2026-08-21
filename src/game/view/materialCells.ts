import { COLOR } from '../looks/theme';
import type { CardContent } from '../ui/Card';
import type { LaneCell } from '../ui/laneCells';
import type { CraftingMaterial } from './craftingView';
import type { ObjectCardStack } from './PlayScreenView';

/**
 * 製作中オブジェクトの材料スロットの枠（CardView.md 13節）。**クセの無い枠（plainCells）に対して、
 * 縁の色と重ねる文字を持つのはこちらだけ。**
 *
 * **枠は要求ごとに1つ。** 何がどれだけ要るかを見せるのがこのレーンの役目なので、並ぶのは
 * 「入っている物」と「まだ入っていない要求」で、それ以外の空き枠は出さない。
 *
 * **材料スロットの空き枠はここでは使わない。** スロットは要求ごとの枠を持つ（inProgressObjects）が、
 * どの枠がどの要求のものかは中身からしか辿れず、空の枠では決められない。空の枠をそのまま並べると、
 * 透かしの入らない枠が要求の数だけ並び、その後ろに透かしの入った枠が続くことになる。
 */
export function materialCells(options: {
  /** 残りの工程が要求している型（要求の順、craftingMaterials）。 */
  readonly materials: readonly CraftingMaterial[];
  /** 材料スロットの枠の並び（空き枠はundefined）。 */
  readonly stacks: readonly (ObjectCardStack | undefined)[];
  /** stacksと同じ並びの札。 */
  readonly cards: readonly (CardContent | undefined)[];
  /** 拍。タグの要求の空き枠に出す型を、これで順に送る。 */
  readonly cycle: number;
  /** 型そのものを表す札（薄く敷いて何を入れる枠なのかを見せる）。 */
  readonly cardOfType: (objectGlobalId: number) => CardContent;
}): readonly LaneCell[] {
  const { materials, stacks, cards, cycle, cardOfType } = options;

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
