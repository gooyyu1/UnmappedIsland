import type { ObjectDef } from '../domain/ObjectDef';
import type { PropertyDef, RangeEventLabel } from '../domain/PropertyDef';
import { ROLL_ENDS } from '../domain/PropertyDef';
import type { TickDelta, TickGate } from './tickDeltas';
import { tickDeltasOf } from './tickDeltas';
import type { CraftingStep } from './CraftingStep';
import { collectOutputs } from './CraftingStep';
import { mutuallyExclusive } from './conditionCases';
import { rangeEventReadouts, ticksToRangeEnd } from './rangeEvents';
import type { StaticValueResolver } from './staticValue';
import { MINUTES_PER_TICK } from './balanceTables';
import { staticValueOf, trackingResolverOf } from './staticValue';

/**
 * 外から与えられるtick毎の増減。**焼くのも失血も、自分では動かない値を隣の物が動かす**——炉が
 * 火にかけた物の加熱を進め、刺さった傷が持ち主の血を奪う。誰が誰の隣に居るかは型だけでは決まらない
 * ので、文脈を知っている側（収支レポート）が組み立てて渡す。
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

  /**
   * その増減が効き始めるまでのtick数。**段に入って初めて効く増減**——膿んだ傷が血を奪うのは
   * `infection` が `septic` へ届いてから——では、そこまでの時間が周期の前に丸ごと要る。最初のtickから
   * 効くなら0。
   */
  readonly ticksUntilStart: number;
}

/**
 * tick毎に動く値がrangeの端へ届くまでの周期と、そこで起こること。
 *
 * repeatsなら端で値が戻って繰り返す（罠は4時間ごとに獲物を判定する）。destroysSelfなら端で
 * 自分が消えるので、minutesはその型の寿命そのものになる。
 */
export interface RangeCycle {
  readonly propertyGlobalId: number;

  /**
   * 端へ届くまでの時間（分）。**同時に成立しうる条件（8.2節）の組み合わせのうち、端へ最も遅く
   * 届くもの**の値——罠の耐久は地面にある間ずっと減るが、獲物を抱えている間だけの上乗せは
   * 常時ではない。生成時のロール（6.2節）は端へ近い側に出た場合で見る。
   */
  readonly minutes: number;

  /** 同じ組み合わせのうち、端へ最も速く届くものの時間（分）。組み合わせが1通りならminutesと等しい。 */
  readonly shortestMinutes: number;

  /**
   * **生成時のロール（6.2節）が端から遠い側に出た場合**の時間（分）。ロールを持たない値では
   * minutesと等しい。
   *
   * 条件つきの幅（minutes〜shortestMinutes）とは別の軸なので、1つの幅へ畳まない——条件が重なった
   * のか重く出たのかが読めなくなる。値が戻って繰り返す周期では初期値が効かないので、ここでも
   * minutesと等しい。
   */
  readonly longestMinutes: number;

  readonly repeats: boolean;
  readonly destroysSelf: boolean;

  /** 外から与えられた増減で動いた周期なら、それを与える型（炉が焼く・傷が血を奪う）。 */
  readonly drivenBy: number | undefined;

  /** この周期を1つの工程として見たもの。何も生まない周期では出力が空になる。 */
  readonly step: CraftingStep;
}

/**
 * **tick毎に動く値がrangeの端へ届くまでの周期**と、そこで起こること（RangeCycle参照）。
 * 端で値が戻るものは繰り返す仕掛け（罠の判定、TrapSystem.md 2節）、端で自分が消えるものは
 * 寿命（罠の朽ち、DurabilitySystem.md 2節）。
 *
 * 段で切り替わる増減（8.2節）は数えない——段ごとに周期が変わるものは、1つの周期で言い表せない。
 *
 * externalは、隣の物が与えるtick毎の増減（ExternalTickDelta参照）。同じプロパティを動かすものが
 * 複数あれば、**押し手ごとに別の周期**を返す——炉で焼くのと傷で失血するのは、要る物も速さも違うし、
 * 同じ傷でも止まる出血と止まらない敗血症は別の仕掛けになる。
 */
export function rangeCyclesOf(
  def: ObjectDef,
  outer?: StaticValueResolver,
  external: readonly ExternalTickDelta[] = [],
): readonly RangeCycle[] {
  const cycles: RangeCycle[] = [];
  for (const propertyDef of def.enumeratePropertyDefs()) {
    const own = tickAmountsOf(def, propertyDef.globalId);
    // 生成時のロール（6.2節）は初期値を振らせるので、両端とも数える。
    const initialValues = ROLL_ENDS.map((end) => staticValueOf(def, propertyDef.globalId, end, outer));
    const drivers: readonly (ExternalTickDelta | undefined)[] = [
      undefined,
      ...external.filter((delta) => delta.propertyGlobalId === propertyDef.globalId),
    ];

    for (const driver of drivers) {
      const totals = totalsWithDriver(own, driver);

      // 印はこの読み出し1回ぶんに閉じる（craftingStepsが操作1つに閉じているのと同じ）。関数全体で
      // 1つにすると、先に積んだ周期には付かず後の周期だけに付く——プロパティの宣言順で答えが変わる。
      const tracking = trackingResolverOf(def, 'lowest', outer);
      for (const readout of rangeEventReadouts(propertyDef, tracking.resolve)) {
        // **どちらの端へ向かうかは、その端のイベント自身が決める。** 値が上下どちらへも動きうる
        // なら、下端の凍死も上端のクランプもそれぞれ自分の向きの場合だけを見る。
        const pace = paceTowards(totals, readout.label);
        if (pace === undefined) continue;

        // **どちらのロールが遠いかは、向かう端で裏返る**——下端へ向かうなら重く出たほうが、上端へ
        // 向かうなら軽く出たほうが遠い。端まで測ってから短い順に並べれば、向きに関わらず先頭が
        // 近い側・末尾が遠い側になる。
        const { slowest, fastest } = pace;
        const slowRoll = sortedTicksToRangeEnd(propertyDef, initialValues, slowest);
        const ticks = slowRoll.at(0);
        const longestTicks = slowRoll.at(-1);
        const shortestTicks = sortedTicksToRangeEnd(propertyDef, initialValues, fastest).at(0);
        if (ticks === undefined || longestTicks === undefined || shortestTicks === undefined) continue;

        // 外からの増減が止まる前に端へ届かないなら、その仕掛けは成立しない——小さな獲物は罠の傷でも
        // 失血で死ぬが、血の多い獲物は傷が固まるほうが先になる。
        if (driver?.maxTotal !== undefined && ticks * Math.abs(driver.slowest) > driver.maxTotal) continue;

        // 押し手が段に入って初めて効き始めるなら、そこへ届くまでの時間が端まで数えたtickの前に
        // 丸ごと要る（膿んでから血が減り始める）。**繰り返す周期には乗せない**——立ち上がりが
        // 効くのは初回だけで、次の発火までの間隔は変わらない。
        const untilStart = driver?.ticksUntilStart ?? 0;

        // 値が戻るなら、次の発火までは戻った量ぶん——初回だけが初期値からの距離になる。
        const repeats = readout.expectedReturnToSelf > 0;
        const period = repeats ? readout.expectedReturnToSelf / Math.abs(slowest) : ticks + untilStart;
        cycles.push({
          propertyGlobalId: propertyDef.globalId,
          minutes: period * MINUTES_PER_TICK,
          shortestMinutes:
            (repeats ? readout.expectedReturnToSelf / Math.abs(fastest) : shortestTicks + untilStart) *
            MINUTES_PER_TICK,
          longestMinutes: (repeats ? period : longestTicks + untilStart) * MINUTES_PER_TICK,
          repeats,
          destroysSelf: readout.destroysSelf,
          drivenBy: driver?.sourceGlobalId,
          step: {
            kind: 'periodic',
            // 時間で回る工程なので押せない。経路に並ぶのは、押し手が要るもの（火にかけた肉）だけで、
            // その絞り込みはdrivenBy・repeatsが受け持つ（balanceTables.allSteps）。
            startedByPlayer: false,
            name: `${propertyDef.name}.${readout.label}`,
            ownerGlobalId: def.globalId,
            inputs: [
              { kind: 'object', objectGlobalId: def.globalId, consumed: readout.destroysSelf, count: 1 },
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
            hasUnresolvedReferences: tracking.hitUnresolvedReference,
          },
        });
      }
    }
  }
  return cycles;
}

/**
 * 渡された初期値それぞれから、その速さで端へ届くまでのtick数を**短い順に並べた**もの。
 *
 * 読めない初期値と、生まれた時点で端に居て長さを持たない初期値は数に入れない——どれも届かなければ
 * 空になる。並べ替えるので、渡す順序に意味は無い。
 */
function sortedTicksToRangeEnd(
  propertyDef: PropertyDef,
  initialValues: readonly (number | undefined)[],
  perTick: number,
): readonly number[] {
  return initialValues
    .map((value) => ticksToRangeEnd(propertyDef, value, perTick))
    .filter((ticks): ticks is number => ticks !== undefined)
    .sort((a, b) => a - b);
}

/**
 * その型が、隣の物のtick毎の値を動かす分（ExternalTickDelta参照）。rootは相手から見た自分の位置——
 * 親が子を焼くなら`child`、刺さった傷が持ち主の血を奪うなら`parent`。
 *
 * **誰の隣に立てるかは答えない**（枠の受け入れを見る側の仕事）。答えるのは、隣に立てたとして
 * どれだけ速く、いつまで動かせるか。
 *
 * 1つの型が同じプロパティへ**複数の押し手**を並べることがある——裂傷は止まる出血と止まらない
 * 敗血症の2つで血を奪う。束ねる単位は限度と立ち上がりで、速さだけが幅になる。
 */
export function externalTickDeltasOf(def: ObjectDef, root: 'parent' | 'child'): readonly ExternalTickDelta[] {
  // **束ねてよいのは限度も立ち上がりも同じものどうしだけ。** 違うものを束ねると、どの仕掛けも
  // 持っていない（速さ, 限度, 立ち上がり）の組ができる——止まる出血（-15/tickで合計60mL）と
  // 止まらない敗血症（-40/tick）を1つにすれば「-15/tickで永久に流れ続ける傷」になり、膿んだ傷が
  // 奪う水（festeringから-1、septicから-2）を1つにすれば「膿み始めた時点で-2」になる。炉の火力
  // （heatの段で1/3/5）はどれも止まらず、立ち上がりも読めない（ticksUntilGateRises）ので、今まで
  // どおり1つの幅に収まる。
  const byPropertyLimitAndStart = new Map<string, ExternalTickDelta>();
  for (const delta of tickDeltasOf(def)) {
    if (delta.target !== root || delta.amount === 0) continue;

    const ticks = ticksWhileGateHolds(def, delta.gate);
    const maxTotal = ticks === undefined ? undefined : ticks * Math.abs(delta.amount);
    const ticksUntilStart = ticksUntilGateRises(def, delta.gate);
    const key = `${delta.propertyGlobalId}:${maxTotal}:${ticksUntilStart}`;
    const known = byPropertyLimitAndStart.get(key);
    byPropertyLimitAndStart.set(key, {
      sourceGlobalId: def.globalId,
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
      maxTotal,
      ticksUntilStart,
    });
  }
  return [...byPropertyLimitAndStart.values()];
}

/**
 * その型のtick毎の値を外から動かす物（ExternalTickDelta参照）。**枠の受け入れが唯一の手掛かり**——
 * 炉の火の枠が`roastable`を受けるから炉は肉を焼けるし、獲物の怪我の枠が`injury`を受けるから
 * 刺さった傷は血を奪える。
 */
export function externalTickDeltasOn(
  def: ObjectDef,
  defs: readonly ObjectDef[],
): readonly ExternalTickDelta[] {
  const found: ExternalTickDelta[] = [];
  for (const source of defs) {
    if (source.globalId === def.globalId) continue;
    if (source.slotDefs.some((slot) => slot.acceptsAnywhere(def)))
      found.push(...externalTickDeltasOf(source, 'child'));
    if (def.slotDefs.some((slot) => slot.acceptsAnywhere(source)))
      found.push(...externalTickDeltasOf(source, 'parent'));
  }
  return found;
}

/** そのプロパティが自分のtick毎の持続効果で取りうる量（tickAmountsOf）。 */
interface TickAmounts {
  /** 常時効く分だけの合計。条件つきの増減（8.2節）を含まない。 */
  readonly unconditional: number;

  /** 同時に成立しうる組み合わせごとの合計。常時効く分を含み、同じ値は畳んである。 */
  readonly possible: readonly number[];
}

/**
 * そのプロパティが、自分のtick毎の持続効果でどれだけ動くか（段で切り替わるものは除く）。
 *
 * **問いは「条件つきの増減（8.2節）を合算するか」ではなく「どの組み合わせが同時に成立しうるか」。**
 * 全部を1つの場合として足すと、成立しえない組み合わせ——同じ気温を`lt`と`gte`で見ている寒さと
 * 暖かさ——が打ち消し合って、その周期が丸ごと消える。排他だと言い切れる対（mutuallyExclusive）
 * だけを落とし、残る組み合わせをすべて場合として並べる。
 *
 * 落とせない対は重なりうるものとして数える。罠の耐久がこれで、地面にある間の-1と獲物を抱えて
 * いる間の-10は、同時にも起こるので-11の場合を持つ。
 */
function tickAmountsOf(def: ObjectDef, propertyGlobalId: number): TickAmounts {
  let unconditional = 0;
  const conditional: TickDelta[] = [];
  for (const delta of tickDeltasOf(def)) {
    if (delta.target !== 'self' || delta.propertyGlobalId !== propertyGlobalId) continue;
    if (delta.gate.stage !== undefined) continue;
    if (delta.gate.conditional) conditional.push(delta);
    else unconditional += delta.amount;
  }
  return { unconditional, possible: possibleTotalsOf(unconditional, conditional) };
}

/**
 * 常時効く分に、**同時に成立しうる条件つきの増減**を重ねた合計を並べる。1つも重ねない場合
 * （常時効く分だけ）も含む——条件つきは、成立しない場面があるからこそ条件つきになっている。
 */
function possibleTotalsOf(unconditional: number, conditional: readonly TickDelta[]): readonly number[] {
  let combinations: (readonly TickDelta[])[] = [[]];
  for (const delta of conditional) {
    const grown = combinations
      .filter((combination) =>
        combination.every((member) => !mutuallyExclusive(member.gate.conditions, delta.gate.conditions)),
      )
      .map((combination) => [...combination, delta]);
    combinations = [...combinations, ...grown];
  }

  return [
    ...new Set(
      combinations.map((combination) =>
        combination.reduce((total, delta) => total + delta.amount, unconditional),
      ),
    ),
  ];
}

/**
 * その端へ向かって動く場合のうち、最も遅い量と最も速い量。その端へ向かう場合が1つも無ければ
 * undefined＝その端のイベントは起こらない。
 */
function paceTowards(
  totals: readonly number[],
  label: RangeEventLabel,
): { readonly slowest: number; readonly fastest: number } | undefined {
  const towards = totals.filter((amount) => (label === 'on_min' ? amount < 0 : amount > 0));
  if (towards.length === 0) return undefined;

  return {
    slowest: towards.reduce((best, amount) => (Math.abs(amount) < Math.abs(best) ? amount : best)),
    fastest: towards.reduce((best, amount) => (Math.abs(amount) > Math.abs(best) ? amount : best)),
  };
}

/**
 * 押し手（ExternalTickDelta）まで含めた、tick毎に取りうる量。押し手が居なければ自分の分がそのまま。
 *
 * **押されている間、自分の条件つきの増減（8.2節）は数えない。** その条件が成立する場面と押されて
 * いる場面が同時に来るかは定義からは決まらず、石が冷めるのは炉の外に居る間の宣言（祖先の火力を
 * `not` で見る）なので、足し合わせると押し手の向き——熱を溜める——を打ち消して周期そのものが消える。
 */
function totalsWithDriver(own: TickAmounts, driver: ExternalTickDelta | undefined): readonly number[] {
  if (driver === undefined) return own.possible;
  return [own.unconditional + driver.slowest, own.unconditional + driver.fastest];
}

/**
 * ゲートが自分の値を見ているなら、その値が尽きて条件が落ちるまでのtick数（TickGate参照）。
 * 見ていない、または尽きない値なら undefined＝止まらない。
 */
function ticksWhileGateHolds(def: ObjectDef, gate: TickGate): number | undefined {
  let fewest: number | undefined;
  for (const propertyGlobalId of gate.watchedSelfProperties) {
    // 尽きるまでを**最も短く**見る側（fastest・fewest）に合わせて、ロールも軽く出たほうを採る。
    const value = staticValueOf(def, propertyGlobalId, 'lowest');
    const pace = paceTowards(tickAmountsOf(def, propertyGlobalId).possible, 'on_min');
    if (value === undefined || pace === undefined) continue;

    const ticks = Math.ceil(value / -pace.fastest);
    if (fewest === undefined || ticks < fewest) fewest = ticks;
  }
  return fewest;
}

/**
 * ゲートが自分の段を見ているなら、そこへ自分の増減だけで届くまでのtick数（TickGate参照）。
 * 段を見ていない、届くまでが読めない段なら0＝最初のtickから効く。**炉の火力がこれ**——火は段の
 * 下に置かれた増減（8.2節）で育つが、そこはtickAmountsOfが数から外している。
 *
 * **要る段が複数あれば最も遅いものに合わせる**——どれか1つでも跨いでいなければ増減は効かない。
 * ゲートが落ちるのは見ている値のどれかが尽きた時点なので、ticksWhileGateHoldsとは向きが逆になる。
 */
function ticksUntilGateRises(def: ObjectDef, gate: TickGate): number {
  let longest = 0;
  for (const { propertyGlobalId, stageName } of gate.requiredSelfStages) {
    // 届くまでを**最も長く**見る側（slowest）に合わせて、ロールも段から遠いほうを採る。止まるまでを
    // 最も短く見るのと同じで、押し手を控えめに数える側へ揃える。
    const bound = def
      .tryGetPropertyDef(propertyGlobalId)
      ?.stages.find((stage) => stage.name === stageName)?.lowerBound;
    const value = staticValueOf(def, propertyGlobalId, 'lowest');
    const pace = paceTowards(tickAmountsOf(def, propertyGlobalId).possible, 'on_max');
    if (bound === undefined || value === undefined || pace === undefined) continue;

    // 生まれた時点でその段に居るなら待ちは無い（届くまでが0以下になる）。
    const ticks = Math.ceil((bound - value) / pace.slowest);
    if (ticks > longest) longest = ticks;
  }
  return longest;
}
