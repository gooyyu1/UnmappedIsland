import { COLOR } from '../looks/theme';
import type { CardContent } from '../ui/Card';
import type { LaneCell } from '../ui/laneCells';
import type { CraftingMaterial } from './craftingView';
import type { CardPlacement } from './cardPlaces';
import type { ObjectCardStack, SlotView } from './PlayScreenView';
import type { ObjectGlobalId } from '../../domain/GlobalId';

/**
 * その場所を映すレーン（3つのレーンも子ウィンドウのタブも）に並べる枠（CardView.md 11節）。
 * **縁の色と重ねる文字を持つのは製作中オブジェクトの材料スロットだけ**で（materialCells）、他は
 * スロットの宣言をそのまま形にする（plainCells）。
 *
 * cardsはstacksと同じ並びの札（空き枠はundefined）。stacksは材料の枠だけが使う。
 *
 * **札の枠は、レーン上でもstacksと同じ位置に並べる。** 掴んだ札・重ねた先はレーン上の位置のまま
 * stacksから引かれる（ShownCards.stacksAt）ので、札をstacksと違う位置へ置くと別の束を指す。
 */
export function slotCells(
  slot: SlotView,
  stacks: readonly (ObjectCardStack | undefined)[],
  cards: readonly (CardContent | undefined)[],
  cycle: number,
  cardOfType: (objectGlobalId: ObjectGlobalId) => CardContent,
): readonly LaneCell[] {
  return slot.materials === undefined
    ? plainCells(slot, cards, cycle, cardOfType)
    : materialCells(slot.materials, stacks, cards, cycle, cardOfType);
}

/**
 * そのスロットを映すレーン上の落とし位置を、スロットの中の位置へ直したもの（直せなければundefined
 * ——位置を指さずに入れ、どの枠へ入るかはスロットが選ぶ）。
 *
 * **材料の枠のレーン上の位置はスロットの位置にならない。** 並ぶのは入っている物と要求ごとの空き枠で
 * （materialCells）、スロットの枠をそのまま映していないため。他のレーンは枠をその位置のまま並べる
 * （plainCells）ので、そのまま渡せる。
 */
export function slotPositionAt(slot: SlotView, at: CardPlacement): CardPlacement | undefined {
  return slot.materials === undefined ? at : undefined;
}

/**
 * スロットの宣言（空けておく枠・受け入れの可否・枠ごとの受け入れ）をそのまま枠の並びにする。
 * 渡された枠をその位置のまま並べ、足りない分だけ空枠を足す。**縁の色も重ねる文字も持たない。**
 *
 * - **枠数の決まったスロットは、埋まるまで常にその数だけ枠を見せる。** 1枠しか無い治療具の並びに
 *   2枠目が出ると「もう1つ当てられる」と誤って伝わる。
 * - **落とせば枠が増えるスロット（`cells: 'grows'`）は、末尾に1枠だけ添える。** 一度に増える枠は
 *   1つなので、見せる先も1つ。
 * - **受け入れないスロット（怪我）には添えない。** 出せば「落とせる」と誤って伝えることになる。
 * - **空き枠には、その枠が受け入れる型を薄く敷く**（`accepts`、材料の枠と同じ形）。何を入れる枠
 *   なのかを枠自身が言うのは、同じ並びの中で枠によって受け入れの宣言が違うときだけ
 *   （typesShownInEmptyCells）。
 */
function plainCells(
  slot: SlotView,
  cards: readonly (CardContent | undefined)[],
  cycle: number,
  cardOfType: (objectGlobalId: ObjectGlobalId) => CardContent,
): readonly LaneCell[] {
  const acceptsOf = (index: number): CardContent | undefined => {
    const types = slot.typesShownInEmptyCells[index] ?? [];
    return types.length === 0 ? undefined : cardOfType(cyclingType(types, cycle));
  };

  const cells: LaneCell[] = cards.map((card, index) =>
    card === undefined ? { accepts: acceptsOf(index) } : { card },
  );
  if (!slot.acceptsCards) return cells;

  const empties = slot.cells === 'grows' ? 1 : Math.max(0, slot.cells - cards.length);
  for (let i = 0; i < empties; i++) cells.push({ accepts: acceptsOf(cards.length + i) });
  return cells;
}

/**
 * 製作中オブジェクトの材料スロットの枠（CardView.md 13節）。**縁の色と重ねる文字を持つのはこの枠だけ。**
 *
 * **枠は要求ごとに1つ。** 何がどれだけ要るかを見せるのがこのレーンの役目なので、並ぶのは
 * 「入っている物」と「まだ入っていない要求」で、それ以外の空き枠は出さない。
 *
 * **材料スロットの空き枠は届かない**（PlayScreenView.cardsInが落とす）。スロットは要求ごとの枠を持つ（inProgressObjects）が、
 * 映しの層へは枠の受け入れが届かず（SlotView）、どの枠がどの要求のものかは入っている物が当てられた
 * 要求からしか辿れないので、空の枠では決められない。空の枠をそのまま並べると、
 * 透かしの入らない枠が要求の数だけ並び、その後ろに透かしの入った枠が続くことになる。
 *
 * materialsは残りの工程が要求している型（要求の順、craftingMaterials）。cycleは拍で、タグで書かれた
 * 要求の空き枠に出す型をこれで順に送る。cardOfTypeは型そのものを表す札を引く。
 */
function materialCells(
  materials: readonly CraftingMaterial[],
  stacks: readonly (ObjectCardStack | undefined)[],
  cards: readonly (CardContent | undefined)[],
  cycle: number,
  cardOfType: (objectGlobalId: ObjectGlobalId) => CardContent,
): readonly LaneCell[] {
  // 枠に入っている物が、どの要求へ当てられたか（CraftingMaterial.allocated）。**型からは引かない**
  // ——タグの要求は当てはまる型が複数あり、当てる先は成立する組み合わせを探して振り替えられるので、
  // 型から引くと実際に消える物と縁の色・数の出る枠がずれる。
  //
  // 束の中身が2つの要求に分かれて当たることがある（置いたとおりでは揃わず振り替えたとき、別々の
  // 工程で当たったとき、crafting.allocateContentsToRequirements）。印を出せる要求は1つなので、多く
  // 当たっているほうを、並ぶ数が同じなら要求の順（今の工程が先）で先のほうを採る。どれにも当たって
  // いない物は印を持たない。貸し出して待ち印だけが残った束も、待っている個体（awaited）で引く。
  const materialOf = (stack: ObjectCardStack | undefined): CraftingMaterial | undefined => {
    if (stack === undefined) return undefined;
    const members = [...stack.objects.map((object) => object.instanceId), ...(stack.awaited ?? [])];
    let chosen: CraftingMaterial | undefined;
    let chosenCount = 0;
    for (const material of materials) {
      const count = members.filter((id) => material.allocated.has(id)).length;
      if (count > chosenCount) [chosen, chosenCount] = [material, count];
    }
    return chosen;
  };

  const marksFor = (material: CraftingMaterial | undefined): LaneCell => {
    // どの要求にも当たっていない物は、取り出すための枠が残るだけで印は持たない。
    if (material === undefined) return {};
    return {
      // 空き枠のうちに何を入れる枠なのかを見せる（EmptyCard）。
      accepts: cardOfType(cyclingType(material.objectGlobalIds, cycle)),
      borderColor: material.inCurrentStep ? COLOR.cellCurrentStep : COLOR.cellLaterStep,
      // 1つしか要らない枠に数を出しても、枠そのものが既に言っていることの繰り返しにしかならない。
      overlay: material.needed >= 2 ? `${material.held}/${material.needed}` : undefined,
    };
  };

  const shown = new Set(stacks.map(materialOf));
  const cells: LaneCell[] = [];
  cards.forEach((card, index) => {
    if (card === undefined) return;
    cells.push({ card, ...marksFor(materialOf(stacks[index])) });
  });

  // まだ1つも入っていない要求の空き枠を、要求の順に足す。
  for (const material of materials) {
    if (!shown.has(material)) cells.push(marksFor(material));
  }
  return cells;
}

/**
 * その空き枠に、今出す型。**タグで書かれた受け入れは当てはまる型を順に出す**——どれか1つを選んで
 * 出すと、その型でなければ入らないように見えてしまう。
 */
function cyclingType(candidates: readonly ObjectGlobalId[], cycle: number): ObjectGlobalId {
  return candidates[cycle % candidates.length] ?? candidates[0];
}

/**
 * その場所の枠に、拍ごとに出し替わる透かしがあるか。**出す型が1つしかない枠しか無いなら、拍を
 * 進めても見た目は変わらない**ので、引き直す理由が無い（PlayScene.advanceEmptyCellCycle）。
 *
 * **入っているかは見ない。** 透かしが出るのは空き枠だけだが、埋まっている枠も次の拍までに空きうる
 * ので、見ても外れるのは「1拍ぶん余分に引き直す」側にしかならない。
 */
export function cellsCycleWithBeat(slot: SlotView): boolean {
  const cycles = (candidates: readonly ObjectGlobalId[]): boolean => candidates.length >= 2;
  return (
    slot.typesShownInEmptyCells.some(cycles) ||
    (slot.materials ?? []).some((material) => cycles(material.objectGlobalIds))
  );
}
