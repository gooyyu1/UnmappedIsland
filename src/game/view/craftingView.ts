import type { WorldCodex } from '../../domain/WorldCodex';
import type { NewGameSession } from '../../domain/generation/NewGame';
import type { WorldObject } from '../../domain/WorldObject';
import { autoFillMaterials } from '../../domain/autoFill';
import { advanceCrafting, currentStep, remainingRequirements, stepIsSupplied } from '../../domain/crafting';
import type { CardAction } from './cardOperations';
import { recipeOf } from './recipeList';

/**
 * 製作中オブジェクトが出す操作と、材料の枠が要求しているもの（RecipeSystem.md 4節）。
 *
 * **画面はレシピを知りません。** 作業できるか・あと何が要るか・押したら何が起きるかはここが答え、
 * 画面はボタンと枠の飾りに直すだけになる。カードが宣言しているアクション（`actions.yaml`）と
 * 同じ形（CardAction）で答えるのはそのため——ボタンの作り方を2通りにしない。
 */

/** 材料スロットが要求している1件ぶん。 */
export interface CraftingMaterial {
  /**
   * 要求に当てはまる型（PlayScreenView.cardOfTypeで札にする）。
   *
   * **1つとは限らない。** 要求はタグでも書けるので（刃物・縫い道具）、当てはまる型が複数になる。
   * どれを出すかは画面の都合——今は1秒ごとに順に出して、どれでもよいことを見せている。
   */
  readonly objectGlobalIds: readonly number[];
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

  const materialsSlotId = codex.vocabulary.engine.materialsSlotId;
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
        // 探す順は手持ち → 足元。入れ物（かご）の中までは探さない——探すと、しまった物が勝手に
        // 出ていくことになり、しまうという操作の意味が無くなる。
        autoFillMaterials(
          object,
          materialsSlotId,
          [
            game.player.instance.tryGetSlot(codex.vocabulary.world.handSlotId)?.contents ?? [],
            game.player.location?.items ?? [],
          ],
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
        advanceCrafting(object, materialsSlotId, recipe, codex, game.session);
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
  const inStep = new Set(currentStep(recipe, progress)?.requirements.map((r) => r.match.key));
  const contents = container.tryGetSlot(codex.vocabulary.engine.materialsSlotId)?.contents ?? [];

  return remainingRequirements(recipe, progress).map((requirement) => ({
    objectGlobalIds: requirement.match.candidates(codex.objects).map((def) => def.globalId),
    needed: requirement.count,
    held: contents.filter((object) => requirement.requires(object.def)).length,
    inCurrentStep: inStep.has(requirement.match.key),
  }));
}

function progressOf(object: WorldObject, codex: WorldCodex): number {
  return object.tryGetProperty(codex.vocabulary.engine.progressId)?.number ?? 0;
}
