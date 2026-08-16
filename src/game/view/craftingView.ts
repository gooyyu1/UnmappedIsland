import type { WorldCodex } from '../../domain/defs/WorldCodex';
import type { NewGameSession } from '../../domain/generation/NewGame';
import type { WorldObject } from '../../domain/runtime/WorldObject';
import { autoFillMaterials } from '../../domain/runtime/autoFill';
import {
  advanceCrafting,
  currentStep,
  remainingRequirements,
  stepIsSupplied,
} from '../../domain/runtime/crafting';
import { MATERIALS_SLOT, PROGRESS_PROPERTY } from '../../loader/inProgressObjects';
import type { CardAction } from './PlayScreenView';
import { recipeOf } from './recipeList';

/**
 * 製作中オブジェクトが出す操作と、材料の枠が要求しているもの（RecipeSystem.md 4節）。
 *
 * **画面はレシピを知りません。** 作業できるか・あと何が要るか・押したら何が起きるかはここが答え、
 * 画面はボタンと枠の飾りに直すだけになる。カードが宣言しているアクション（`actions.yaml`）と
 * 同じ形（CardAction）で答えるのはそのため——ボタンの作り方を2通りにしない。
 */

/** 材料スロットが要求している型1つぶん。 */
export interface CraftingMaterial {
  /** 要求している物の型（PlayScreenView.cardOfTypeで札にする）。 */
  readonly objectGlobalId: number;
  /** 残りの工程が要求する数と、今その枠に入っている数。 */
  readonly needed: number;
  readonly held: number;
  /** 今の工程が要求しているか（後の工程のぶんならfalse）。 */
  readonly inCurrentStep: boolean;
}

/**
 * その物が製作中オブジェクトなら出す操作（そうでなければ空）。並びは**自動補充・作業する・中断**で、
 * 押しても子ウィンドウは閉じない（Windows.md 1.1節。閉じるのは映しているものが世界から消えたとき）。
 */
export function craftingActions(
  object: WorldObject,
  codex: WorldCodex,
  game: NewGameSession,
): readonly CardAction[] {
  const recipe = recipeOf(object, codex);
  if (recipe === undefined) return [];

  const materialsSlotId = codex.slotNames.getId(MATERIALS_SLOT);
  const step = currentStep(recipe, progressOf(object, codex));
  const supplied = step !== undefined && stepIsSupplied(object, materialsSlotId, step);

  return [
    {
      name: '自動補充',
      description: '手持ちと足元から、足りない素材を入れる。入れ物の中までは探さない。',
      minutes: 0,
      enabled: true,
      reason: undefined,
      execute: () => {
        autoFillMaterials(
          object,
          materialsSlotId,
          [contentsOf(game.player.instance, codex, 'hand'), locationItems(game, codex)],
          codex,
          remainingRequirements(recipe, progressOf(object, codex)),
        );
      },
    },
    {
      name: '作業する',
      description: '揃っている素材を使って、次の工程を進める。',
      minutes: step?.durationMinutes ?? 0,
      enabled: supplied,
      reason: supplied ? undefined : '素材が足りない。',
      execute: () => {
        advanceCrafting(object, recipe, materialsSlotId, codex, game.session);
      },
    },
    {
      name: '中断',
      description: '作りかけをやめる。入れてある素材はその場へこぼれる。',
      minutes: 0,
      enabled: true,
      reason: undefined,
      execute: () => {
        object.destroy();
      },
    },
  ];
}

/**
 * その物が製作中オブジェクトなら、材料スロットが要求している型ごとの枠（そうでなければundefined）。
 *
 * **枠は残りの工程が要求する型ごとに1つ**で、要求の順に並ぶ。出番の終わった型は挙げない——こぼした
 * あとの空枠が残っていると、まだ何か入れられるように見えてしまうため。
 */
export function craftingMaterials(
  container: WorldObject,
  codex: WorldCodex,
): readonly CraftingMaterial[] | undefined {
  const recipe = recipeOf(container, codex);
  if (recipe === undefined) return undefined;

  const progress = progressOf(container, codex);
  const inStep = new Set(currentStep(recipe, progress)?.requirements.map((r) => r.objectGlobalId));
  const held = heldByType(container, codex);

  return [...remainingRequirements(recipe, progress)].map(([objectGlobalId, needed]) => ({
    objectGlobalId,
    needed,
    held: held.get(objectGlobalId) ?? 0,
    inCurrentStep: inStep.has(objectGlobalId),
  }));
}

/** 材料スロットに今入っている数を、型ごとに数える。 */
function heldByType(container: WorldObject, codex: WorldCodex): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  for (const object of contentsOf(container, codex, MATERIALS_SLOT)) {
    const globalId = object.def.globalId;
    counts.set(globalId, (counts.get(globalId) ?? 0) + 1);
  }
  return counts;
}

function progressOf(object: WorldObject, codex: WorldCodex): number {
  return object.getNumber(codex.propertyNames.getId(PROGRESS_PROPERTY));
}

function contentsOf(owner: WorldObject, codex: WorldCodex, slotName: string): readonly WorldObject[] {
  return owner.tryGetSlot(codex.slotNames.getId(slotName))?.contents ?? [];
}

function locationItems(game: NewGameSession, codex: WorldCodex): readonly WorldObject[] {
  const location = game.player.location?.instance;
  return location === undefined ? [] : contentsOf(location, codex, 'items');
}
