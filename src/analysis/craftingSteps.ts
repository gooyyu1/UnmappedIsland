import type { InteractionDef } from '../domain/defs/InteractionDef';
import type { ObjectDef } from '../domain/defs/ObjectDef';
import type { RecipeDef } from '../domain/defs/RecipeDef';
import type { TypeMatchReading } from '../domain/defs/TypeMatchRule';
import type { CraftingInput, CraftingStep, StepOutcome } from './CraftingStep';
import { collectOutputs, combineOutcomes } from './CraftingStep';
import { outcomesOf } from './effectOutcomes';
import { rangeEventAt } from './rangeEvents';
import type { StaticValueResolver } from './staticValue';
import { resolveWeight, staticResolverOf, staticValueOf } from './staticValue';

/**
 * 定義を「入力 → 工程 → 出力」の形へ均す（CraftingStep参照）。
 *
 * actions・combinations・recipesは文法がそれぞれ違うが、「何を使って何ができるか」という問いには
 * 同じ形で答えられる。ここが置いている近似は**時間と分岐の読み方**——所要時間の参照も抽選の重みも
 * 実行時の実効値で決まるので、宣言だけから出した数値は「そう置いた場合」の値でしかない。
 */

/**
 * この型が関わる工程を宣言順に挙げる。**何も生み出さない操作も含む**——出力の有無で絞るのは
 * 受け取る側の都合（クラフトネットワークは出力のある工程だけを描き、収支表は食べる操作も
 * 終端の工程として数える）。
 *
 * outerは、self以外の起点（祖先が入れる値・重ねる相手の値）を定義だけから解く手立て。省くと、
 * それらを参照する工程に「確定しない」印が付く（CraftingStep.hasUnresolvedReferences）。
 */
export function craftingStepsOf(def: ObjectDef, outer?: StaticValueResolver): readonly CraftingStep[] {
  const steps: CraftingStep[] = [];
  for (const interaction of [...def.actions, ...def.combinations])
    steps.push(withTriggeredRangeEvents(def, interactionStep(def, interaction, outer), outer));
  for (const recipe of def.recipes) steps.push(recipeStep(def, recipe));
  return steps;
}

/**
 * 操作1つを工程として見たもの。入力は常にself（宣言した型）で、消費されるかはdestroyの有無から
 * 分かる。ドラッグ型は相手（withが指す型）も入力に並ぶ。
 */
function interactionStep(
  def: ObjectDef,
  interaction: InteractionDef,
  outer: StaticValueResolver | undefined,
): CraftingStep {
  let unresolved = false;
  const resolve: StaticValueResolver = (root, propertyGlobalId) => {
    const value = staticResolverOf(def, outer)(root, propertyGlobalId);
    if (value === undefined) unresolved = true;
    return value;
  };

  const outcomes = outcomesOf(interaction, resolve);
  const minutes = minutesOf(interaction, resolve);
  return {
    kind: interaction.kind,
    name: interaction.name,
    ownerGlobalId: def.globalId,
    inputs: [
      { kind: 'object', objectGlobalId: def.globalId, consumed: interaction.destroys('self'), count: 1 },
      ...draggedInputOf(interaction),
    ],
    outputs: collectOutputs(outcomes),
    // プレイヤーが手を止めている間に時間が進むので、払う時間と経過する時間は等しい。
    laborMinutes: minutes,
    elapsedMinutes: minutes,
    outcomes,
    hasUnresolvedReferences: unresolved,
  };
}

/**
 * レシピ1つを工程として見たもの。工程（steps）の別は畳む——「何を使って何ができるか」の問いには、
 * レシピ全体でひとつの答えで足りる。所要時間も同じ理由で全工程の和にする。
 *
 * レシピは分岐も所要時間の参照も持たないので、確率1の1分岐で、数値は常に確定する。
 */
function recipeStep(def: ObjectDef, recipe: RecipeDef): CraftingStep {
  const outcomes: readonly StepOutcome[] = [
    {
      probability: 1,
      spawns: [{ objectGlobalId: def.globalId, count: 1 }],
      deltas: [],
      assignments: [],
    },
  ];
  return {
    kind: 'recipe',
    name: recipe.name,
    ownerGlobalId: def.globalId,
    inputs: recipe.steps.flatMap((step) =>
      step.requirements.map((requirement) =>
        inputOf(requirement.match.reading, requirement.consume, requirement.count),
      ),
    ),
    outputs: collectOutputs(outcomes),
    laborMinutes: totalMinutesOf(recipe),
    elapsedMinutes: totalMinutesOf(recipe),
    outcomes,
    hasUnresolvedReferences: false,
  };
}

/**
 * 工程が自分の値をrangeの外へ押すなら、そこで起こることもその工程の結果に畳んだもの
 * （rangeEventAt参照）。押していない工程はそのまま返る。
 *
 * 押した先で自分が消えるなら、自分は**その確率のぶんだけ**消費される入力になる（CraftingInput参照）
 * ——外した回の獲物はその場に残るので、1回の実行に獲物1匹ぶんの値段を載せてはいけない。
 */
function withTriggeredRangeEvents(
  def: ObjectDef,
  step: CraftingStep,
  outer: StaticValueResolver | undefined,
): CraftingStep {
  const resolve = staticResolverOf(def, outer);

  let triggered = false;
  let destroyedProbability = 0;
  const outcomes = step.outcomes.map((outcome) => {
    let expanded: readonly StepOutcome[] = [outcome];
    let destroysSelf = false;

    for (const [propertyGlobalId, value] of selfMovesOf(def, outcome, outer)) {
      const propertyDef = def.getPropertyDef(propertyGlobalId);
      const readout = propertyDef === undefined ? undefined : rangeEventAt(propertyDef, value, resolve);
      if (readout === undefined) continue;
      // 分岐の確率は積で畳まれる（rangeイベントの分岐の和は1）ので、掛け直さなくてよい。
      expanded = combineOutcomes(expanded, readout.outcomes);
      destroysSelf ||= readout.destroysSelf;
      triggered = true;
    }
    if (destroysSelf) destroyedProbability += outcome.probability;
    return expanded;
  });

  if (!triggered) return step;
  const flattened = outcomes.flat();
  return {
    ...step,
    inputs: step.inputs.map((input) =>
      destroyedProbability > 0 &&
      input.kind === 'object' &&
      input.objectGlobalId === def.globalId &&
      !input.consumed
        ? { ...input, consumed: true, count: destroyedProbability }
        : input,
    ),
    outputs: collectOutputs(flattened),
    outcomes: flattened,
  };
}

/**
 * 1つの分岐が、自分のどのプロパティをどこへ動かすか。**増減は今の値からの差、代入はそのものが
 * 行き先**なので、range系イベントを問う前に「動かした先」へ均す。
 */
function selfMovesOf(
  def: ObjectDef,
  outcome: StepOutcome,
  outer: StaticValueResolver | undefined,
): readonly (readonly [number, number])[] {
  const moves: (readonly [number, number])[] = [];
  for (const delta of outcome.deltas) {
    if (delta.target !== 'self') continue;
    const before = staticValueOf(def, delta.propertyGlobalId, outer);
    if (before !== undefined) moves.push([delta.propertyGlobalId, before + delta.amount]);
  }
  for (const assignment of outcome.assignments)
    if (assignment.target === 'self') moves.push([assignment.propertyGlobalId, assignment.value]);
  return moves;
}

/** ドラッグ型の相手（withが指す型）。メニュー型には無い。消費されるかはdraggedへのdestroyで決まる。 */
function draggedInputOf(interaction: InteractionDef): readonly CraftingInput[] {
  const reading = interaction.draggedReading;
  return reading === undefined ? [] : [inputOf(reading, interaction.destroys('dragged'), 1)];
}

/** 型の指定（タグか型そのもの）を、工程の入力1件へ直す。 */
function inputOf(reading: TypeMatchReading, consumed: boolean, count: number): CraftingInput {
  return reading.kind === 'tag'
    ? { kind: 'tag', tagGlobalId: reading.tagGlobalId, consumed, count }
    : { kind: 'object', objectGlobalId: reading.objectGlobalId, consumed, count };
}

/** 全工程を通した所要時間（分）。工程の別は畳むので、時間も和で1つにする。 */
function totalMinutesOf(recipe: RecipeDef): number {
  return recipe.steps.reduce((sum, step) => sum + step.durationMinutes, 0);
}

/**
 * その操作にかかるゲーム内時間（分）。durationを省いていれば0、参照が解けなければ0
 * （工程の側がhasUnresolvedReferencesで印を持つ）。
 */
function minutesOf(interaction: InteractionDef, resolve: StaticValueResolver): number {
  const reading = interaction.durationReading;
  if (reading === undefined) return 0;
  return Math.trunc(resolveWeight(reading, resolve) ?? 0);
}
