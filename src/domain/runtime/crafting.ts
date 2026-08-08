import type { WorldCodex } from '../defs/WorldCodex';
import type { RecipeDef, RecipeStepDef } from '../defs/RecipeDef';
import type { WorldObject } from './WorldObject';
import type { WorldSession } from './WorldSession';

/**
 * 製作中オブジェクトで、今取り掛かっている工程（RecipeSystem.md 1節）。
 *
 * 進捗は工程の所要時間を積み上げた値なので、**進捗が入る区間**がそのまま工程を指す。
 * 全工程を終えていればundefined（完成はprogressのon_overflowが起こす）。
 */
export function currentStep(recipe: RecipeDef, progress: number): RecipeStepDef | undefined {
  let consumed = 0;
  for (const step of recipe.steps) {
    consumed += step.durationMinutes;
    if (progress < consumed) return step;
  }
  return undefined;
}

/**
 * まだ終わっていない工程が要求する型 → 残りの必要数の合計。
 *
 * 枠は型ごとにまとまっている（inProgressObjects.materialCells）ので、「この型はもう要らない」も
 * 「あといくつ要る」も、この表だけで答えられる。
 */
export function remainingRequirements(recipe: RecipeDef, progress: number): Map<number, number> {
  const remaining = new Map<number, number>();
  let consumed = 0;
  for (const step of recipe.steps) {
    consumed += step.durationMinutes;
    if (progress >= consumed) continue;
    for (const requirement of step.requirements)
      remaining.set(
        requirement.objectGlobalId,
        (remaining.get(requirement.objectGlobalId) ?? 0) + requirement.quantity,
      );
  }
  return remaining;
}

/** その工程が要求する素材と道具が、材料スロットに揃っているか。 */
export function stepIsSupplied(
  inProgress: WorldObject,
  materialsSlotGlobalId: number,
  step: RecipeStepDef,
): boolean {
  const contents = inProgress.tryGetSlot(materialsSlotGlobalId)?.contents ?? [];
  return step.requirements.every(
    (requirement) =>
      contents.filter((object) => object.def.globalId === requirement.objectGlobalId).length >=
      requirement.quantity,
  );
}

/**
 * 工程を1つ進める。素材（`consume: true`）を要求数だけ消費し、その工程の所要時間ぶん
 * ゲーム内時間と進捗を進める。道具（`consume: false`）は減らさない。
 *
 * 「在庫を確認し、指定数量だけ消費し、足りなければ何もしない」という複合動作はYAMLの語彙では
 * 表せないため、ここに置く（RecipeSystem.md 2節・4節）。
 *
 * @returns 進めたら true。素材が足りない、または全工程を終えているなら false（何も起きない）。
 */
export function advanceCrafting(
  inProgress: WorldObject,
  recipe: RecipeDef,
  materialsSlotGlobalId: number,
  codex: WorldCodex,
  session: WorldSession,
): boolean {
  const progressGlobalId = codex.propertyNames.getId('progress');
  const step = currentStep(recipe, inProgress.getNumber(progressGlobalId));
  if (step === undefined) return false;
  if (!stepIsSupplied(inProgress, materialsSlotGlobalId, step)) return false;

  const slot = inProgress.tryGetSlot(materialsSlotGlobalId);
  for (const requirement of step.requirements) {
    if (!requirement.consume) continue;
    const spent = (slot?.contents ?? [])
      .filter((object) => object.def.globalId === requirement.objectGlobalId)
      .slice(0, requirement.quantity);
    for (const object of spent) object.destroy(codex.wellKnown);
  }

  // 時間を先に進めてから進捗を足す。進捗が上限を超えた瞬間に完成品が生まれるので、
  // 生まれた物が「作業を終えた時刻」に居るようにするため。
  session.advanceWorldTime(step.durationMinutes);
  inProgress.addNumber(progressGlobalId, step.durationMinutes, session);

  spillUnneeded(inProgress, materialsSlotGlobalId, recipe, codex);
  return true;
}

/**
 * どの残り工程も要求しなくなった型を、親へこぼす。
 *
 * 出番の終わった素材や道具を箱に留めると、劣化して消えるうえ、空にならない枠を表示から
 * 隠せなくなる（隠すと取り出せなくなる）。完成時に残りがこぼれるのと同じ扱いを、工程の
 * 区切りへ前倒ししている（RecipeSystem.md 3節）。
 */
function spillUnneeded(
  inProgress: WorldObject,
  materialsSlotGlobalId: number,
  recipe: RecipeDef,
  codex: WorldCodex,
): void {
  const parent = inProgress.parent;
  // こぼす先は、製作中オブジェクト自身が居るスロット（足元なら足元、かごの中ならかごの中）。
  const parentSlot = parent?.def.slotDefs[inProgress.parentSlotLocalId];
  if (parent === undefined || parentSlot === undefined) return;

  const stillNeeded = remainingRequirements(
    recipe,
    inProgress.getNumber(codex.propertyNames.getId('progress')),
  );
  const leftovers = (inProgress.tryGetSlot(materialsSlotGlobalId)?.contents ?? []).filter(
    (object) => !stillNeeded.has(object.def.globalId),
  );

  for (const object of leftovers) object.moveToSlot(parent, parentSlot.globalId, codex.wellKnown);
}
