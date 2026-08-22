import type { ObjectDef } from '../domain/ObjectDef';
import type { TickGate } from './tickDeltas';
import { tickDeltasOf } from './tickDeltas';
import type { CraftingStep } from './CraftingStep';
import { collectOutputs } from './CraftingStep';
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
 * **tick毎に動く値がrangeの端へ届くまでの周期**と、そこで起こること（RangeCycle参照）。
 * 端で値が戻るものは繰り返す仕掛け（罠の判定、TrapSystem.md 2節）、端で自分が消えるものは
 * 寿命（罠の朽ち、DurabilitySystem.md 2節）。
 *
 * 段で切り替わる増減（8.2節）は数えない——段ごとに周期が変わるものは、1つの周期で言い表せない。
 *
 * externalは、隣の物が与えるtick毎の増減（ExternalTickDelta参照）。同じプロパティを動かすものが
 * 複数あれば、**与え手ごとに別の周期**を返す——炉で焼くのと傷で失血するのは、要る物も速さも違う。
 */
export function rangeCyclesOf(
  def: ObjectDef,
  outer?: StaticValueResolver,
  external: readonly ExternalTickDelta[] = [],
): readonly RangeCycle[] {
  const cycles: RangeCycle[] = [];
  for (const propertyDef of def.enumeratePropertyDefs()) {
    const own = tickAmountsOf(def, propertyDef.globalId);
    const value = staticValueOf(def, propertyDef.globalId, outer);
    const drivers: readonly (ExternalTickDelta | undefined)[] = [
      undefined,
      ...external.filter((delta) => delta.propertyGlobalId === propertyDef.globalId),
    ];

    for (const driver of drivers) {
      const slowest = own.slowest + (driver?.slowest ?? 0);
      const fastest = own.fastest + (driver?.fastest ?? 0);
      const ticks = ticksToRangeEnd(propertyDef, slowest, value);
      const shortestTicks = ticksToRangeEnd(propertyDef, fastest, value);
      if (ticks === undefined || shortestTicks === undefined) continue;

      // 外からの増減が止まる前に端へ届かないなら、その仕掛けは成立しない——小さな獲物は罠の傷でも
      // 失血で死ぬが、血の多い獲物は傷が固まるほうが先になる。
      if (driver?.maxTotal !== undefined && ticks * Math.abs(driver.slowest) > driver.maxTotal) continue;

      // 印はこの読み出し1回ぶんに閉じる（craftingStepsが操作1つに閉じているのと同じ）。関数全体で
      // 1つにすると、先に積んだ周期には付かず後の周期だけに付く——プロパティの宣言順で答えが変わる。
      const tracking = trackingResolverOf(def, outer);
      for (const readout of rangeEventReadouts(propertyDef, tracking.resolve)) {
        if (readout.label === (slowest < 0 ? 'on_max' : 'on_min')) continue;

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
            hasUnresolvedReferences: tracking.unresolved,
          },
        });
      }
    }
  }
  return cycles;
}

/**
 * その型が、隣の物のtick毎の値を動かす分（ExternalTickDelta参照）。rootは相手から見た自分の位置——
 * 親が子を焼くなら`child`、刺さった傷が持ち主の血を奪うなら`parent`。
 *
 * **誰の隣に立てるかは答えない**（枠の受け入れを見る側の仕事）。答えるのは、隣に立てたとして
 * どれだけ速く、いつまで動かせるか。
 */
export function externalTickDeltasOf(def: ObjectDef, root: 'parent' | 'child'): readonly ExternalTickDelta[] {
  const byProperty = new Map<number, ExternalTickDelta>();
  for (const delta of tickDeltasOf(def)) {
    if (delta.target !== root || delta.amount === 0) continue;

    const ticks = ticksWhileGateHolds(def, delta.gate);
    const limit = ticks === undefined ? undefined : ticks * Math.abs(delta.amount);
    const known = byProperty.get(delta.propertyGlobalId);
    byProperty.set(delta.propertyGlobalId, {
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
 * そのプロパティが、自分のtick毎の持続効果でどれだけ動くか（段で切り替わるものは除く）。
 *
 * **条件つきの増減（8.2節）は、同時に成立するとは限らない。** どれが重なるかは定義からは決まらない
 * ので、最も遅い場合（条件つきのうち最小の1つだけが効く）と最も速い場合（全部が重なる）の両方を返す。
 * 罠の耐久がこれで、地面にある間の-1と獲物を抱えている間の-10は足しっぱなしにすると寿命が1/11になる。
 */
function tickAmountsOf(def: ObjectDef, propertyGlobalId: number): { slowest: number; fastest: number } {
  let unconditional = 0;
  const conditional: number[] = [];
  for (const delta of tickDeltasOf(def)) {
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
 * ゲートが自分の値を見ているなら、その値が尽きて条件が落ちるまでのtick数（TickGate参照）。
 * 見ていない、または尽きない値なら undefined＝止まらない。
 */
function ticksWhileGateHolds(def: ObjectDef, gate: TickGate): number | undefined {
  let fewest: number | undefined;
  for (const propertyGlobalId of gate.watchedSelfProperties) {
    const value = staticValueOf(def, propertyGlobalId);
    const { fastest } = tickAmountsOf(def, propertyGlobalId);
    if (value === undefined || fastest >= 0) continue;

    const ticks = Math.ceil(value / -fastest);
    if (fewest === undefined || ticks < fewest) fewest = ticks;
  }
  return fewest;
}
