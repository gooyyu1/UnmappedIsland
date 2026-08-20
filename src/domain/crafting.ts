import type { WorldCodex } from './WorldCodex';
import { RecipeRequirementDef } from './RecipeDef';
import type { RecipeDef, RecipeStepDef } from './RecipeDef';
import { spendDuration } from './actionTime';
import type { WorldObject } from './WorldObject';
import type { WorldSession } from './WorldSession';

/**
 * 製作中オブジェクトで、今取り掛かっている工程（RecipeSystem.md 1節）。
 *
 * 進捗は工程の所要時間を積み上げた値なので、**進捗が入る区間**がそのまま工程を指す。
 * 全工程を終えていればundefined（完成はprogressのon_maxが起こす）。
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
export function remainingRequirements(recipe: RecipeDef, progress: number): readonly RecipeRequirementDef[] {
  const remaining = new Map<string, RecipeRequirementDef>();
  let consumed = 0;
  for (const step of recipe.steps) {
    consumed += step.durationMinutes;
    if (progress >= consumed) continue;
    for (const requirement of step.requirements) {
      const merged = remaining.get(requirement.match.key);
      // 同じ指定を複数の工程が要求するなら、枠は1つで足りるので数だけ足し合わせる。
      // どれか1つでも消費するなら素材として扱う（枠に残しておく理由が消えないため）。
      remaining.set(
        requirement.match.key,
        merged === undefined
          ? requirement
          : new RecipeRequirementDef(
              requirement.match,
              merged.count + requirement.count,
              merged.consume || requirement.consume,
            ),
      );
    }
  }
  return [...remaining.values()];
}

/**
 * 工程の要求ごとに、材料スロットの中身を宣言順に割り当てる。
 *
 * **1つの物を2つの要求で二重に数えない。** 要求はタグでも書けるので、尖った石1つが
 * `cutting_tool`の要求にも`sharp_stone`の要求にも当てはまりうる。先に書いた要求から取る。
 */
function allocate(
  contents: readonly WorldObject[],
  step: RecipeStepDef,
): ReadonlyMap<RecipeRequirementDef, readonly WorldObject[]> {
  const used = new Set<WorldObject>();
  const allocated = new Map<RecipeRequirementDef, readonly WorldObject[]>();
  for (const requirement of step.requirements) {
    const taken: WorldObject[] = [];
    for (const object of contents) {
      if (taken.length >= requirement.count) break;
      if (used.has(object) || !requirement.requires(object.def)) continue;
      used.add(object);
      taken.push(object);
    }
    allocated.set(requirement, taken);
  }
  return allocated;
}

/**
 * レシピ一覧から選ばれた製作中オブジェクトを、その場所へ生む（RecipeSystem.md 1節）。
 *
 * 置き場所はスロット名で指さず、受け入れられる側に選ばせる（spawnのintoと同じ規約、9.4節）。
 * 製作中オブジェクトは完成品のタグを引き継ぐ（同5節）ので、道具はitemsへ、炉のような設置物は
 * fixturesへ入る。どのスロットも受け入れないなら、行き先を失ったspawnと同じく枠の要件を無視して
 * 先頭のスロットへ落とす——場違いな場所にでも出ている方が、黙って画面から消えるよりよい。
 */
export function spawnInProgressObject(
  session: WorldSession,
  location: WorldObject,
  inProgressDefGlobalId: number,
): WorldObject {
  const spawned = session.spawn(inProgressDefGlobalId);
  if (!spawned.moveIntoFirstAcceptingSlot(location)) spawned.moveIntoFirstAcceptingSlot(location, true);
  return spawned;
}

/**
 * その工程が要求する素材と道具のうち、材料スロットに揃っている割合（0〜1）。
 *
 * **道具（`consume: false`）も数に入れる。** 作業を止めるのは素材と同じで、揃っていなければ
 * 工程は進まない。要求を持たない工程は1（揃っている）。
 */
export function stepSupplyRatio(
  inProgress: WorldObject,
  materialsSlotGlobalId: number,
  step: RecipeStepDef,
): number {
  const allocated = allocate(inProgress.tryGetSlot(materialsSlotGlobalId)?.contents ?? [], step);
  let needed = 0;
  let held = 0;
  for (const requirement of step.requirements) {
    needed += requirement.count;
    // 割り当ては要求数で打ち切られているので、余分に入っている分は数に入らない。
    held += allocated.get(requirement)?.length ?? 0;
  }
  return needed === 0 ? 1 : held / needed;
}

/** その工程が要求する素材と道具が、材料スロットに揃っているか。 */
export function stepIsSupplied(
  inProgress: WorldObject,
  materialsSlotGlobalId: number,
  step: RecipeStepDef,
): boolean {
  return stepSupplyRatio(inProgress, materialsSlotGlobalId, step) >= 1;
}

/**
 * 工程を1つ進める。その工程の所要時間ぶんゲーム内時間と進捗を進め、素材（`consume: true`）を
 * 要求数だけ消費する。道具（`consume: false`）は減らさない。
 *
 * 「在庫を確認し、指定数量だけ消費し、足りなければ何もしない」という複合動作はYAMLの語彙では
 * 表せないため、ここに置く（RecipeSystem.md 2節・4節）。**時間と効果の順序はactions/combinationsと
 * 同じ**（ActionSystem.md 2節）。
 *
 * @returns 進めたら true。素材が足りない、全工程を終えている、経過中に製作中オブジェクト自身が
 *   失われたなら false。最後の場合だけは時間が経過している（actionTime参照）。
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

  // actions/combinationsと同じ順序で、時間を進めてから効果（消費と進捗）を適用する
  // （ActionSystem.md 2節）。素材は作業のあいだ材料スロットに在り、無くなるのは作業を終えた
  // 時点で、完成品もその時刻に生まれる。
  //
  // 生存を見るのは製作中オブジェクトだけ（actionsのselfにあたる）。これを失うと進捗の行き先も
  // 完成品の生まれる場所も無くなり、黙って何も起きない結果になる。素材は違う——経過中に失われても
  // 打ち切らない。それは開始時に済ませた在庫確認（stepIsSupplied）の再判定にあたる（同6.1節）。
  if (!spendDuration(step.durationMinutes, session, [inProgress])) return false;

  // 消費が進捗より先なのは、進捗が上限を超えた瞬間に完成し、残っている物は親へこぼれてしまうため。
  const allocated = allocate(inProgress.tryGetSlot(materialsSlotGlobalId)?.contents ?? [], step);
  for (const requirement of step.requirements) {
    if (!requirement.consume) continue;
    for (const object of allocated.get(requirement) ?? []) object.destroy();
  }

  inProgress.addNumber(progressGlobalId, step.durationMinutes, session);

  // 工程の進捗バー（CardView.md 10.1節、inProgressObjects.FINISHED_STEPS_PROPERTY）が読む純粋な
  // 回数。工程が1つのレシピにはそもそも宣言が無いので、addNumberは黙って何もしない
  // （WorldObject.addNumber参照）。
  const finishedStepsGlobalId = codex.propertyNames.tryGetId('finished_steps');
  if (finishedStepsGlobalId !== undefined) inProgress.addNumber(finishedStepsGlobalId, 1, session);

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
    (object) => !stillNeeded.some((requirement) => requirement.requires(object.def)),
  );

  for (const object of leftovers) object.moveToSlot(parent, parentSlot.globalId);
}
