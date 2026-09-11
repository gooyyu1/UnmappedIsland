import type { ObjectDef } from '../domain/ObjectDef';
import type { PropertyDef, RangeEventLabel } from '../domain/PropertyDef';
import { movesTowardEnd, RANGE_EVENT_LABELS, rollEndAwayFrom, ROLL_ENDS } from '../domain/PropertyDef';
import type { SelfStageRequirement, TickDelta, TickGate } from './tickDeltas';
import { tickDeltasOf } from './tickDeltas';
import type { CraftingStep } from './CraftingStep';
import { collectOutputs } from './CraftingStep';
import { rangeEventReadouts, ticksToRangeEnd } from './rangeEvents';
import type { StaticValueResolver } from './staticValue';
import { MINUTES_PER_TICK } from './balanceTables';
import { staticValueOf, trackingResolverOf } from './staticValue';
import type { ObjectGlobalId, PropertyGlobalId } from '../domain/GlobalId';

/**
 * 外から与えられるtick毎の増減。**焼くのも失血も、自分では動かない値を隣の物が動かす**——炉が
 * 火にかけた物の加熱を進め、刺さった傷が持ち主の血を奪う。誰が誰の隣に居るかは型だけでは決まらない
 * ので、文脈を知っている側（収支レポート）が組み立てて渡す。
 */
export interface ExternalTickDelta {
  /** その増減を与える型。その周期を回すのに要る物（炉・刺さった傷）として工程の入力に並ぶ。 */
  readonly sourceGlobalId: ObjectGlobalId;

  readonly propertyGlobalId: PropertyGlobalId;

  /**
   * その押し手がtick毎に取りうる量。**同時に成立しうる組み合わせごとに1つ**（tickAmountsOfの
   * `possible` と同じ見方）で、同じ値は畳んである。炉は火力の段で1・3・5を取る。
   *
   * **幅（最も遅い・最も速い）へ畳まずに並びのまま持つ。** 足し合わせた押し方は向きが揃うとは
   * 限らず（常時引く分と条件つきで足す分）、畳むと押される向きのどちらかが落ちる。どちらの端の
   * イベントへ向かうかで選び直すのは、受け取る側（paceTowards）の仕事。
   */
  readonly amounts: readonly number[];

  /**
   * その増減が効き始めるまでのtick数。**段に入って初めて効く増減**——傷が宿主の菌を押し上げるのは
   * `infection` が `festering` へ届いてから——では、そこまでの時間が周期の前に丸ごと要る。最初のtickから
   * 効くなら0。
   */
  readonly ticksUntilStart: number;

  /**
   * その増減が止まるまでのtick数（{@link ticksUntilStart} と同じく、生まれた時点から数える）。
   * 止まらない増減（薪をくべ続ける炉）ではundefined。
   *
   * **動かせる総量ではなく長さで持つ。** 総量は「長さ×その速さ」でしかないので、速さが幅を持った
   * 途端に、どの速さで割り戻すのかが決まらなくなる——毒の残る間だけ効く棘は刺さりの深さで速さが
   * 変わっても、止まるのは同じ毒が尽きたときで、長さのほうは1つに決まる。
   */
  readonly ticksUntilStop: number | undefined;
}

/**
 * tick毎に動く値がrangeの端へ届くまでの周期と、そこで起こること。
 *
 * repeatsなら端で値が戻って繰り返す（罠は4時間ごとに獲物を判定する）。destroysSelfなら端で
 * 自分が消えるので、minutesはその型の寿命そのものになる。
 */
export interface RangeCycle {
  readonly propertyGlobalId: PropertyGlobalId;

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

  /**
   * **端へ向かうのに要る、条件つきの増減（8.2節）の組み合わせ。** どれも成立していなければ向かわない。
   * **逆は言わない**——どれかが成立していても、遅くする増減が同時に成立していれば向かわないことは
   * ある（その場合を見るのはminutesのほう）。
   *
   * **それだけで向かえる最小のものしか入らない**（leastCombinationsOf）ので、遅くするだけの増減も、
   * 片方だけで足りるときの相方も残らない——周期を決めた組み合わせとは別物（issue #1433）。
   *
   * 空の組み合わせ1つだけ（`[[]]`）なら、条件が1つも成立しなくても向かう。**押し手のある周期
   * （drivenBy）は必ずこの形**——totalsWithDriverが自分の条件つきを数から落とすので、条件は押し手が
   * 傍に在ることのほうで、それはdrivenByが持つ。
   */
  readonly gatedBy: readonly (readonly TickDelta[])[];

  /** 外から与えられた増減で動いた周期なら、それを与える型（炉が焼く・傷が血を奪う）。 */
  readonly drivenBy: ObjectGlobalId | undefined;

  /** この周期を1つの工程として見たもの。何も生まない周期では出力が空になる。 */
  readonly step: CraftingStep;
}

/**
 * **tick毎に動く値がrangeの端へ届くまでの周期**と、そこで起こること（RangeCycle参照）。
 * 端で値が戻るものは繰り返す仕掛け（罠の判定、TrapSystem.md 2節）、端で自分が消えるものは
 * 寿命（罠の朽ち、DurabilitySystem.md 2節）。
 *
 * 段で切り替わる増減（8.2節）は数えない——段ごとに周期が変わるものは、1つの周期で言い表せない。
 * **押し手がその段を開けた場合だけは別**で、そこは押し手ごとに1つの速さに決まる
 * （relayedTickDeltasOf）。
 *
 * neighborsは、この型の傍に置かれうる型。**そこから押し手を拾うのはここ**（externalTickDeltasOn）
 * ——同じプロパティを動かすものが複数あれば、**押し手ごとに別の周期**を返す。炉で焼くのと傷で
 * 失血するのは、要る物も速さも違う。省くと、隣に押されて初めて進む周期は返らない。
 */
export function rangeCyclesOf(
  def: ObjectDef,
  outer?: StaticValueResolver,
  neighbors: readonly ObjectDef[] = [],
): readonly RangeCycle[] {
  const external = externalTickDeltasOn(def, neighbors);
  const pushed = [...external, ...external.flatMap((driver) => relayedTickDeltasOf(def, driver))];

  const cycles: RangeCycle[] = [];
  for (const propertyDef of def.enumeratePropertyDefs()) {
    const own = tickAmountsOf(def, propertyDef.globalId);
    // 生成時のロール（6.2節）は初期値を振らせるので、両端とも数える。
    const initialValues = ROLL_ENDS.map((end) => staticValueOf(def, propertyDef.globalId, end, outer));
    const drivers: readonly (ExternalTickDelta | undefined)[] = [
      undefined,
      ...pushed.filter((delta) => delta.propertyGlobalId === propertyDef.globalId),
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
        const slowRoll = sortedTicksToRangeEnd(propertyDef, initialValues, slowest.amount);
        const ticks = slowRoll.at(0);
        const longestTicks = slowRoll.at(-1);
        const shortestTicks = sortedTicksToRangeEnd(propertyDef, initialValues, fastest.amount).at(0);
        if (ticks === undefined || longestTicks === undefined || shortestTicks === undefined) continue;

        // 押し手が段に入って初めて効き始めるなら、そこへ届くまでの時間が端まで数えたtickの前に
        // 丸ごと要る（膿んでから菌を押し上げ始める）。**繰り返す周期には乗せない**——立ち上がりが
        // 効くのは初回だけで、次の発火までの間隔は変わらない。
        const untilStart = driver?.ticksUntilStart ?? 0;

        // 外からの増減が止まる前に端へ届かないなら、その仕掛けは成立しない——小さな獲物は罠の傷でも
        // 失血で死ぬが、血の多い獲物は傷が固まるほうが先になる。押せるのは効き始めてから止まるまでの
        // 間だけなので、立ち上がりのぶんは持ち時間から引く。
        if (driver?.ticksUntilStop !== undefined && ticks > driver.ticksUntilStop - untilStart) continue;

        // 値が戻るなら、次の発火までは戻った量ぶん——初回だけが初期値からの距離になる。
        const repeats = readout.expectedReturnToSelf > 0;
        const period = repeats ? readout.expectedReturnToSelf / Math.abs(slowest.amount) : ticks + untilStart;
        cycles.push({
          propertyGlobalId: propertyDef.globalId,
          minutes: period * MINUTES_PER_TICK,
          shortestMinutes:
            (repeats ? readout.expectedReturnToSelf / Math.abs(fastest.amount) : shortestTicks + untilStart) *
            MINUTES_PER_TICK,
          longestMinutes: (repeats ? period : longestTicks + untilStart) * MINUTES_PER_TICK,
          repeats,
          destroysSelf: readout.destroysSelf,
          gatedBy: pace.gatedBy,
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
 * 押し手に押された値が段へ届いて初めて動き出す、**相手自身の別のプロパティ**の増減。罠に掛かった
 * 獣が倒れるのはこれ——傷は宿主の菌（`pathogen`）を押し上げるだけで血には触れず、血を削るのは菌が
 * `septicemic`へ届いて開く、宿主自身の段の下の増減（8.2節）になる。押し手が直接動かす分だけを見て
 * いると、この道が丸ごと消える。
 *
 * **辿るのは1段だけ**で、ここで返した増減からさらに段を辿ることはしない。開いた段が開き続けている
 * ことは、1段目なら押し手が傍に在り続けること（ticksUntilStop）で言えるが、2段目から先は相手自身の
 * 値が決めることで、その値の動きは段で切り替わる増減を含む——そこはtickAmountsOfが数から外して
 * いるので、辿るほど成立しない経路が立つ。
 *
 * **段は下からも上からも開く。** 押し上げる押し手は段の下端を跨いで入り、押し下げる押し手は段の
 * 上端を割って入る——どちらも、その段の下の増減を動かし始めたのは押し手であることに変わりは無い。
 * どちらの向きへ押しているかは押し手ごとに1つに決まらない（取りうる量が向きを跨ぐ）ので、
 * rangeCyclesOfが両端のイベントを別々に見るのと同じく、ここでも両方の向きを見る。
 *
 * 返す増減の与え手（sourceGlobalId）は押し手のまま。段を開けたのは押し手なので、その周期に要る物は
 * 押し手が傍に在ることで変わらない。
 */
function relayedTickDeltasOf(def: ObjectDef, driver: ExternalTickDelta): readonly ExternalTickDelta[] {
  const byWindow = new Map<string, ExternalTickDelta>();
  for (const pushedToward of RANGE_EVENT_LABELS) {
    for (const delta of tickDeltasOf(def)) {
      // 押している値そのものへ戻る分は辿らない——開くのは相手自身の**別の**プロパティの段。
      if (delta.target !== 'self' || delta.amount === 0) continue;
      if (delta.propertyGlobalId === driver.propertyGlobalId) continue;
      // 段のほかにも縛りがあるなら、それが押されている間に成立するかは定義からは決まらない
      // （totalsWithDriverが自分の条件つきを数えないのと同じ理由）。
      if (!delta.gate.gatedOnlyBySelfStages) continue;

      const untilStage = ticksUntilDrivenStage(def, driver, delta.gate, pushedToward);
      if (untilStage === undefined) continue;

      // 押し手が効き始めてから段が開くまでが、そのぶんだけ後ろへずれる。
      const ticksUntilStart = driver.ticksUntilStart + untilStage;

      // **開けた押し手が、そのまま段の外へ押し抜けさせる。** 押し上げるならちょうどその段に居る間
      // だけ効く増減（`in_stage`、14.1節）が次の段で効かなくなり——熱で余計に渇く分は、菌が
      // `feverish`を抜けて`septicemic`へ入れば止まる——押し下げるなら`in_stage`も「その段以上」も、
      // 名指した段の下端を割った時点で外れる。押し手自身が止まるほうが先ならそちらで、どちらも
      // 来る前に段が開かないなら、その中継は起こらない。
      const untilStageLeft = ticksUntilDrivenStageLeft(def, driver, delta.gate, pushedToward);
      const stops = [
        driver.ticksUntilStop,
        untilStageLeft === undefined ? undefined : driver.ticksUntilStart + untilStageLeft,
      ].filter((ticks): ticks is number => ticks !== undefined);
      const ticksUntilStop = stops.length === 0 ? undefined : Math.min(...stops);
      if (ticksUntilStop !== undefined && ticksUntilStop <= ticksUntilStart) continue;

      // 同じ段の下に並ぶ増減は同時に効くので足し合わせる。効いている間の違うものは束ねない
      // （externalTickDeltasOfのbyWindowと同じ鍵・同じ約束）。**押している向きも鍵に入る**——
      // 上へ押す場合と下へ押す場合は同じ押し手の別の場合で、同時には起こらない。
      const key = `${pushedToward}:${delta.propertyGlobalId}:${ticksUntilStart}:${ticksUntilStop}`;
      const known = byWindow.get(key);
      byWindow.set(key, {
        sourceGlobalId: driver.sourceGlobalId,
        propertyGlobalId: delta.propertyGlobalId,
        amounts: [(known?.amounts[0] ?? 0) + delta.amount],
        ticksUntilStart,
        ticksUntilStop,
      });
    }
  }
  return [...byWindow.values()];
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
    .filter((value): value is number => value !== undefined)
    .map((value) => ticksToRangeEnd({ propertyDef, value }, perTick))
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
 * 1つの型が同じプロパティへ**複数の押し手**を並べることがある——膿んだ傷は、膿み始めてからと
 * 腐り切ってからの2つで宿主の菌を押し上げる。
 *
 * **問いは自分のプロパティの側（tickAmountsOf）と同じで、「どの組み合わせが同時に成立しうるか」。**
 * 常時効く宣言と条件つきの宣言が並べば、起こるのは「常時分」と「常時分＋条件つき分」で、
 * 「条件つき分だけ」は起こらない。同時には効かない押し方どうし（炉の火力はheatの段で1/3/5）は、
 * 1つの押し手が取りうる量として並べる。
 */
export function externalTickDeltasOf(def: ObjectDef, root: 'parent' | 'child'): readonly ExternalTickDelta[] {
  const byProperty = new Map<PropertyGlobalId, TickDelta[]>();
  for (const delta of tickDeltasOf(def)) {
    if (delta.target !== root || delta.amount === 0) continue;
    const known = byProperty.get(delta.propertyGlobalId);
    if (known === undefined) byProperty.set(delta.propertyGlobalId, [delta]);
    else known.push(delta);
  }

  const found: ExternalTickDelta[] = [];
  for (const [propertyGlobalId, deltas] of byProperty) {
    // **幅に束ねられるのは、効いている間が同じ押し方どうしだけ。** 同時に効かないことは幅にしてよい
    // 理由でしかなく、いつからいつまでかは押し手が1つの答えを持たなければならない——膿んだ傷が
    // 押し上げる菌（festeringから0.12、septicから0.35）を1つにすると「膿み始めた時点で0.35」に、
    // 止まる出血（4 tick）と止まらない敗血症を1つにすると「その速さで永久に流れ続ける傷」になる。
    const byWindow = new Map<string, ExternalTickDelta>();
    for (const pushing of pushingCasesOf(def, deltas)) {
      const key = `${pushing.ticksUntilStart}:${pushing.ticksUntilStop}`;
      const known = byWindow.get(key);
      byWindow.set(key, {
        sourceGlobalId: def.globalId,
        propertyGlobalId,
        amounts: [...new Set([...(known?.amounts ?? []), pushing.amount])],
        ticksUntilStart: pushing.ticksUntilStart,
        ticksUntilStop: pushing.ticksUntilStop,
      });
    }
    found.push(...byWindow.values());
  }
  return found;
}

/** 同時に成立しうる外向きの増減をひと組にした、1通りの押し方（pushingCasesOf）。 */
interface PushingCase {
  readonly amount: number;
  readonly ticksUntilStart: number;
  readonly ticksUntilStop: number | undefined;
}

/**
 * 同じ相手プロパティを動かす外向きの増減から、**同時に成立しうる組み合わせ**
 * （coincidingCombinationsOf）が起こす押し方をすべて挙げる。
 *
 * 組み合わせが効いているのは、**どの宣言も効き始めた後で、どれかが止まるまでの間**。そこが空に
 * なる組み合わせは起こらないので落とす——固まるまで4 tickの出血と、320 tick後に始まる敗血症は、
 * 重なる時が無い。
 */
function pushingCasesOf(def: ObjectDef, deltas: readonly TickDelta[]): readonly PushingCase[] {
  // 段でも条件でも縛られていない増減は、どの場面でも効いているので必ず数に入る。
  const heldBack = (delta: TickDelta) => delta.gate.stage !== undefined || delta.gate.conditional;
  const always = deltas.filter((delta) => !heldBack(delta));

  return coincidingCombinationsOf(deltas.filter(heldBack))
    .map((combination) => pushingCaseOf(def, [...always, ...combination]))
    .filter((pushing): pushing is PushingCase => pushing !== undefined);
}

/**
 * 縛られた増減（段・条件つき）のうち、**同時に成立しうる組み合わせ**をすべて挙げる。1つも重ねない
 * 場合も含む——縛られた増減は、成立しない場面があるからこそ縛られている。
 *
 * 落とすのは**排他だと言い切れる対**（TickGate.neverHoldsWith）だけで、落とせない対は重なりうる
 * ものとして数える。**常時効く増減は渡さない**——どの場面でも効いているのだから、どれとも重なる。
 * どの組み合わせにも同じものが並ぶだけなので、重ねるのは呼ぶ側の仕事。
 */
function coincidingCombinationsOf(gated: readonly TickDelta[]): readonly (readonly TickDelta[])[] {
  let combinations: (readonly TickDelta[])[] = [[]];
  for (const delta of gated) {
    const grown = combinations
      .filter((combination) => combination.every((member) => !member.gate.neverHoldsWith(delta.gate)))
      .map((combination) => [...combination, delta]);
    combinations = [...combinations, ...grown];
  }
  return combinations;
}

/** その増減たちがtick毎に動かす合計。 */
function totalAmountOf(deltas: readonly TickDelta[]): number {
  return deltas.reduce((total, delta) => total + delta.amount, 0);
}

/** その組み合わせが起こす押し方。押していない（合計0）か、効いている間が空ならundefined。 */
function pushingCaseOf(def: ObjectDef, combination: readonly TickDelta[]): PushingCase | undefined {
  const amount = totalAmountOf(combination);
  if (amount === 0) return undefined;

  const ticksUntilStart = Math.max(...combination.map((delta) => ticksUntilGateRises(def, delta.gate)));
  const stops = combination
    .map((delta) => ticksUntilGateFalls(def, delta.gate))
    .filter((ticks): ticks is number => ticks !== undefined);
  const ticksUntilStop = stops.length === 0 ? undefined : Math.min(...stops);
  if (ticksUntilStop !== undefined && ticksUntilStop <= ticksUntilStart) return undefined;

  return { amount, ticksUntilStart, ticksUntilStop };
}

/**
 * その型のtick毎の値を外から動かす物（ExternalTickDelta参照）。**枠の受け入れが唯一の手掛かり**——
 * 炉の火の枠が`roastable`を受けるから炉は肉を焼けるし、獲物の怪我の枠が`injury`を受けるから
 * 刺さった傷は血を奪える。
 */
function externalTickDeltasOn(def: ObjectDef, defs: readonly ObjectDef[]): readonly ExternalTickDelta[] {
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

  /** 同時に成立しうる組み合わせごとの合計。常時効く分を含み、量が同じでも組み合わせごとに並ぶ。 */
  readonly possible: readonly TickTotal[];
}

/**
 * 同時に成立しうる組み合わせ1つぶんの、tick毎の合計。
 *
 * **合計と一緒に組み合わせそのものを持つ**のは、その量を選んだ側が「どういうときにその量か」を
 * 答えられるようにするため（RangeCycle.gatedBy）。
 */
interface TickTotal {
  /** その組み合わせでのtick毎の合計。常時効く分を含む。 */
  readonly amount: number;

  /** その組み合わせに入っている条件つきの増減（8.2節）。常時効く分だけなら空。 */
  readonly conditional: readonly TickDelta[];
}

/**
 * そのプロパティが、自分のtick毎の持続効果でどれだけ動くか（段で切り替わるものは除く）。
 *
 * **問いは「条件つきの増減（8.2節）を合算するか」ではなく「どの組み合わせが同時に成立しうるか」**
 * （coincidingCombinationsOf）。全部を1つの場合として足すと、成立しえない組み合わせ——同じ気温を
 * `lt`と`gte`で見ている寒さと暖かさ——が打ち消し合って、その周期が丸ごと消える。
 *
 * 落とせない対を持つのが罠の耐久で、地面にある間の-1と獲物を抱えている間の-10は、同時にも起こる
 * ので-11の場合を持つ。
 */
function tickAmountsOf(def: ObjectDef, propertyGlobalId: PropertyGlobalId): TickAmounts {
  const always: TickDelta[] = [];
  const conditional: TickDelta[] = [];
  for (const delta of tickDeltasOf(def)) {
    if (delta.target !== 'self' || delta.propertyGlobalId !== propertyGlobalId) continue;
    if (delta.gate.stage !== undefined) continue;
    (delta.gate.conditional ? conditional : always).push(delta);
  }
  return { unconditional: totalAmountOf(always), possible: possibleTotalsOf(always, conditional) };
}

/**
 * 常時効く分（always）に、**同時に成立しうる条件つきの増減**（coincidingCombinationsOf）を重ねた
 * 合計を並べる。
 */
function possibleTotalsOf(
  always: readonly TickDelta[],
  conditional: readonly TickDelta[],
): readonly TickTotal[] {
  // **同じ量になる組み合わせも畳まない。** 畳むと、落ちた側でしか成立しない条件が「無い」ことに
  // なる——日差しでも風でも同じ速さで乾くなら、どちらでも乾くと言えなければならない（RangeCycle.gatedBy）。
  return coincidingCombinationsOf(conditional).map((combination) => ({
    amount: totalAmountOf([...always, ...combination]),
    conditional: combination,
  }));
}

/** その端へ向かって動く速さの幅（paceTowards）。 */
interface Pace {
  readonly slowest: TickTotal;
  readonly fastest: TickTotal;

  /** その端へ向かわせる、条件つきの増減の組み合わせ（RangeCycle.gatedBy）。 */
  readonly gatedBy: readonly (readonly TickDelta[])[];
}

/**
 * その端へ向かって動く場合のうち、最も遅い量と最も速い量（Pace）。その端へ向かう場合が1つも
 * 無ければundefined＝その端のイベントは起こらない。
 */
function paceTowards(totals: readonly TickTotal[], label: RangeEventLabel): Pace | undefined {
  const towards = totals.filter(({ amount }) => movesTowardEnd(label, amount));
  if (towards.length === 0) return undefined;

  return {
    slowest: towards.reduce((best, total) => (Math.abs(total.amount) < Math.abs(best.amount) ? total : best)),
    fastest: towards.reduce((best, total) => (Math.abs(total.amount) > Math.abs(best.amount) ? total : best)),
    gatedBy: leastCombinationsOf(towards.map((total) => total.conditional)),
  };
}

/**
 * 端へ向かわせる組み合わせのうち、**それだけで向かえる最小のもの**だけ。
 *
 * 他を丸ごと含むものは落とす——含む側は、含まれる側だけで足りることの言い換えでしかないので、残すと
 * 足さなくても向かう条件が「要る」として並ぶ。**同じ中身どうしも1つに畳む**——押し手は取りうる量の
 * ぶんだけ場合を作り、そのどれもが条件つきを持たない（totalsWithDriver）ので、畳まないと空の
 * 組み合わせが量の数だけ残る。
 *
 * 1つも条件を要らない場合が在れば、それが他のすべてを落とすので、残るのは空の組み合わせ1つ。
 */
function leastCombinationsOf(
  combinations: readonly (readonly TickDelta[])[],
): readonly (readonly TickDelta[])[] {
  return combinations.filter(
    (combination, index) =>
      !combinations.some(
        (other, otherIndex) =>
          // 同じ中身なら先に現れたほうを残す。長さが同じで丸ごと含むのは、中身が同じということ。
          (other.length < combination.length || otherIndex < index) &&
          other.every((delta) => combination.includes(delta)),
      ),
  );
}

/**
 * 押し手（ExternalTickDelta）まで含めた、tick毎に取りうる量。押し手が居なければ自分の分がそのまま。
 *
 * **押されている間、自分の条件つきの増減（8.2節）は数えない。** その条件が成立する場面と押されて
 * いる場面が同時に来るかは定義からは決まらず、石が冷めるのは炉の外に居る間の宣言（祖先の火力を
 * `not` で見る）なので、足し合わせると押し手の向き——熱を溜める——を打ち消して周期そのものが消える。
 */
function totalsWithDriver(own: TickAmounts, driver: ExternalTickDelta | undefined): readonly TickTotal[] {
  if (driver === undefined) return own.possible;
  return driver.amounts.map((amount) => ({ amount: own.unconditional + amount, conditional: [] }));
}

/**
 * ゲートが落ちて、その増減が効かなくなるまでのtick数（TickGate参照）。**見ている自分の値が
 * 尽きるか、居ることを要求された段を抜けるか**で落ちる。どちらも来なければundefined＝
 * 止まらない。**生まれた時点から数える**ので、効き始めまでの時間（ticksUntilGateRises）と同じ
 * 物差しの上に乗る。
 *
 * **段は上へも下へも抜ける。** 値がどちらへ動くかは定義からは1つに決まらないので、どちらの抜け方も
 * 数える。
 *
 * 落ちるのは**要るもののどれか1つが外れた時点**なので、最も早いものを採る。
 */
function ticksUntilGateFalls(def: ObjectDef, gate: TickGate): number | undefined {
  const falls = [
    ...gate.watchedSelfProperties.map((propertyGlobalId) => ticksUntilValueRunsOut(def, propertyGlobalId)),
    ...gate.requiredSelfStages.flatMap((required) => [
      ticksUntilStageLeftUpward(def, required),
      ticksUntilStageLeftDownward(def, required),
    ]),
  ].filter((ticks): ticks is number => ticks !== undefined);
  return falls.length === 0 ? undefined : Math.min(...falls);
}

/** その値が尽きて、それを見ている条件が外れるまでのtick数。尽きない値ならundefined。 */
function ticksUntilValueRunsOut(def: ObjectDef, propertyGlobalId: PropertyGlobalId): number | undefined {
  // 尽きるまでを**最も短く**見る側（fastest）に合わせて、ロールも軽く出たほうを採る。
  return ticksToReach(
    staticValueOf(def, propertyGlobalId, 'lowest'),
    0,
    paceTowards(tickAmountsOf(def, propertyGlobalId).possible, 'on_min')?.fastest.amount,
  );
}

/**
 * 要求された段を上へ抜けて、条件が外れるまでのtick数。抜ける先が無い、上がっていかない値、
 * 値の並びの上に位置を持たない段（シンボル型、6.6節）ならundefined。
 */
function ticksUntilStageLeftUpward(def: ObjectDef, required: SelfStageRequirement): number | undefined {
  // 速さは**最も速い増減**（fastest）で、ロールは効き始め（ticksUntilGateRises）と同じ段から
  // 遠いほうを採る。**効き始めから抜けるまでが最も狭くなる組**で、押し手を控えめに数える側。
  return ticksToReach(
    staticValueOf(def, required.propertyGlobalId, 'lowest'),
    stageUpperBoundOf(def, required),
    paceTowards(tickAmountsOf(def, required.propertyGlobalId).possible, 'on_max')?.fastest.amount,
  );
}

/**
 * 要求された段を下へ抜けて、条件が外れるまでのtick数。下がっていかない値、抜け出る先が無い段
 * （PropertyDef.lowerExitOfStage）ならundefined。
 *
 * **ちょうどその段（`in_stage`）も「その段以上」（`in_stage_or_above`、14.1節）も、名指した段の
 * 下端を割れば外れる**ので、抜ける先は同じ。上へ抜けるほう（ticksUntilStageLeftUpward）が
 * `in_stage`だけなのと、ここが違う。
 *
 * **生まれた時点で下端より下に在る値は抜けない**（ticksToFallBelow）——その段へ入るのはこれから
 * で、いつ入るかを答えるのはticksUntilGateRises。ここで抜けたことにすると、その押し手が丸ごと
 * 消える。
 */
function ticksUntilStageLeftDownward(def: ObjectDef, required: SelfStageRequirement): number | undefined {
  // 速さもロールもticksUntilStageLeftUpwardと同じ側——効き始めから抜けるまでが最も狭くなる組で、
  // 押し手を控えめに数える。
  return ticksToFallBelow(
    staticValueOf(def, required.propertyGlobalId, 'lowest'),
    stageLowerExitOf(def, required),
    paceTowards(tickAmountsOf(def, required.propertyGlobalId).possible, 'on_min')?.fastest.amount,
  );
}

/**
 * 名指された段の上端＝**上へ押し抜けて行き着く先であり、上から割って入ってくる先**
 * （PropertyDef.upperBoundOfStage）。上に段が無ければundefined。
 *
 * **「その段以上」（`in_stage_or_above`、14.1節）は上端を持たない**——上の段へ移っても成立した
 * ままなので押し抜けても外れず、上に在る値は既に成立させているので上から入ることも起こらない。
 */
function stageUpperBoundOf(def: ObjectDef, required: SelfStageRequirement): number | undefined {
  if (required.bound !== 'exact') return undefined;
  return def.tryGetPropertyDef(required.propertyGlobalId)?.upperBoundOfStage(required.stageName);
}

/**
 * 名指された段の下端＝押し割って抜け出る先（PropertyDef.lowerExitOfStage）。下へ抜けようが無ければ
 * undefined。
 */
function stageLowerExitOf(def: ObjectDef, required: SelfStageRequirement): number | undefined {
  return def.tryGetPropertyDef(required.propertyGlobalId)?.lowerExitOfStage(required.stageName);
}

/**
 * ゲートが自分の段を見ているなら、そこへ自分の増減だけで届くまでのtick数（TickGate参照）。
 * 段を見ていない、届くまでが読めない段なら0＝最初のtickから効く。**炉の火力がこれ**——火は段の
 * 下に置かれた増減（8.2節）で育つが、そこはtickAmountsOfが数から外している。
 *
 * **要る段が複数あれば最も遅いものに合わせる**——どれか1つでも跨いでいなければ増減は効かない。
 * ゲートが落ちるのは要るもののどれか1つが外れた時点なので、ticksUntilGateFallsとは向きが逆になる。
 */
function ticksUntilGateRises(def: ObjectDef, gate: TickGate): number {
  let longest = 0;
  for (const { propertyGlobalId, lowerBound } of gate.requiredSelfStages) {
    // 届くまでを**最も長く**見る側（slowest）に合わせて、ロールも段から遠いほうを採る。押し手が
    // 押せる間を最も短く見る側へ揃える。
    const ticks = ticksToReach(
      staticValueOf(def, propertyGlobalId, 'lowest'),
      lowerBound,
      paceTowards(tickAmountsOf(def, propertyGlobalId).possible, 'on_max')?.slowest.amount,
    );
    if (ticks !== undefined && ticks > longest) longest = ticks;
  }
  return longest;
}

/**
 * 押し手が押している値が、そのゲートの要る段へ**押し込まれて**入るまでのtick数（押し手が効き
 * 始めた時点から数える）。次のどれかならundefined＝その段は押し手が開けたものではない。
 *
 * - 押されている値の段を1つも要らない（押し手と関わりなく開いている）
 * - 押しても入れない段が混じっている（向きが逆・段が並びの上に位置を持たない）
 * - 生まれた時点で既にその段に居る（開けたのは押し手ではない）
 *
 * **入り口は押している向きで裏返る**——押し上げるなら段の下端へ届いた時点で入り、押し下げるなら
 * 段の上端を割った時点で入る。「その段以上」（`in_stage_or_above`、14.1節）に上から入ることは
 * 起こらない（上に在る値は既に成立させている）ので、上端を持たないことがそのまま答えになる。
 *
 * **初期値も向きで裏返る**（rollEndAwayFrom）——段から遠いのは、押し上げるなら軽く出たほう、
 * 押し下げるなら重く出たほう。片方に固定すると、下へ押す場合だけ段の近くに生まれた個体を数える
 * ことになり、控えめに見るという約束が向きによって破れる。
 *
 * **押されていない値の段が一緒に要求されていても、待たない**——ticksUntilGateRisesが届くまでの
 * 読めない段を0と見るのと同じ側で、押し手を数え落とさないほうへ倒している。
 */
function ticksUntilDrivenStage(
  def: ObjectDef,
  driver: ExternalTickDelta,
  gate: TickGate,
  pushedToward: RangeEventLabel,
): number | undefined {
  // 入るまでを**最も長く**見る側——速さは最も遅いもの（slowest）、ロールは段から遠いほう。
  // ticksUntilGateRisesが上へ押される場合にしている見立てを、どちらの向きへも当てたもの。
  const value = staticValueOf(def, driver.propertyGlobalId, rollEndAwayFrom(pushedToward));
  const perTick = drivenPaceOf(def, driver, pushedToward)?.slowest.amount;

  let longest: number | undefined;
  for (const required of drivenStagesOf(driver, gate)) {
    const ticks =
      pushedToward === 'on_max'
        ? ticksToReach(value, required.lowerBound, perTick)
        : ticksToFallBelow(value, stageUpperBoundOf(def, required), perTick);
    if (ticks === undefined) return undefined;
    if (longest === undefined || ticks > longest) longest = ticks;
  }
  return longest === 0 ? undefined : longest;
}

/**
 * 押し手が押している値が、そのゲートの要る段を**押し抜けて**しまうまでのtick数（押し手が効き
 * 始めた時点から数える）。抜けないならundefined＝段を抜けることでは止まらない。
 *
 * 出口も入り口と同じく押している向きで裏返り、読み方は自分の増減で抜ける場合
 * （ticksUntilStageLeftUpward・ticksUntilStageLeftDownward）と同じ——違うのは、値を動かすのが
 * 自分の増減ではなく押し手であることだけ。上へ抜けて落ちるのはちょうどその段（`in_stage`）だけで、
 * 下へ割って落ちるのは「その段以上」も同じ。
 */
function ticksUntilDrivenStageLeft(
  def: ObjectDef,
  driver: ExternalTickDelta,
  gate: TickGate,
  pushedToward: RangeEventLabel,
): number | undefined {
  // 速さは抜けるまでを**最も短く**見る側（fastest）で、ロールは入り口（ticksUntilDrivenStage）と
  // 同じもの——窓は同じ1つの個体についての長さなので、効き始めと別の初期値は採れない。
  const value = staticValueOf(def, driver.propertyGlobalId, rollEndAwayFrom(pushedToward));
  const perTick = drivenPaceOf(def, driver, pushedToward)?.fastest.amount;

  let earliest: number | undefined;
  for (const required of drivenStagesOf(driver, gate)) {
    const ticks =
      pushedToward === 'on_max'
        ? ticksToReach(value, stageUpperBoundOf(def, required), perTick)
        : ticksToFallBelow(value, stageLowerExitOf(def, required), perTick);
    if (ticks === undefined) continue;
    if (earliest === undefined || ticks < earliest) earliest = ticks;
  }
  return earliest;
}

/** そのゲートが要求している段のうち、押し手が押している値のもの。 */
function drivenStagesOf(driver: ExternalTickDelta, gate: TickGate): readonly SelfStageRequirement[] {
  return gate.requiredSelfStages.filter((required) => required.propertyGlobalId === driver.propertyGlobalId);
}

/** 押し手に押されている値が、その端へ向かって動く速さの幅（Pace）。 */
function drivenPaceOf(
  def: ObjectDef,
  driver: ExternalTickDelta,
  pushedToward: RangeEventLabel,
): Pace | undefined {
  return paceTowards(totalsWithDriver(tickAmountsOf(def, driver.propertyGlobalId), driver), pushedToward);
}

/**
 * その値がその速さでその位置まで届くまでのtick数。既に届いているなら0。値・位置・速さのどれかが
 * 読めないならundefined。**向きは速さの符号が決める**ので、尽きるまで（位置は0）も段へ届くまで
 * （位置は段の下端）も同じ1つで数えられる。
 *
 * **幅のどちら側を渡すかは、呼ぶ側が決める。** 押し手を控えめに数えるには、効き始めまでは遅いほう、
 * 効かなくなるまでは速いほうで、同じ問いでも向きが逆になる。
 */
function ticksToReach(
  value: number | undefined,
  target: number | undefined,
  perTick: number | undefined,
): number | undefined {
  if (value === undefined || target === undefined || perTick === undefined) return undefined;
  return Math.max(0, Math.ceil((target - value) / perTick));
}

/**
 * その値がその速さで、その位置を**割って下へ抜ける**までのtick数。**その位置ちょうどに着いた時点
 * では、まだ割っていない**（段は下端を含む半開区間、6.4節）ので、位置まで測る{@link ticksToReach}
 * より1 tick遅くなることがある。
 *
 * 既に位置より下に在るならundefined——**割るのはこれからではなく、もう割った後**。値・位置・速さの
 * どれかが読めないときも同じ。
 *
 * **速さは下向き**（負）でなければならない。割る向きへ動く場合を選ぶのは呼ぶ側の仕事で、どちらの
 * 端へ向かう場合かはpaceTowardsが分けてある。
 */
function ticksToFallBelow(
  value: number | undefined,
  bound: number | undefined,
  perTick: number | undefined,
): number | undefined {
  if (value === undefined || bound === undefined || perTick === undefined) return undefined;
  if (value < bound) return undefined;
  return Math.floor((bound - value) / perTick) + 1;
}
