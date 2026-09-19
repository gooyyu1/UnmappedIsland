import { RecipeRequirementDef, RECIPE_AXIS } from './RecipeDef';
import type { RecipeDef, RecipeStepDef } from './RecipeDef';
import { spendDurationAndReportParticipantsAlive } from './actionTime';
import { InteractionRelation } from './ReferenceRoot';
import type { Slot } from './Slot';
import type { TypeMatchRule } from './TypeMatchRule';
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
 * その製作中オブジェクトが積み上げた進捗（宣言を持たなければ0）。
 *
 * **どこまで進んだかは製作中オブジェクト自身が持つ**ので、呼び出し側に引かせない。引く式が散ると、
 * 別の物の進捗を渡しても型は通り、今やっていない工程が答えとして返る。
 */
function progressOf(inProgress: WorldObject): number {
  return inProgress.tryGetProperty(inProgress.session.codex.vocabulary.engine.progressId)?.number ?? 0;
}

/**
 * 製作中オブジェクトで、今取り掛かっている工程（RecipeSystem.md 1節）。
 *
 * 進捗は工程が宣言した仕事の量を積み上げた値なので、**進捗が入る区間**がそのまま工程を指す。
 * 作り手の手際で動くのは経過する時間だけなので、この区切りは誰が作っていても同じ
 * （RecipeDef.minutesFor）。製作中オブジェクトでない物と、全工程を終えた物ではundefined
 * （完成はprogressのon_maxが起こす）。
 */
export function currentStepOf(inProgress: WorldObject): RecipeStepDef | undefined {
  return remainingStepsOf(inProgress).at(0);
}

/**
 * まだ終わっていない工程（先頭が今取り掛かっている工程。製作中オブジェクトでなければ空）。
 *
 * **区切りを引くのはここだけ。** 進捗から工程を割り出す式が散ると、同じ物へ問うているのに
 * 「今の工程」と「残りの要求」が別の工程を指しうる。
 */
function remainingStepsOf(inProgress: WorldObject): readonly RecipeStepDef[] {
  const recipe = recipeOf(inProgress);
  if (recipe === undefined) return [];

  const progress = progressOf(inProgress);
  const remaining: RecipeStepDef[] = [];
  let consumed = 0;
  for (const step of recipe.steps) {
    consumed += step.durationMinutes;
    if (progress < consumed) remaining.push(step);
  }
  return remaining;
}

/**
 * まだ終わっていない工程が要求する型 → 残りの必要数の合計（製作中オブジェクトでなければ空）。
 *
 * 枠は型ごとにまとまっている（inProgressObjects.requirementCells）ので、「この型はもう要らない」も
 * 「あといくつ要る」も、この表だけで答えられる。
 */
export function remainingRequirementsOf(inProgress: WorldObject): readonly RecipeRequirementDef[] {
  const remaining = new Map<string, MergedRequirement>();
  for (const step of remainingStepsOf(inProgress))
    for (const requirement of step.requirements)
      // 同じ指定を複数の工程が要求するなら、枠は1つで足りるので数だけまとめる（mergeRequirement）。
      remaining.set(
        requirement.match.key,
        mergeRequirement(mergedFor(remaining, requirement), requirement.count, requirement.consume),
      );

  return [...remaining.values()].map(
    (merged) => new RecipeRequirementDef(merged.match, merged.consumed + merged.held, merged.consumed > 0),
  );
}

/**
 * 残りの工程の要求（`match.key`）ごとに、材料スロットの中身で**満たせている数**
 * （製作中オブジェクトでなければ空）。要求そのものの数はremainingRequirementsOfが答える。
 *
 * **まとめ方は要求の数え方と同じ**（mergeRequirement）——素材は工程ごとに無くなるので足し合わせ、
 * 道具は工程を跨いで同じ1つが働くので最も多い工程のぶんだけ数える。
 *
 * **当てるのは工程ごと。** 1つの物が2つの要求を満たさないのは**同じ工程の中**での話で、前の工程で
 * 道具として使った物を後の工程が素材として消費するのは成り立つ。残りの要求へ一度に当てると、
 * その物を数え落として「持っているのに足りない」と出る。消費した物は次の工程へ持ち越さない。
 */
export function heldPerRemainingRequirement(inProgress: WorldObject): ReadonlyMap<string, number> {
  const contents = materialsSlotOf(inProgress)?.contents ?? [];
  const consumed = new Set<WorldObject>();
  const held = new Map<string, MergedRequirement>();

  for (const step of remainingStepsOf(inProgress)) {
    const allocated = allocateContentsToRequirements(
      contents.filter((object) => !consumed.has(object)),
      step.requirements,
    );
    for (const requirement of step.requirements) {
      const taken = allocated.get(requirement) ?? [];
      held.set(
        requirement.match.key,
        mergeRequirement(mergedFor(held, requirement), taken.length, requirement.consume),
      );
      if (requirement.consume) for (const object of taken) consumed.add(object);
    }
  }

  return new Map([...held].map(([key, merged]) => [key, merged.consumed + merged.held]));
}

/** 同じ指定への要求を、消費されるぶんと手元に居続けるぶんに分けて数えた途中経過。 */
interface MergedRequirement {
  readonly match: TypeMatchRule;

  /** 素材（`consume: true`）として要求されている数の合計。工程ごとに無くなるので足し合わせる。 */
  readonly consumed: number;

  /**
   * 道具（`consume: false`）として要求されている数のうち最も多いもの。**足し合わせない**——
   * 道具は工程を跨いで同じ1つが働くので、いくつの工程が要求しても要る数は増えない。足すと、
   * 削り続ける工程の数だけ刃物を集めさせることになる（自動補充も同じ数を引き寄せる、autoFill）。
   */
  readonly held: number;
}

/** その指定についてここまでに数えた途中経過（まだ数えていなければ空の途中経過）。 */
function mergedFor(
  counted: ReadonlyMap<string, MergedRequirement>,
  requirement: RecipeRequirementDef,
): MergedRequirement {
  return counted.get(requirement.match.key) ?? { match: requirement.match, consumed: 0, held: 0 };
}

/**
 * 工程1つぶんの数（要求された個数でも、実際に当てられた数でも）を途中経過へ足す。**数える対象が
 * 何であれまとめ方は同じ**——足し合わせるか最も多い工程のぶんを採るかを決めるのはconsumeだけ。
 */
function mergeRequirement(merged: MergedRequirement, count: number, consume: boolean): MergedRequirement {
  return consume
    ? { ...merged, consumed: merged.consumed + count }
    : { ...merged, held: Math.max(merged.held, count) };
}

/**
 * 要求ごとに、材料スロットの中身を割り当てる（GameElementDefinition.md 13.1節）。
 *
 * **1つの物を2つの要求で二重に数えない。** 要求はタグでも書けるので、尖った石1つが
 * `cutting_tool`の要求にも`sharp_stone`の要求にも当てはまりうる。
 *
 * **成立する割り当てが在るなら、必ずそれを見つける。** 当てる先を宣言順に先着で決めると、尖った石を
 * `cutting_tool`へ当てた時点で`sharp_stone`の要求が空振りし、石斧も持っているのに「材料が足りない」と
 * 答える。**当てた先は後から振り替える**（増加路を辿る＝二部グラフの最大マッチング）ので、宣言の順も
 * 中身の並び順も答えを変えない。揃わないときも当てられた数は最大なので、充足率
 * （currentStepSupplyRatio）は詰められるところまで詰めた値になる。
 */
function allocateContentsToRequirements(
  contents: readonly WorldObject[],
  requirements: readonly RecipeRequirementDef[],
): ReadonlyMap<RecipeRequirementDef, readonly WorldObject[]> {
  // 要求1件は`count`個の受け口。どの受け口も物1つを受けるので、要求の個数は受け口の数だけで表せる。
  const openings = requirements.flatMap((requirement) =>
    Array.from({ length: requirement.count }, () => requirement),
  );
  const takenBy = new Map<WorldObject, number>();

  /**
   * その受け口へ物を1つ当てられたか。既に当たっている物でも、**その相手を別の物へ振り替えられるなら
   * 奪う**（増加路の探索）。visitedはこの1回の探索で見た物——同じ物を辿り直して回らないための印。
   */
  const tryTakeFor = (opening: number, visited: Set<WorldObject>): boolean => {
    for (const object of contents) {
      if (visited.has(object) || !openings[opening].requires(object.def)) continue;
      visited.add(object);
      const incumbent = takenBy.get(object);
      if (incumbent !== undefined && !tryTakeFor(incumbent, visited)) continue;
      takenBy.set(object, opening);
      return true;
    }
    return false;
  };

  for (let opening = 0; opening < openings.length; opening += 1) tryTakeFor(opening, new Set());

  const allocated = new Map<RecipeRequirementDef, WorldObject[]>(
    requirements.map((requirement) => [requirement, []]),
  );
  for (const [object, opening] of takenBy) allocated.get(openings[opening])?.push(object);
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
 * 今の工程（currentStepOf）が要求する素材と道具のうち、材料スロットに揃っている割合（0〜1）。
 * 進める工程が無ければundefined——揃えるものが無いので、割合そのものが立たない。
 *
 * **道具（`consume: false`）も数に入れる。** 作業を止めるのは素材と同じで、揃っていなければ
 * 工程は進まない。要求を持たない工程は1（揃っている）。
 */
export function currentStepSupplyRatio(inProgress: WorldObject): number | undefined {
  const step = currentStepOf(inProgress);
  if (step === undefined) return undefined;

  const allocated = allocateContentsToRequirements(
    materialsSlotOf(inProgress)?.contents ?? [],
    step.requirements,
  );
  let needed = 0;
  let held = 0;
  for (const requirement of step.requirements) {
    needed += requirement.count;
    // 割り当ては受け口の数で打ち切られているので、余分に入っている分は数に入らない。
    held += allocated.get(requirement)?.length ?? 0;
  }
  return needed === 0 ? 1 : held / needed;
}

/** 今の工程が要求する素材と道具が、材料スロットに揃っているか（進める工程が無ければfalse）。 */
export function currentStepIsSupplied(inProgress: WorldObject): boolean {
  return (currentStepSupplyRatio(inProgress) ?? 0) >= 1;
}

/**
 * 工程を1つ進める。**作り手の手際を積んだ後の分数**ぶんゲーム内時間を進め、**工程が宣言した
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
  const codex = inProgress.session.codex;
  // 従っているレシピは製作中オブジェクト自身が名乗っている（recipeOf）ので、外から渡させない。
  const recipe = recipeOf(inProgress);
  if (recipe === undefined) return false;

  // 世界が全レシピへ一律に課している条件（GameElementDefinition.md 13.3節）。画面も同じ問いで
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
    const step = currentStepOf(inProgress);
    if (step === undefined) return false;
    if (!currentStepIsSupplied(inProgress)) return false;

    // actions/combinationsと同じ順序で、時間を進めてから効果（消費と進捗）を適用する
    // （ActionSystem.md 2節）。素材は作業のあいだ材料スロットに在り、無くなるのは作業を終えた
    // 時点で、完成品もその時刻に生まれる。
    //
    // **経過するのは作り手の手際を積んだ後の分数**（RecipeDef.minutesFor）で、進捗が受け取るのは
    // 工程が宣言した仕事の量そのもの。腕が変えるのは仕事にかかる時間で、仕事の量ではない。
    //
    // 生存を見るのは製作中オブジェクトだけ（actionsのselfにあたる）。これを失うと進捗の行き先も
    // 完成品の生まれる場所も無くなり、黙って何も起きない結果になる。素材は違う——経過中に失われても
    // 打ち切らない。それは開始時に済ませた在庫確認（currentStepIsSupplied）の再判定にあたる（同6.1節）。
    if (!spendDurationAndReportParticipantsAlive(recipe.minutesFor(step, agent), inProgress)) return false;

    // 消費が進捗より先なのは、進捗が上限を超えた瞬間に完成し、残っている物は親へこぼれてしまうため。
    const allocated = allocateContentsToRequirements(
      materialsSlotOf(inProgress)?.contents ?? [],
      step.requirements,
    );
    for (const requirement of step.requirements) {
      if (!requirement.consume) continue;
      for (const object of allocated.get(requirement) ?? []) object.destroy();
    }

    inProgress.tryGetProperty(codex.vocabulary.engine.progressId)?.add(step.durationMinutes);

    // 工程の進捗バー（CardView.md 10.1節、inProgressObjects.FINISHED_STEPS_PROPERTY）が読む純粋な
    // 回数。工程が1つのレシピにはそもそも宣言が無いので、持っていなければ何も起きない。
    inProgress.tryGetProperty(codex.vocabulary.engine.finishedStepsId)?.add(1);

    // 最後の工程を終えていれば、上のaddが上限へ届いて完成している（progressのon_maxがbecomeを
    // 起こす、RecipeSystem.md 1節）ので、**もうレシピの軸を名乗っていない**。余分の卓を引くのは
    // ここ——同じ個体が既に成果物になっているので、卓は自分と同じ物を1つ増やす形で書ける。
    if (recipeOf(inProgress) === undefined && recipe.surplus !== undefined)
      inProgress.applyActiveEffect(recipe.surplus, context);

    spillUnneeded(inProgress);
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
function spillUnneeded(inProgress: WorldObject): void {
  const parent = inProgress.parent;
  // こぼす先は、製作中オブジェクト自身が居るスロット（足元なら足元、かごの中ならかごの中）。
  const parentSlot = inProgress.parentSlot?.def;
  if (parent === undefined || parentSlot === undefined) return;

  const stillNeeded = remainingRequirementsOf(inProgress);
  const leftovers = (materialsSlotOf(inProgress)?.contents ?? []).filter(
    (object) => !stillNeeded.some((requirement) => requirement.requires(object.def)),
  );

  for (const object of leftovers) object.moveToSlotOrRejection(parent.getSlot(parentSlot.globalId));
}
