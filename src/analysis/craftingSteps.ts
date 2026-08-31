import type { EffectDeclaration } from '../domain/EffectReader';
import type { InteractionDef } from '../domain/InteractionDef';
import type { InteractionTrigger } from '../domain/InteractionTrigger';
import type { ObjectDef } from '../domain/ObjectDef';
import type { RecipeDef } from '../domain/RecipeDef';
import type { ReferenceRoot } from '../domain/ReferenceRoot';
import type { TypeMatchReading } from '../domain/TypeMatchRule';
import type { WorldCodex } from '../domain/WorldCodex';
import type { CraftingInput, CraftingStep, StepOutcome } from './CraftingStep';
import { collectOutputs, combineOutcomes } from './CraftingStep';
import type { BecomeDestinationResolver, EffectReading } from './effectOutcomes';
import { consumesRoot, destroysRoot, readEffect } from './effectOutcomes';
import { rangeEventAt } from './rangeEvents';
import type { EndBoundValueResolver, StaticValueRange, StaticValueResolver } from './staticValue';
import {
  resolveDeclaredNumber,
  staticConditionTruth,
  staticResolverOf,
  staticValueOf,
  trackingResolverOf,
} from './staticValue';

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
 * 終端の工程として数える）。ただし**条件（14節）が定義だけから偽と分かる操作は挙げない**
 * （conditionsNeverMet）。
 *
 * outerは、self以外の起点（祖先が入れる値・使う物の値）を定義だけから解く手立て。省くと、
 * それらを参照する工程に「確定しない」印が付く（CraftingStep.hasUnresolvedReferences）。
 */
export function craftingStepsOf(
  codex: WorldCodex,
  def: ObjectDef,
  outer?: StaticValueResolver,
): readonly CraftingStep[] {
  const steps: CraftingStep[] = [];
  for (const trigger of def.triggers)
    for (const instrument of instrumentTypesOf(codex, trigger)) {
      if (conditionsNeverMet(codex, def, instrument, trigger.interaction, outer)) continue;
      steps.push(
        withTriggeredRangeEvents(def, interactionStep(codex, def, trigger, instrument, outer), outer),
      );
    }
  for (const recipe of def.recipesProducingThis) steps.push(recipeStep(def, recipe));
  return steps;
}

/**
 * その操作が相手にする型（ドラッグの相手）。相手を伴わないきっかけでは1件のundefined。
 *
 * **相手をタグで指していても、産物が相手の型から決まるなら候補ごとに別の工程を立てる**——焼け石を
 * 落として沸く湯は、落とした先が甕なら甕の湯、ヤシの器ならヤシの器の湯で、タグのまま1つの工程に
 * すると行き先の型が定まらず、産物がどこにも出ない（`become`、9.9節）。
 *
 * 相手の型で産物が変わらない操作（刃物で剥く・武器で殴る）は割らない。候補の数だけ同じ工程が
 * 並ぶだけで、入力も産出も変わらないため。
 */
function instrumentTypesOf(
  codex: WorldCodex,
  trigger: InteractionTrigger,
): readonly (ObjectDef | undefined)[] {
  const reading = trigger.reading;
  if (reading.kind !== 'drag') return [undefined];
  if (reading.with.kind === 'object') return [codex.objects.tryGet(reading.with.objectGlobalId)];
  if (reading.with.kind === 'not') return [undefined];

  const axisValues = instrumentBecomeAxesOf(trigger.interaction);
  if (axisValues === undefined) return [undefined];

  const tagGlobalId = reading.with.tagGlobalId;
  const candidates = [...codex.objects].filter(
    (candidate) =>
      candidate.hasTag(tagGlobalId) && codex.tryResolveBecome(candidate, axisValues) !== undefined,
  );
  // 行き先を解ける候補が1つも無いなら割る意味が無いので、宣言（タグ）のまま1つの工程にする。
  return candidates.length === 0 ? [undefined] : candidates;
}

/**
 * その操作が相手を別の型へ変えるなら、行き先を決める軸の値（`become`、9.9節）。相手を変えない
 * 操作ではundefined。
 */
function instrumentBecomeAxesOf(interaction: InteractionDef): ReadonlyMap<string, string> | undefined {
  let axisValues: ReadonlyMap<string, string> | undefined;
  readEffect(
    interaction,
    () => undefined,
    (subject, values) => {
      if (subject.kind === 'root' && subject.root === 'instrument') axisValues = values;
      return undefined;
    },
  );
  return axisValues;
}

/**
 * その操作の条件（14節）に、定義だけから偽と分かるものがあるか。**分からない条件は素通しにする**
 * ——祖先の天候のように実行時にしか決まらないものまで解こうとすると、収支を定義だけから出すという
 * 目的が壊れる（BalanceStats.md「この表が数えていないもの」）。
 *
 * 相手の型が定まっているなら、相手に課された条件も同じように読む——**空の容器へ注ぐ操作は、中身の
 * ある容器を相手には起こせない**（`{subject: instrument, prop: fill, eq: 0}`）。
 */
function conditionsNeverMet(
  codex: WorldCodex,
  def: ObjectDef,
  instrument: ObjectDef | undefined,
  interaction: InteractionDef,
  outer: StaticValueResolver | undefined,
): boolean {
  const rangeOf = (root: ReferenceRoot, propertyGlobalId: number): StaticValueRange | undefined => {
    const subjectDef = rootTypeOf(def, instrument, root);
    return subjectDef === undefined
      ? undefined
      : staticValueRangeOf(
          codex,
          subjectDef,
          propertyGlobalId,
          staticResolverOf(subjectDef, 'lowest', outer),
        );
  };
  return interaction.requirementDeclarations.some(
    (requirement) => staticConditionTruth(requirement.condition, rangeOf) === false,
  );
}

/**
 * defがそのプロパティに取りうる値の範囲（StaticValueRange）。rangeを宣言していなければundefined
 * ——上下限が無ければ、どの値も取りうる。
 */
function staticValueRangeOf(
  codex: WorldCodex,
  def: ObjectDef,
  propertyGlobalId: number,
  resolve: EndBoundValueResolver,
): StaticValueRange | undefined {
  const propertyDef = def.tryGetPropertyDef(propertyGlobalId);
  const range = propertyDef?.range;
  if (propertyDef === undefined || range === undefined) return undefined;

  const endsLeavingThisType: number[] = [];
  for (const [label, effect] of propertyDef.rangeEvents())
    if (leavesThisType(codex, def, effect, resolve))
      endsLeavingThisType.push(label === 'on_min' ? range.min : range.max);

  return { min: range.min, max: range.max, endsLeavingThisType };
}

/**
 * その効果がdefをこの型でなくすか——消える（`destroy`）か、別の型へ変わる（`become`）か。
 * 行き先が定義から解けない`become`は「変わる」と言い切れないので偽を返す。
 */
function leavesThisType(
  codex: WorldCodex,
  def: ObjectDef,
  effect: EffectDeclaration,
  resolve: EndBoundValueResolver,
): boolean {
  const selfDestinations: (number | undefined)[] = [];
  const reading = readEffect(effect, resolve, (subject, axisValues) => {
    if (subject.kind !== 'root' || subject.root !== 'self') return undefined;
    const destination = codex.tryResolveBecome(def, axisValues)?.globalId;
    selfDestinations.push(destination);
    return destination;
  });
  return (
    selfDestinations.some((destination) => destination !== undefined && destination !== def.globalId) ||
    destroysRoot(reading, 'self')
  );
}

/**
 * 操作1つを工程として見たもの。入力は常にself（宣言した型）で、消費されるかはdestroyの有無から
 * 分かる。ドラッグ型は相手（withが指す型）も入力に並ぶ。
 */
function interactionStep(
  codex: WorldCodex,
  def: ObjectDef,
  trigger: InteractionTrigger,
  instrument: ObjectDef | undefined,
  outer: StaticValueResolver | undefined,
): CraftingStep {
  const interaction = trigger.interaction;
  const tracking = trackingResolverOf(def, 'lowest', outer);
  const reading = readEffect(
    interaction,
    tracking.resolve,
    becomeDestinationResolverOf(codex, def, instrument),
  );
  const minutes = minutesOf(interaction, tracking.resolve);
  return {
    kind: 'interaction',
    startedByPlayer: trigger.startedByPlayer,
    name: interaction.name,
    ownerGlobalId: def.globalId,
    inputs: [
      {
        kind: 'object',
        objectGlobalId: def.globalId,
        consumed: consumesRoot(reading, 'self'),
        count: 1,
      },
      ...instrumentInputOf(trigger, instrument, reading),
    ],
    outputs: collectOutputs(reading.outcomes),
    // プレイヤーが手を止めている間に時間が進むので、払う時間と経過する時間は等しい。
    laborMinutes: minutes,
    elapsedMinutes: minutes,
    outcomes: reading.outcomes,
    hasUnresolvedReferences: tracking.hitUnresolvedReference,
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
    // レシピは工程を進める操作でしか進まない（RecipeSystem.md 2節）ので、常にプレイヤーが起こす。
    startedByPlayer: true,
    name: recipe.name,
    ownerGlobalId: def.globalId,
    inputs: recipe.steps.flatMap((step) =>
      step.requirements
        .map((requirement) => inputOf(requirement.match.reading, requirement.consume, requirement.count))
        .filter((input): input is CraftingInput => input !== undefined),
    ),
    outputs: collectOutputs(outcomes),
    laborMinutes: recipe.totalMinutes,
    elapsedMinutes: recipe.totalMinutes,
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
  const resolve = staticResolverOf(def, 'lowest', outer);

  let destroyedProbability = 0;
  const expanded = step.outcomes.map((outcome) => {
    let outcomes: readonly StepOutcome[] = [outcome];
    let destroysSelf = false;
    let triggered = false;

    for (const [propertyGlobalId, value] of selfPropertyValuesAfterOf(def, outcome, outer)) {
      const propertyDef = def.tryGetPropertyDef(propertyGlobalId);
      const readout = propertyDef === undefined ? undefined : rangeEventAt(propertyDef, value, resolve);
      if (readout === undefined) continue;
      // 分岐の確率は積で畳まれる（rangeイベントの分岐の和は1）ので、掛け直さなくてよい。
      outcomes = combineOutcomes(outcomes, readout.outcomes);
      destroysSelf ||= readout.destroysSelf;
      triggered = true;
    }
    if (destroysSelf) destroyedProbability += outcome.probability;
    return { outcomes, triggered };
  });

  if (!expanded.some((entry) => entry.triggered)) return step;
  const flattened = expanded.flatMap((entry) => entry.outcomes);
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
function selfPropertyValuesAfterOf(
  def: ObjectDef,
  outcome: StepOutcome,
  outer: StaticValueResolver | undefined,
): readonly (readonly [number, number])[] {
  const moves: (readonly [number, number])[] = [];
  for (const delta of outcome.deltas) {
    if (delta.target !== 'self') continue;
    const before = staticValueOf(def, delta.propertyGlobalId, 'lowest', outer);
    if (before !== undefined) moves.push([delta.propertyGlobalId, before + delta.amount]);
  }
  for (const assignment of outcome.assignments)
    if (assignment.target === 'self') moves.push([assignment.propertyGlobalId, assignment.value]);
  return moves;
}

/**
 * ドラッグ型の相手（きっかけが指す型）。他のきっかけには無い。消費されるかはinstrumentの行方で決まる。
 * 型が定まっているならその型そのものが入力で、定まらないときだけ宣言（タグ）のまま並べる。
 */
function instrumentInputOf(
  trigger: InteractionTrigger,
  instrument: ObjectDef | undefined,
  effect: EffectReading,
): readonly CraftingInput[] {
  const triggerReading = trigger.reading;
  if (triggerReading.kind !== 'drag') return [];

  const consumed = consumesRoot(effect, 'instrument');
  if (instrument !== undefined)
    return [{ kind: 'object', objectGlobalId: instrument.globalId, consumed, count: 1 }];

  const input = inputOf(triggerReading.with, consumed, 1);
  return input === undefined ? [] : [input];
}

/**
 * この操作の中で`become`（9.9節）の行き先を解く手立て。答えられるのは**型が定まっている相手**
 * ——self と、型の定まったドラッグの相手（instrumentTypesOf）——だけで、実行時にしか決まらない相手
 * （`parent`・`agent`・プロパティ参照）は定義から型が定まらない。
 */
function becomeDestinationResolverOf(
  codex: WorldCodex,
  def: ObjectDef,
  instrument: ObjectDef | undefined,
): BecomeDestinationResolver {
  return (subject, axisValues) => {
    const subjectDef = subject.kind === 'root' ? rootTypeOf(def, instrument, subject.root) : undefined;
    return subjectDef === undefined ? undefined : codex.tryResolveBecome(subjectDef, axisValues)?.globalId;
  };
}

/** その起点が指す型。定義からは定まらない起点（`parent`・`agent`・祖先）ではundefined。 */
function rootTypeOf(
  def: ObjectDef,
  instrument: ObjectDef | undefined,
  root: ReferenceRoot,
): ObjectDef | undefined {
  if (root === 'self') return def;
  return root === 'instrument' ? instrument : undefined;
}

/**
 * 型の指定（タグか型そのもの）を、工程の入力1件へ直す。
 *
 * **否定形（`{not: ...}`、4.1節）は入力にならない。** 図のノードは1つの型かタグを指すもので、
 * 「その型でないもの」を名指しできない。同梱の世界に否定を書いた相手は無い。
 */
function inputOf(reading: TypeMatchReading, consumed: boolean, count: number): CraftingInput | undefined {
  if (reading.kind === 'not') return undefined;
  return reading.kind === 'tag'
    ? { kind: 'tag', tagGlobalId: reading.tagGlobalId, consumed, count }
    : { kind: 'object', objectGlobalId: reading.objectGlobalId, consumed, count };
}

/**
 * その操作にかかるゲーム内時間（分）。durationを省いていれば0、参照が解けなければ0
 * （工程の側がhasUnresolvedReferencesで印を持つ）。
 */
function minutesOf(interaction: InteractionDef, resolve: EndBoundValueResolver): number {
  const reading = interaction.durationReading;
  return reading === undefined ? 0 : Math.trunc(resolveDeclaredNumber(reading, resolve) ?? 0);
}
