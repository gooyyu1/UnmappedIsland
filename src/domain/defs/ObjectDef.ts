import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import type { ActionDef } from './ActionDef';
import type { ActiveEffect } from './ActiveEffect';
import type { CombinationDef } from './CombinationDef';
import type { CraftingStep, StepOutcome } from './CraftingStep';
import { collectOutputs, combineOutcomes } from './CraftingStep';
import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { actionRef, combinationRef, propertyRef, slotRef, text } from './Description';
import type { InteractionDef } from './InteractionDef';
import { LocalIndexMap } from './LocalIndexMap';
import type { PassiveEffect, TickGate } from './PassiveEffect';
import { PassiveEffects } from './PassiveEffects';
import type { PropertyDef } from './PropertyDef';
import type { RecipeDef } from './RecipeDef';
import type { StaticValueResolver } from './ReferenceRoot';
import type { Requirement } from './Requirement';
import type { SlotDef } from './SlotDef';
import type { StackOrderDef } from './StackOrderDef';

/** 1 tickのゲーム内時間（分）。tick毎の増減から周期を分へ直すのに使う。 */
const MINUTES_PER_TICK = 15;

/**
 * 外から与えられるtick毎の増減（ObjectDef.rangeCycles参照）。**焼くのも失血も、自分では動かない値を
 * 隣の物が動かす**——炉が火にかけた物の加熱を進め、刺さった傷が持ち主の血を奪う。誰が誰の隣に
 * 居るかは型だけでは決まらないので、文脈を知っている側（収支レポート）が組み立てて渡す。
 */
export interface ExternalTickDelta {
  /** その増減を与える型。その周期を回すのに要る物（炉・刺さった傷）として工程の入力に並ぶ。 */
  readonly sourceGlobalId: number;

  readonly propertyGlobalId: number;

  /** 最も遅い場合と最も速い場合の量（tickAmountsOfと同じ見方。炉は火力の段で3段階に変わる）。 */
  readonly slowest: number;
  readonly fastest: number;

  /** その増減が止まるまでに動かせる総量。止まらない増減（薪をくべ続ける炉）ではundefined。 */
  readonly maxTotal: number | undefined;
}

/**
 * tick毎に動く値がrangeの端へ届くまでの周期と、そこで起こること（ObjectDef.rangeCycles参照）。
 *
 * repeatsなら端で値が戻って繰り返す（罠は4時間ごとに獲物を判定する）。destroysSelfなら端で
 * 自分が消えるので、minutesはその型の寿命そのものになる。
 */
export interface RangeCycle {
  readonly propertyGlobalId: number;

  /**
   * 端へ届くまでの時間（分）。**条件つきの増減（8.2節）が最小限しか成立しない場合**の値——
   * 罠の耐久は地面にある間ずっと減るが、獲物を抱えている間だけの上乗せは常時ではない。
   */
  readonly minutes: number;

  /** 条件つきの増減がすべて同時に成立した場合の時間（分）。条件が1つ以下ならminutesと等しい。 */
  readonly shortestMinutes: number;

  readonly repeats: boolean;
  readonly destroysSelf: boolean;

  /** 外から与えられた増減で動いた周期なら、それを与える型（炉が焼く・傷が血を奪う）。 */
  readonly drivenBy: number | undefined;

  /** この周期を1つの工程として見たもの。何も生まない周期では出力が空になる。 */
  readonly step: CraftingStep;
}

/**
 * 型定義（`object_defs` の1エントリ、4節）。ロード完了後は不変として扱う。
 * 実行時インスタンスは WorldObject（runtime）。
 */
export class ObjectDef {
  readonly globalId: number;
  readonly name: string;

  /** 唯一のインスタンスしか存在しない想定(9節、例: world)。 */
  readonly isSingleton: boolean;

  /** この object_def が持つタグのグローバルIDの一覧（4節）。自分自身が直接宣言したタグと、参照した
   * trait（5節）が宣言していたタグの両方を合成済みで持つ（trait自体は合成後に消えるため、
   * タグ指定のマッチング（TypeMatchRule）はこのタグ集合だけを見る）。 */
  readonly tags: readonly number[];

  /** グローバルなプロパティID → このObjectDefにおけるローカルindex。 */
  readonly propertyLayout: LocalIndexMap;

  /** ローカルindexで並ぶ密配列。propertyLayout と対になる。 */
  private readonly propertyDefs: readonly PropertyDef[];

  /** グローバルなスロットID → このObjectDefにおけるローカルindex。 */
  readonly slotLayout: LocalIndexMap;

  /** ローカルindexで並ぶ密配列。slotLayout と対になる。 */
  /** このobject_defが持つスロットの定義（宣言順）。 */
  readonly slotDefs: readonly SlotDef[];

  /** slotDefsのうち、自動配置（7.7節）を受け入れるものだけを宣言順に並べたもの。 */
  private readonly autoPlacementSlotDefs: readonly SlotDef[];

  /** このObjectDefが宣言する持続効果（8節）の一式（PassiveEffects参照）。 */
  readonly passives: PassiveEffects;

  /** この型を成果物とするレシピ（13節）。宣言順。 */
  readonly recipes: readonly RecipeDef[];

  /** スタック内での並び順（表示専用）。undefined なら並び順は未定義で、常にスタックの末尾へ
   * 追加される（新規インスタンス同士の相対順序＝挿入順）。 */
  readonly stackOrder: StackOrderDef | undefined;

  /** interaction/stack判定を委譲する代表オブジェクトが入っているスロットのグローバルID（7.6節）。
   * undefinedなら常に自分自身が代表。指定時は、そのスロットの先頭の1個（さらにその代表…）が
   * interactionの実行対象・stack判定の識別に使われる。 */
  readonly representedBySlotGlobalId: number | undefined;

  /**
   * この型を**代表する物のスロット**のグローバルID（7.8節）。undefinedなら持たない。
   *
   * 画面はカードを押したときにここの中身を並べる（かごの中身、怪我に当てている治療具）。
   * 液体の容器は持たない——中身は物ではなく量で、1枚ずつ取り出せるものではないため。
   * キャラクタも持たない——手持ち・装備・怪我はどれも物のスロットだが、そのどれもが代表ではない。
   */
  readonly mainItemSlotGlobalId: number | undefined;

  /**
   * **カードに出す絵を段で切り替えるプロパティ**のグローバルID（`art_by_stage`、6.4節）。undefinedなら
   * 持たず、常にこの型自身の絵（`object_defの識別子.png`）を出す。
   *
   * 1つの型につき高々1つ——複数のプロパティが同時に絵を主張する曖昧さを構造で禁じる。`art`（段の
   * 兄弟キー）を宣言できるのは、ここが指すプロパティの段だけ（ロード時に検証、RawObjectDef.resolve）。
   */
  readonly artByStagePropertyGlobalId: number | undefined;

  /**
   * **単独では存在できない型か**（7.9節、既定false）。trueなら、入っていた親が消えるとき一緒に消える。
   *
   * 身体から離れた「捻挫」も、器の無い水も、繋がる土地の無い道も存在しない。falseの物（包帯・石）は
   * 親が消えるとその親の親へこぼれ出る。
   */
  readonly boundToOwner: boolean;

  /**
   * **同種と束ねてよい型か**（既定true）。falseなら、同じ型でも1個ずつ別の枠に並ぶ。
   *
   * 束ねたくないのは、その個体を名指しで操作する必要があるとき。道は行き先が個体ごとに違い、かごは
   * 中身が個体ごとに違うので、束ねると代表の行き先・中身しか触れなくなる。**入れ物ではなく物の性質**
   * なので、スロットではなくここで宣言する（SlotSystem.md 4節）。
   */
  readonly stackable: boolean;

  /** このObjectDefが持つメニュー型操作（11節）。 */
  readonly actions: readonly ActionDef[];

  /** このObjectDefが（selfとして）持つドラッグ型操作（12節）。 */
  readonly combinations: readonly CombinationDef[];

  /**
   * 個数ではなく量で存在する型か（7.6節）。真なら、インスタンスの存在と「sizeが正であること」が
   * 同値になる——moveは量を移し、移り先に同種が無ければ生まれ、移し元は量が尽きた時点で消える。
   */
  readonly isQuantitative: boolean;

  constructor(
    globalId: number,
    name: string,
    isSingleton: boolean,
    propertyLayout: LocalIndexMap,
    propertyDefs: readonly PropertyDef[],
    slotLayout: LocalIndexMap,
    slotDefs: readonly SlotDef[],
    passives: readonly PassiveEffect[],
    stackOrder?: StackOrderDef,
    tags: readonly number[] = [],
    actions: readonly ActionDef[] = [],
    combinations: readonly CombinationDef[] = [],
    representedBySlotGlobalId?: number,
    isQuantitative = false,
    mainItemSlotGlobalId?: number,
    boundToOwner = false,
    stackable = true,
    recipes: readonly RecipeDef[] = [],
    artByStagePropertyGlobalId?: number,
  ) {
    this.globalId = globalId;
    this.name = name;
    this.isSingleton = isSingleton;
    this.propertyLayout = propertyLayout;
    this.propertyDefs = propertyDefs;
    this.slotLayout = slotLayout;
    this.slotDefs = slotDefs;
    this.autoPlacementSlotDefs = slotDefs.filter((slotDef) => slotDef.autoPlacement);
    this.passives = new PassiveEffects(passives);
    this.stackOrder = stackOrder;
    this.tags = tags;
    this.actions = actions;
    this.combinations = combinations;
    this.representedBySlotGlobalId = representedBySlotGlobalId;
    this.mainItemSlotGlobalId = mainItemSlotGlobalId;
    this.boundToOwner = boundToOwner;
    this.stackable = stackable;
    this.isQuantitative = isQuantitative;
    this.recipes = recipes;
    this.artByStagePropertyGlobalId = artByStagePropertyGlobalId;
  }

  /**
   * この型そのものの性質（4節・7節の宣言）を書き出す（Description参照）。既定と同じ性質は書かない
   * ——「特に断っていない」ことと同じ意味なので、並べても読み手の手掛かりにならないため。
   */
  describe(names: DefNames, out: DescriptionWriter): void {
    if (this.isSingleton) out.write(text('singleton: 世界にただ1つだけ存在する'));
    if (this.isQuantitative) out.write(text('quantitative: 個数ではなく量で存在する'));
    if (!this.stackable) out.write(text('stackable: false（同種でも1個ずつ別の枠に並ぶ）'));
    if (this.boundToOwner) out.write(text('bound_to_owner: 入っていた親が消えるとき一緒に消える'));

    if (this.representedBySlotGlobalId !== undefined)
      out.write(
        text('represented_by: '),
        slotRef(names.slotName(this.representedBySlotGlobalId)),
        text('の中身が代表になる'),
      );

    if (this.mainItemSlotGlobalId !== undefined)
      out.write(
        text('main_item_slot: '),
        slotRef(names.slotName(this.mainItemSlotGlobalId)),
        text('（カードを押すと並ぶ中身）'),
      );

    if (this.stackOrder !== undefined) out.write(text('stack_order: '), ...this.stackOrder.describe(names));

    if (this.artByStagePropertyGlobalId !== undefined)
      out.write(
        text('art_by_stage: '),
        propertyRef(names.propertyName(this.artByStagePropertyGlobalId)),
        text('の段が絵を切り替える'),
      );
  }

  /** art_by_stage（6.4節）が指すプロパティの、stagesが宣言しているart接尾辞の一覧。art_by_stageが無ければ空。 */
  artSuffixes(): readonly string[] {
    if (this.artByStagePropertyGlobalId === undefined) return [];
    return this.getPropertyDef(this.artByStagePropertyGlobalId)?.artSuffixes() ?? [];
  }

  /**
   * この型が、propertyGlobalIdのプロパティを書き換えうる箇所をすべて書き出す（プロパティ側からの
   * 逆引き）。
   *
   * ownedByThisDefは、そのプロパティがこの型自身のものか。falseなら、他の型のプロパティを
   * 書き換えうる宣言だけを書く（target=selfは常に宣言元自身のプロパティを指すため、
   * 他の型の同名プロパティには届かない）。
   */
  describeInfluencesOn(
    propertyGlobalId: number,
    ownedByThisDef: boolean,
    names: DefNames,
    out: DescriptionWriter,
  ): void {
    this.passives.describeAffecting(propertyGlobalId, ownedByThisDef, names, out);

    const matches = (effect: ActiveEffect): boolean => effect.affects(propertyGlobalId, ownedByThisDef);

    for (const propertyDef of this.propertyDefs) {
      // 自分自身を値域へ丸めるon_overflow/on_shortfallは、そのプロパティの定義を見れば分かる
      // （「どこから影響されるか」を知りたい読み手には何も足さない）。
      if (ownedByThisDef && propertyDef.globalId === propertyGlobalId) continue;
      this.describeRangeEvents(propertyDef, matches, names, out);
    }

    for (const [token, interaction] of this.matchingInteractions(matches)) {
      out.write(token, text(':'));
      out.indented(() => interaction.describe(names, out));
    }
  }

  /**
   * この型が、objectGlobalIdの型を生み出しうるか（生まれる側からの逆引き）。生むのはspawn（9.4節）
   * だけなので、探すのはactions・combinationsとrange系イベント。
   *
   * どの操作で生まれるかまでは返さない——「これはどこから手に入るのか」を知りたい読み手には、
   * 生む側の型が答えで、その先はその型のページにある。
   */
  creates(objectGlobalId: number): boolean {
    const matches = (effect: ActiveEffect): boolean => effect.spawns(objectGlobalId);
    return (
      this.propertyDefs.some((propertyDef) => propertyDef.hasRangeEventMatching(matches)) ||
      this.matchingInteractions(matches).length > 0
    );
  }

  /**
   * この型のレシピが、candidateDefを素材か道具として要求しているか（材料側からの逆引き）。
   * 「何になるのか」を知りたい読み手には完成品＝この型が答えなので、どの工程で使うかまでは返さない。
   */
  usesInRecipes(candidateDef: ObjectDef): boolean {
    return this.recipes.some((recipe) => recipe.requires(candidateDef));
  }

  /**
   * この型が関わる工程（CraftingStep参照）を宣言順に挙げる。actions・combinations・recipesのすべてで、
   * **何も生み出さない操作も含む**——出力の有無で絞るのは受け取る側の都合（クラフトネットワークは
   * 出力のある工程だけを描き、収支表は食べる操作も終端の工程として数える）。
   *
   * outerは、self以外の起点（祖先が入れる値など）を定義だけから解く手立て。省くと、それらを参照する
   * 工程に「確定しない」印が付く（CraftingStep.hasUnresolvedReferences）。
   */
  craftingSteps(outer?: StaticValueResolver): readonly CraftingStep[] {
    const resolve = this.staticResolver(outer);
    const steps: CraftingStep[] = [];
    for (const interaction of [...this.actions, ...this.combinations])
      steps.push(this.withTriggeredRangeEvents(interaction.craftingStep(this.globalId, resolve), outer));
    for (const recipe of this.recipes) steps.push(recipe.craftingStep(this.globalId));
    return steps;
  }

  /**
   * 工程が自分の値をrangeの外へ押すなら、そこで起こることもその工程の結果に畳んだもの
   * （PropertyDef.rangeEventAt参照）。押していない工程はそのまま返る。
   *
   * 押した先で自分が消えるなら、自分は**その確率のぶんだけ**消費される入力になる（CraftingInput参照）
   * ——外した回の獲物はその場に残るので、1回の実行に獲物1匹ぶんの値段を載せてはいけない。
   */
  private withTriggeredRangeEvents(step: CraftingStep, outer: StaticValueResolver | undefined): CraftingStep {
    const resolve = this.staticResolver(outer);
    const ancestorValue = (propertyGlobalId: number): number | undefined =>
      outer?.('ancestor', propertyGlobalId);

    let triggered = false;
    let destroyedProbability = 0;
    const outcomes = step.outcomes.map((outcome) => {
      let expanded: readonly StepOutcome[] = [outcome];
      let destroysSelf = false;

      for (const [propertyGlobalId, value] of this.selfMovesOf(outcome, ancestorValue)) {
        const readout = this.getPropertyDef(propertyGlobalId)?.rangeEventAt(value, resolve);
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
        input.objectGlobalId === this.globalId &&
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
  private selfMovesOf(
    outcome: StepOutcome,
    ancestorValue: (propertyGlobalId: number) => number | undefined,
  ): readonly (readonly [number, number])[] {
    const moves: (readonly [number, number])[] = [];
    for (const delta of outcome.deltas) {
      if (delta.target !== 'self') continue;
      const before = this.getPropertyDef(delta.propertyGlobalId)?.staticValue(ancestorValue);
      if (before !== undefined) moves.push([delta.propertyGlobalId, before + delta.amount]);
    }
    for (const assignment of outcome.assignments)
      if (assignment.target === 'self') moves.push([assignment.propertyGlobalId, assignment.value]);
    return moves;
  }

  /**
   * **tick毎に動く値がrangeの端へ届くまでの周期**と、そこで起こること（RangeCycle参照）。
   * 端で値が戻るものは繰り返す仕掛け（罠の判定、TrapSystem.md 2節）、端で自分が消えるものは
   * 寿命（罠の朽ち、DurabilitySystem.md 2節）。
   *
   * 段で切り替わる増減（8.2節）は数えない——段ごとに周期が変わるものは、1つの周期で言い表せない。
   *
   * externalは、隣の物が与えるtick毎の増減（ExternalTickDelta参照）。同じプロパティを動かすものが
   * 複数あれば、**与え手ごとに別の周期**を返す——炉で焼くのと傷で失血するのは、要る物も速さも違う。
   */
  rangeCycles(
    outer?: StaticValueResolver,
    external: readonly ExternalTickDelta[] = [],
  ): readonly RangeCycle[] {
    let unresolved = false;
    const resolve: StaticValueResolver = (root, propertyGlobalId) => {
      const value = this.staticResolver(outer)(root, propertyGlobalId);
      if (value === undefined) unresolved = true;
      return value;
    };
    const ancestorValue = (propertyGlobalId: number): number | undefined =>
      outer?.('ancestor', propertyGlobalId);

    const cycles: RangeCycle[] = [];
    for (const propertyDef of this.propertyDefs) {
      const own = this.tickAmountsOf(propertyDef.globalId);
      const drivers: readonly (ExternalTickDelta | undefined)[] = [
        undefined,
        ...external.filter((delta) => delta.propertyGlobalId === propertyDef.globalId),
      ];

      for (const driver of drivers) {
        const slowest = own.slowest + (driver?.slowest ?? 0);
        const fastest = own.fastest + (driver?.fastest ?? 0);
        const ticks = propertyDef.ticksToRangeEnd(slowest, ancestorValue);
        const shortestTicks = propertyDef.ticksToRangeEnd(fastest, ancestorValue);
        if (ticks === undefined || shortestTicks === undefined) continue;

        // 外からの増減が止まる前に端へ届かないなら、その仕掛けは成立しない——小さな獲物は罠の傷でも
        // 失血で死ぬが、血の多い獲物は傷が固まるほうが先になる。
        if (driver?.maxTotal !== undefined && ticks * Math.abs(driver.slowest) > driver.maxTotal) continue;

        for (const readout of propertyDef.rangeEventReadouts(resolve)) {
          if (readout.label === (slowest < 0 ? 'on_overflow' : 'on_shortfall')) continue;

          // 値が戻るなら、次の発火までは戻った量ぶん——初回だけが初期値からの距離になる。
          const repeats = readout.returnedToSelf > 0;
          const period = repeats ? readout.returnedToSelf / Math.abs(slowest) : ticks;
          cycles.push({
            propertyGlobalId: propertyDef.globalId,
            minutes: period * MINUTES_PER_TICK,
            shortestMinutes:
              (repeats ? readout.returnedToSelf / Math.abs(fastest) : shortestTicks) * MINUTES_PER_TICK,
            repeats,
            destroysSelf: readout.destroysSelf,
            drivenBy: driver?.sourceGlobalId,
            step: {
              kind: 'periodic',
              name: `${propertyDef.name}.${readout.label}`,
              ownerGlobalId: this.globalId,
              inputs: [
                { kind: 'object', objectGlobalId: this.globalId, consumed: readout.destroysSelf, count: 1 },
                // 与え手は消えない。焼き上がっても炉は残り、獲物が倒れれば傷は道連れに消えるが、
                // どちらも「傍に在り続けること」が要るという意味では道具と同じ。
                ...(driver === undefined
                  ? []
                  : [
                      {
                        kind: 'object' as const,
                        objectGlobalId: driver.sourceGlobalId,
                        consumed: false,
                        count: 1,
                      },
                    ]),
              ],
              outputs: collectOutputs(readout.outcomes),
              // プレイヤーは何もしないので払う時間は無く、経過するだけ。
              laborMinutes: 0,
              elapsedMinutes: period * MINUTES_PER_TICK,
              outcomes: readout.outcomes,
              hasUnresolvedReferences: unresolved,
            },
          });
        }
      }
    }
    return cycles;
  }

  /**
   * このプロパティが、自分のtick毎の持続効果でどれだけ動くか（段で切り替わるものは除く）。
   *
   * **条件つきの増減（8.2節）は、同時に成立するとは限らない。** どれが重なるかは定義からは
   * 決まらないので、最も遅い場合（条件つきのうち最小の1つだけが効く）と最も速い場合（全部が
   * 重なる）の両方を返す。罠の耐久がこれで、地面にある間の-1と獲物を抱えている間の-10は
   * 足しっぱなしにすると寿命が1/11になる。
   */
  private tickAmountsOf(propertyGlobalId: number): { slowest: number; fastest: number } {
    let unconditional = 0;
    const conditional: number[] = [];
    for (const delta of this.passives.tickDeltas()) {
      if (delta.target !== 'self' || delta.propertyGlobalId !== propertyGlobalId) continue;
      if (delta.gate.stage !== undefined) continue;
      if (delta.gate.conditional) conditional.push(delta.amount);
      else unconditional += delta.amount;
    }

    const fastest = unconditional + conditional.reduce((sum, amount) => sum + amount, 0);
    if (unconditional !== 0 || conditional.length === 0) return { slowest: unconditional, fastest };

    // 常時効くものが無いなら、同じ向きの条件つきのうち最も小さい1つだけが効く場合が最も遅い。
    const sameDirection = conditional.filter((amount) => amount * fastest > 0);
    const slowest = sameDirection.reduce(
      (best, amount) => (Math.abs(amount) < Math.abs(best) ? amount : best),
      sameDirection[0] ?? 0,
    );
    return { slowest, fastest };
  }

  /**
   * この型が、隣の物のtick毎の値を動かす分（ExternalTickDelta参照）。rootは相手から見た自分の
   * 位置——親が子を焼くなら`child`、刺さった傷が持ち主の血を奪うなら`parent`。
   *
   * **誰の隣に立てるかは答えない**（枠の受け入れを見る側の仕事）。答えるのは、隣に立てたとして
   * どれだけ速く、いつまで動かせるか。
   */
  externalTickDeltas(root: 'parent' | 'child'): readonly ExternalTickDelta[] {
    const byProperty = new Map<number, ExternalTickDelta>();
    for (const delta of this.passives.tickDeltas()) {
      if (delta.target !== root || delta.amount === 0) continue;

      const ticks = this.ticksWhileGateHolds(delta.gate);
      const limit = ticks === undefined ? undefined : ticks * Math.abs(delta.amount);
      const known = byProperty.get(delta.propertyGlobalId);
      byProperty.set(delta.propertyGlobalId, {
        sourceGlobalId: this.globalId,
        propertyGlobalId: delta.propertyGlobalId,
        // 段で切り替わる増減（炉の火力）は同時には効かないので、束ねずに幅として持つ。
        slowest:
          known === undefined || Math.abs(delta.amount) < Math.abs(known.slowest)
            ? delta.amount
            : known.slowest,
        fastest:
          known === undefined || Math.abs(delta.amount) > Math.abs(known.fastest)
            ? delta.amount
            : known.fastest,
        maxTotal:
          known === undefined
            ? limit
            : known.maxTotal === undefined || limit === undefined
              ? undefined
              : Math.max(known.maxTotal, limit),
      });
    }
    return [...byProperty.values()];
  }

  /**
   * ゲートが自分の値を見ているなら、その値が尽きて条件が落ちるまでのtick数（TickGate参照）。
   * 見ていない、または尽きない値なら undefined＝止まらない。
   */
  private ticksWhileGateHolds(gate: TickGate): number | undefined {
    let fewest: number | undefined;
    for (const propertyGlobalId of gate.watchedSelfProperties) {
      const value = this.staticValueOf(propertyGlobalId);
      const { fastest } = this.tickAmountsOf(propertyGlobalId);
      if (value === undefined || fastest >= 0) continue;

      const ticks = Math.ceil(value / -fastest);
      if (fewest === undefined || ticks < fewest) fewest = ticks;
    }
    return fewest;
  }

  /** この型が宣言しているプロパティの、定義だけから読める値（StaticValueResolver参照）。 */
  staticValueOf(propertyGlobalId: number, outer?: StaticValueResolver): number | undefined {
    return this.staticResolver(outer)('self', propertyGlobalId);
  }

  /**
   * この型を起点として、定義だけから値を解く手立て（StaticValueResolver参照）。selfは自分の
   * プロパティ定義が答え、それ以外の起点はouterへ委ねる。
   */
  private staticResolver(outer: StaticValueResolver | undefined): StaticValueResolver {
    const ancestorValue = (propertyGlobalId: number): number | undefined =>
      outer?.('ancestor', propertyGlobalId);
    return (root, propertyGlobalId) => {
      if (root !== 'self') return outer?.(root, propertyGlobalId);
      return this.getPropertyDef(propertyGlobalId)?.staticValue(ancestorValue);
    };
  }

  /** 1つのプロパティのrange系イベントのうち、matchesが真になるものを、宣言元の名前を添えて書き出す。 */
  private describeRangeEvents(
    propertyDef: PropertyDef,
    matches: (effect: ActiveEffect) => boolean,
    names: DefNames,
    out: DescriptionWriter,
  ): void {
    if (!propertyDef.hasRangeEventMatching(matches)) return;
    out.write(propertyRef(propertyDef.name), text(':'));
    out.indented(() => propertyDef.describeRangeEventsMatching(matches, names, out));
  }

  /** matchesが真になる操作を、その名前を指す断片（actions/combinationsの区別つき）とともに集める。 */
  private matchingInteractions(
    matches: (effect: ActiveEffect) => boolean,
  ): readonly (readonly [DescriptionToken, InteractionDef])[] {
    const found: (readonly [DescriptionToken, InteractionDef])[] = [];
    for (const action of this.actions)
      if (action.hasEffectMatching(matches)) found.push([actionRef(action.name), action]);
    for (const combination of this.combinations)
      if (combination.hasEffectMatching(matches)) found.push([combinationRef(combination.name), combination]);
    return found;
  }

  /** グローバルIDでこのObjectDefのPropertyDefを取得する。存在しない場合はundefined。 */
  getPropertyDef(globalPropertyId: number): PropertyDef | undefined {
    const local = this.propertyLayout.toLocal(globalPropertyId);
    return local === LocalIndexMap.missing ? undefined : this.propertyDefs[local];
  }

  /** グローバルIDでこのObjectDefのSlotDefを取得する。存在しない場合はundefined。 */
  getSlotDef(globalSlotId: number): SlotDef | undefined {
    const local = this.slotLayout.toLocal(globalSlotId);
    return local === LocalIndexMap.missing ? undefined : this.slotDefs[local];
  }

  /** 全PropertyDefを列挙する。 */
  enumeratePropertyDefs(): readonly PropertyDef[] {
    return this.propertyDefs;
  }

  /** 全SlotDefを列挙する。 */
  enumerateSlotDefs(): readonly SlotDef[] {
    return this.slotDefs;
  }

  /**
   * spawn/moveの宛先候補になるSlotDefを宣言順に列挙する（7.7節）。`auto_placement: false`のスロットは、
   * 走査を強制配置（force）で行う場合も含めて候補にならない——forceが省くのは受け入れ判定であって、
   * 「そもそも自動では入らない」という宣言ではないため。
   */
  enumerateAutoPlacementSlotDefs(): readonly SlotDef[] {
    return this.autoPlacementSlotDefs;
  }

  tryExecuteAction(
    self: WorldObject,
    actor: WorldObject | undefined,
    actionName: string,
    session: WorldSession,
  ): boolean {
    const resolved = self.resolveInteractionTarget();
    const action = resolved.def.actions.find((a) => a.name === actionName);
    return action !== undefined && action.tryExecute(resolved, actor, session);
  }

  /**
   * actionNameを今実行できない理由（最初に落ちた要件、14節）。実行できる・宣言が無い場合はundefined。
   * 対象の解決はtryExecuteActionと同じ。
   */
  actionUnmetRequirement(
    self: WorldObject,
    actor: WorldObject | undefined,
    actionName: string,
  ): Requirement | undefined {
    const resolved = self.resolveInteractionTarget();
    return resolved.def.actions.find((a) => a.name === actionName)?.unmetRequirement(resolved, actor);
  }

  /** actionNameの実行にかかるゲーム内時間（分）。宣言が無ければ0。対象の解決はtryExecuteActionと同じ。 */
  actionMinutes(self: WorldObject, actor: WorldObject | undefined, actionName: string): number {
    const resolved = self.resolveInteractionTarget();
    return (
      resolved.def.actions.find((a) => a.name === actionName)?.minutesFor(resolved, undefined, actor) ?? 0
    );
  }

  /** combinationNameの実行にかかるゲーム内時間（分）。宣言が無ければ0。 */
  combinationMinutes(
    self: WorldObject,
    dragged: WorldObject,
    actor: WorldObject | undefined,
    combinationName: string,
  ): number {
    const resolvedSelf = self.resolveInteractionTarget();
    const resolvedDragged = dragged.resolveInteractionTarget();
    return (
      resolvedSelf.def.combinations
        .find((c) => c.name === combinationName)
        ?.minutesFor(resolvedSelf, resolvedDragged, actor) ?? 0
    );
  }

  tryExecuteCombination(
    self: WorldObject,
    dragged: WorldObject,
    actor: WorldObject | undefined,
    combinationName: string,
    session: WorldSession,
  ): boolean {
    const resolvedSelf = self.resolveInteractionTarget();
    const resolvedDragged = dragged.resolveInteractionTarget();
    const combination = combinationsAccepting(resolvedSelf, resolvedDragged).find(
      (c) => c.name === combinationName,
    );
    return combination !== undefined && combination.tryExecute(resolvedSelf, resolvedDragged, actor, session);
  }

  findMatchingCombinations(self: WorldObject, dragged: WorldObject): readonly CombinationDef[] {
    return combinationsAccepting(self.resolveInteractionTarget(), dragged.resolveInteractionTarget());
  }
}

/**
 * resolvedSelfが持つcombinationのうち、resolvedDraggedを相手（with、12.1節）として受け入れるもの。
 *
 * **作りかけの物は相手にならない。** 製作中オブジェクトは完成品のタグを引き継ぐ
 * （RecipeSystem.md 5節）ので、弾かなければ半分できた石斧で木を伐り、獣を殴れてしまう
 * ——引き継ぎは枠のacceptへ入れるためのもので、道具として働けることまでは意味しない。
 */
function combinationsAccepting(
  resolvedSelf: WorldObject,
  resolvedDragged: WorldObject,
): readonly CombinationDef[] {
  if (resolvedDragged.isInProgress) return [];
  return resolvedSelf.def.combinations.filter((c) => c.matches(resolvedDragged.def));
}

/** ロード済みの全 ObjectDef を、グローバルIDをそのままindexとする配列で保持する。 */
export class ObjectDefTable {
  private readonly byGlobalId: readonly ObjectDef[];

  constructor(byGlobalId: readonly ObjectDef[]) {
    this.byGlobalId = byGlobalId;
  }

  get count(): number {
    return this.byGlobalId.length;
  }

  get(globalId: number): ObjectDef {
    return this.byGlobalId[globalId];
  }

  /** 全ての型を宣言順に。タグに当てはまる型を挙げる用途（TypeMatchRule.candidates）で使う。 */
  [Symbol.iterator](): Iterator<ObjectDef> {
    return this.byGlobalId[Symbol.iterator]();
  }
}
