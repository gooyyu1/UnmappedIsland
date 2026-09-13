import { RecipeRequirementDef, RECIPE_AXIS } from './RecipeDef';
import type { RecipeDef, RecipeStepDef } from './RecipeDef';
import { spendDurationAndReportParticipantsAlive } from './actionTime';
import { InteractionRelation } from './ReferenceRoot';
import type { Slot } from './Slot';
import type { WorldObject } from './WorldObject';
import type { ObjectGlobalId } from './GlobalId';

/**
 * その製作中オブジェクトが従っているレシピ（製作中オブジェクトでなければundefined）。
 *
 * 製作中オブジェクトは完成品の変種で、**どのレシピから生まれたかは軸`recipe`の値**
 * （GameElementDefinition.md 3.5節）。完成品はその素の型。
 */
export function recipeOf(target: WorldObject): RecipeDef | undefined {
  const codex = target.session.codex;
  const recipeName = codex.variationsOf(target.def).get(RECIPE_AXIS);
  if (recipeName === undefined) return undefined;
  return codex.baseOf(target.def).recipesProducingThis.find((candidate) => candidate.name === recipeName);
}

/**
 * その製作中オブジェクトの材料スロット（RecipeSystem.md 4節。持っていなければundefined）。
 *
 * **どの枠が材料かは製作中オブジェクト自身から決まる**ので、呼び出し側に名指しさせない。
 * スロットのIDは素の識別子で、取り違えても型は通り、中身が空の枠として黙って読めてしまう。
 */
export function materialsSlotOf(inProgress: WorldObject): Slot | undefined {
  return inProgress.tryGetSlot(inProgress.session.codex.vocabulary.engine.materialsSlotId);
}

/**
 * 製作中オブジェクトで、今取り掛かっている工程（RecipeSystem.md 1節）。
 *
 * 進捗は工程が宣言した仕事の量を積み上げた値なので、**進捗が入る区間**がそのまま工程を指す。
 * 作り手の手際で動くのは経過する時間だけなので、この区切りは誰が作っていても同じ
 * （RecipeDef.minutesFor）。全工程を終えていればundefined（完成はprogressのon_maxが起こす）。
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
 * 枠は型ごとにまとまっている（inProgressObjects.requirementCells）ので、「この型はもう要らない」も
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
function allocateContentsToRequirements(
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
 * 製作中オブジェクトは置き場所を言うタグを引き継ぐ（同5節）ので、道具はitemsへ、炉のような設置物は
 * fixturesへ入る。どのスロットも受け入れないなら、行き先を失ったspawnと同じく枠の要件を無視して
 * 先頭のスロットへ落とす——場違いな場所にでも出ている方が、黙って画面から消えるよりよい。
 */
export function spawnInProgressObject(
  location: WorldObject,
  inProgressDefGlobalId: ObjectGlobalId,
): WorldObject {
  const spawned = location.session.createObject(inProgressDefGlobalId);
  spawned.spillTo(location);
  return spawned;
}

/**
 * その工程が要求する素材と道具のうち、材料スロットに揃っている割合（0〜1）。
 *
 * **道具（`consume: false`）も数に入れる。** 作業を止めるのは素材と同じで、揃っていなければ
 * 工程は進まない。要求を持たない工程は1（揃っている）。
 */
export function stepSupplyRatio(inProgress: WorldObject, step: RecipeStepDef): number {
  const allocated = allocateContentsToRequirements(materialsSlotOf(inProgress)?.contents ?? [], step);
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
export function stepIsSupplied(inProgress: WorldObject, step: RecipeStepDef): boolean {
  return stepSupplyRatio(inProgress, step) >= 1;
}

/**
 * 工程を1つ進める。**作り手の手際を引いた後の分数**ぶんゲーム内時間を進め、**工程が宣言した
 * 仕事の量**ぶん進捗を進め、素材（`consume: true`）を要求数だけ消費する。道具（`consume: false`）は
 * 減らさない。最後の工程を終えたら、余分の卓（`RecipeDef.surplus`）を1回引く。
 *
 * 「在庫を確認し、指定数量だけ消費し、足りなければ何もしない」という複合動作はYAMLの語彙では
 * 表せないため、ここに置く（RecipeSystem.md 2節・4節）。**時間と効果の順序はactions/combinationsと
 * 同じ**（ActionSystem.md 2節）。
 *
 * @returns 進めたら true。そもそも製作中オブジェクトでない、作業できる状況にない、素材が足りない、
 *   全工程を終えている、経過中に製作中オブジェクト自身が失われたなら false。最後の場合だけは
 *   時間が経過している（actionTime参照）。
 */
export function tryAdvanceCrafting(inProgress: WorldObject, agent: WorldObject): boolean {
  const session = inProgress.session;
  const codex = session.codex;
  // 従っているレシピは製作中オブジェクト自身が名乗っている（recipeOf）ので、外から渡させない。
  const recipe = recipeOf(inProgress);
  if (recipe === undefined) return false;

  // 世界が全レシピへ一律に課している条件（GameElementDefinition.md 13.4節）。画面も同じ問いで
  // ボタンの可否と理由を出すが、**止めるのはここ**——画面を通らない経路から進められては困る。
  //
  // 問うのは関係を張る前。crafting_conditionsは操作ではなく（11.5節）、画面も関係を張らずに同じ
  // 問いを出すので、内側で問うと押す前に見せた可否と実際の可否がずれる。
  if (codex.unmetCraftingRequirement(agent) !== undefined) return false;

  // 工程は操作なので、関係を張った状態で走らせる（11.5節）。patientは製作中オブジェクト——工程の
  // 宣言が乗っている側（RecipeSystem.md 4節の`interactions.work`相当）。instrumentは居ない——
  // 素材も道具も運ばれてきた側ではなく、既に材料スロットの中身だから（運び入れる操作は7.10節で、
  // そちらでは入れる物がinstrument）。実行なので動作主も主張する（whileActing）——経過中に配られて
  // 待たされた手番は、工程を進め終えたこの切れ目で起きる。
  return new InteractionRelation(inProgress, agent, undefined).whileActing((context) => {
    const progressGlobalId = codex.vocabulary.engine.progressId;
    const step = currentStep(recipe, inProgress.tryGetProperty(progressGlobalId)?.number ?? 0);
    if (step === undefined) return false;
    if (!stepIsSupplied(inProgress, step)) return false;

    // actions/combinationsと同じ順序で、時間を進めてから効果（消費と進捗）を適用する
    // （ActionSystem.md 2節）。素材は作業のあいだ材料スロットに在り、無くなるのは作業を終えた
    // 時点で、完成品もその時刻に生まれる。
    //
    // **経過するのは作り手の手際を引いた後の分数**（RecipeDef.minutesFor）で、進捗が受け取るのは
    // 工程が宣言した仕事の量そのもの。腕が変えるのは仕事にかかる時間で、仕事の量ではない。
    //
    // 生存を見るのは製作中オブジェクトだけ（actionsのselfにあたる）。これを失うと進捗の行き先も
    // 完成品の生まれる場所も無くなり、黙って何も起きない結果になる。素材は違う——経過中に失われても
    // 打ち切らない。それは開始時に済ませた在庫確認（stepIsSupplied）の再判定にあたる（同6.1節）。
    if (!spendDurationAndReportParticipantsAlive(recipe.minutesFor(step, agent), session, [inProgress]))
      return false;

    // 消費が進捗より先なのは、進捗が上限を超えた瞬間に完成し、残っている物は親へこぼれてしまうため。
    const allocated = allocateContentsToRequirements(materialsSlotOf(inProgress)?.contents ?? [], step);
    for (const requirement of step.requirements) {
      if (!requirement.consume) continue;
      for (const object of allocated.get(requirement) ?? []) object.destroy();
    }

    inProgress.tryGetProperty(progressGlobalId)?.add(step.durationMinutes);

    // 工程の進捗バー（CardView.md 10.1節、inProgressObjects.FINISHED_STEPS_PROPERTY）が読む純粋な
    // 回数。工程が1つのレシピにはそもそも宣言が無いので、持っていなければ何も起きない。
    inProgress.tryGetProperty(codex.vocabulary.engine.finishedStepsId)?.add(1);

    // 最後の工程を終えていれば、上のaddが上限へ届いて完成している（progressのon_maxがbecomeを
    // 起こす、RecipeSystem.md 1節）ので、**もうレシピの軸を名乗っていない**。余分の卓を引くのは
    // ここ——同じ個体が既に成果物になっているので、卓は自分と同じ物を1つ増やす形で書ける。
    if (recipeOf(inProgress) === undefined && recipe.surplus !== undefined)
      inProgress.applyActiveEffect(recipe.surplus, context);

    spillUnneeded(inProgress, recipe);
    return true;
  });
}

/**
 * どの残り工程も要求しなくなった型を、親へこぼす。
 *
 * 出番の終わった素材や道具を箱に留めると、劣化して消えるうえ、空にならない枠を表示から
 * 隠せなくなる（隠すと取り出せなくなる）。完成時に残りがこぼれるのと同じ扱いを、工程の
 * 区切りへ前倒ししている（RecipeSystem.md 3節）。
 */
function spillUnneeded(inProgress: WorldObject, recipe: RecipeDef): void {
  const parent = inProgress.parent;
  // こぼす先は、製作中オブジェクト自身が居るスロット（足元なら足元、かごの中ならかごの中）。
  const parentSlot = inProgress.parentSlot?.def;
  if (parent === undefined || parentSlot === undefined) return;

  const stillNeeded = remainingRequirements(
    recipe,
    inProgress.tryGetProperty(inProgress.session.codex.vocabulary.engine.progressId)?.number ?? 0,
  );
  const leftovers = (materialsSlotOf(inProgress)?.contents ?? []).filter(
    (object) => !stillNeeded.some((requirement) => requirement.requires(object.def)),
  );

  for (const object of leftovers) object.moveToSlotOrRejection(parent.getSlot(parentSlot.globalId));
}
