import type { CraftingStep } from '../domain/defs/CraftingStep';
import type { ObjectDef, RangeCycle } from '../domain/defs/ObjectDef';
import type { TickDelta } from '../domain/defs/PassiveEffect';
import type { StaticValueResolver } from '../domain/defs/ReferenceRoot';
import type { WorldCodex } from '../domain/defs/WorldCodex';

/**
 * 定義（`src/assets/world-codex/*.yaml`）だけから「時間あたりの収支」を計算する。
 *
 * 消費（passivesのtick毎の増減）も供給（工程の所要時間と産出）も、突き詰めれば「プロパティ量 ÷ 分」
 * という1つの物差しに乗る——tick毎の増減は「15分かかって値が動く工程」と同じ形なので、消費と供給は
 * 符号の違いでしかなく、連鎖はその足し算になる。
 *
 * ここが返すのは数値と識別子だけで、見せ方は持たない。ビューアのページ（balancePage）とMarkdownの
 * スナップショット（tests/diagnostics/balanceStatsReport.test.ts）が同じ結果を別の形に描く。
 */

export const TICKS_PER_DAY = 96;
export const MINUTES_PER_TICK = 15;
export const MINUTES_PER_DAY = TICKS_PER_DAY * MINUTES_PER_TICK;

/**
 * 資源は土地ごとに分かれているので、1つの土地に閉じると多くの連鎖が「前提が揃わない」で終わる。
 * 島を渡り歩ける前提の見方も要るため、全土地の探索を使える文脈を先頭に1つ置く。
 */
export const WHOLE_ISLAND = '島全体';

/** 浮動小数の比較で「改善した」と見なさない差（分）。 */
const EPSILON = 1e-9;

/** 素材から摂取までの時間（分）。探索に費やす分と、加工に費やす分を分けて持つ。 */
export interface Cost {
  readonly exploreMinutes: number;
  readonly craftMinutes: number;
}

/** 消費表の1行。キャラクタごとのtick毎の増減で、並びはcharacterNamesと同じ。 */
export interface ConsumptionRow {
  readonly propertyName: string;

  /** その増減が効く条件（常時・段・条件つき・輸送）。 */
  readonly condition: string;

  readonly perTickByCharacter: readonly (number | undefined)[];
}

/** 供給表の1行（工程1つ）。 */
export interface SupplyRow {
  readonly ownerName: string;
  readonly stepName: string;
  readonly kind: CraftingStep['kind'];
  readonly laborMinutes: number;
  readonly elapsedMinutes: number;

  /** 所要時間か分岐の重みが、定義だけでは決まらない工程か。 */
  readonly unresolved: boolean;

  readonly spawns: readonly NamedAmount[];
  readonly actorDeltas: readonly NamedAmount[];
  readonly selfDeltas: readonly NamedAmount[];
}

export interface NamedAmount {
  readonly name: string;
  readonly amount: number;
}

/** 連鎖表の1経路。stepsは上流から下流の順（探索 → 加工 → 摂取）。 */
export interface ChainRoute {
  readonly steps: readonly RouteStep[];

  /** プロパティ1単位を得るのにプレイヤーが払う時間（分）と、その内訳。 */
  readonly perUnitMinutes: number;
  readonly exploreMinutes: number;
  readonly craftMinutes: number;

  /** 待ち生産を含む経路で、1日ぶんを賄うのに同時に要る設備の数。含まないならundefined。 */
  readonly deviceCount: number | undefined;

  /** 同じ工程が同時に返す他の値（時間を按分していないので、行を縦に足すと二重計上になる）。 */
  readonly coProducts: readonly NamedAmount[];

  readonly prerequisites: readonly RoutePrerequisite[];

  /** 前提の道具に入手経路が無い経路か。表の末尾へ回す。 */
  readonly blocked: boolean;

  /** 素材を所要時間0分の工程で得ている経路か（この表が時間を数えられていない）。 */
  readonly untimed: boolean;
}

export interface RouteStep {
  readonly objectName: string;
  readonly stepName: string;
}

export interface RoutePrerequisite {
  /** 表示する名前。タグ指定の入力は「タグ → 実際に使う型」の形。 */
  readonly label: string;

  /** 実際に使う型。入手経路が無ければundefined。 */
  readonly objectName: string | undefined;

  /** その道具を1つ手に入れるまでの時間（分）。入手経路が無ければundefined。 */
  readonly minutes: number | undefined;
}

/** 連鎖表の、プロパティ1つぶん。 */
export interface PropertyChains {
  readonly propertyName: string;

  /** 1日に減る量（消費表の常時効く減りから）。 */
  readonly dailyNeed: number;

  /** 総時間の昇順。前提が揃わない経路は末尾。 */
  readonly routes: readonly ChainRoute[];
}

/** 待ち生産表の1行（設備1つが返す産物1種）。 */
export interface DeviceRow {
  readonly deviceName: string;
  readonly stepName: string;
  readonly periodMinutes: number;
  readonly productName: string;

  /** 1周期あたりの期待個数と、そこから出る1日あたりの個数。 */
  readonly perCycle: number;
  readonly perDay: number;

  /** 設備が朽ちるまでの日数と、その間に返す総数。朽ちないならundefined。 */
  readonly lifetimeDays: number | undefined;
  readonly overLifetime: number | undefined;

  /** 設備1つを作るのに要る時間（分）と、産物1個あたりへ按分した時間。 */
  readonly buildMinutes: number | undefined;
  readonly laborPerUnit: number | undefined;
}

/** 1つの文脈（島全体、または土地1つ）ぶんの結果。 */
export interface PlaceBalance {
  readonly name: string;
  readonly properties: readonly PropertyChains[];
  readonly devices: readonly DeviceRow[];
}

export interface BalanceTables {
  readonly characterNames: readonly string[];
  readonly consumption: readonly ConsumptionRow[];
  readonly supply: readonly SupplyRow[];
  readonly places: readonly PlaceBalance[];
}

/** 収支表を丸ごと組み立てる。sampleCharacterは1日の必要量を取る代表キャラクタ。 */
export function buildBalanceTables(codex: WorldCodex, sampleCharacter: string): BalanceTables {
  const characterNames = codex.objectDefNamesWithTag('character');
  const character = codex.objects.get(codex.objectNames.getId(sampleCharacter));
  const needs = dailyNeeds(character);

  const places = placeBalances(codex, needs);
  return {
    characterNames,
    consumption: consumptionRows(codex, characterNames),
    // 供給表は島全体の文脈で出す。罠の重みは土地が入れるので、土地を決めないと候補が全部0になる。
    supply: supplyRows(codex, allSteps(codex, bestAncestorContext(locationsOf(codex)))),
    places,
  };
}

/** 1日にそのプロパティが減る量（常時効く増減だけ）。減らないプロパティは含まない。 */
function dailyNeeds(character: ObjectDef): ReadonlyMap<number, number> {
  const needs = new Map<number, number>();
  for (const delta of character.passives.tickDeltas()) {
    if (delta.target !== 'self' || delta.capped) continue;
    if (delta.gate.stage !== undefined || delta.gate.conditional) continue;
    if (delta.amount >= 0) continue;
    needs.set(
      delta.propertyGlobalId,
      (needs.get(delta.propertyGlobalId) ?? 0) + -delta.amount * TICKS_PER_DAY,
    );
  }
  return needs;
}

function consumptionRows(codex: WorldCodex, characterNames: readonly string[]): readonly ConsumptionRow[] {
  const byCharacter = characterNames.map((name) =>
    tickDeltasOf(codex, codex.objects.get(codex.objectNames.getId(name))),
  );

  const keys: string[] = [];
  for (const deltas of byCharacter) for (const key of deltas.keys()) if (!keys.includes(key)) keys.push(key);

  return keys.map((key) => {
    const [propertyName, condition] = splitKey(key);
    return {
      propertyName,
      condition,
      perTickByCharacter: byCharacter.map((deltas) => deltas.get(key)),
    };
  });
}

/** 消費表の行を「プロパティ」と「条件」の対で引くための区切り。識別子にも段の名前にも現れない。 */
const KEY_SEPARATOR = ' :: ';

function splitKey(key: string): readonly [string, string] {
  const index = key.indexOf(KEY_SEPARATOR);
  return [key.slice(0, index), key.slice(index + KEY_SEPARATOR.length)];
}

/** キャラクタ1人が、自分のプロパティをtick毎にどれだけ動かすか。 */
function tickDeltasOf(codex: WorldCodex, def: ObjectDef): ReadonlyMap<string, number> {
  const byKey = new Map<string, number>();
  for (const delta of def.passives.tickDeltas()) {
    if (delta.target !== 'self') continue;
    const key = `${codex.propertyName(delta.propertyGlobalId)}${KEY_SEPARATOR}${conditionLabel(codex, delta)}`;
    byKey.set(key, (byKey.get(key) ?? 0) + delta.amount);
  }
  return byKey;
}

/** そのゲート（8.2節）と輸送かどうかを1語で言い表す。 */
function conditionLabel(codex: WorldCodex, delta: TickDelta): string {
  const capped = delta.capped ? '（輸送・在庫がある間）' : '';
  if (delta.gate.stage !== undefined)
    return `段 ${codex.propertyName(delta.gate.stage.propertyGlobalId)}=${delta.gate.stage.name}${capped}`;
  return `${delta.gate.conditional ? '条件つき' : '常時'}${capped}`;
}

function supplyRows(codex: WorldCodex, steps: readonly StepRef[]): readonly SupplyRow[] {
  const rows: SupplyRow[] = [];
  for (const ref of steps) {
    const spawns = expectedSpawns(ref.step);
    const actorDeltas = expectedDeltas(ref.step, 'actor');
    const selfDeltas = expectedDeltas(ref.step, 'self');
    if (spawns.size === 0 && actorDeltas.size === 0 && selfDeltas.size === 0) continue;

    rows.push({
      ownerName: ref.def.name,
      stepName: ref.step.name,
      kind: ref.step.kind,
      laborMinutes: ref.step.laborMinutes,
      elapsedMinutes: ref.step.elapsedMinutes,
      unresolved: ref.step.hasUnresolvedReferences,
      spawns: [...spawns].map(([globalId, amount]) => ({ name: codex.objectName(globalId), amount })),
      actorDeltas: [...actorDeltas].map(([globalId, amount]) => ({
        name: codex.propertyName(globalId),
        amount,
      })),
      selfDeltas: [...selfDeltas].map(([globalId, amount]) => ({
        name: codex.propertyName(globalId),
        amount,
      })),
    });
  }
  return rows;
}

function placeBalances(codex: WorldCodex, needs: ReadonlyMap<number, number>): readonly PlaceBalance[] {
  const locations = locationsOf(codex);

  return [undefined, ...locations].map((location) => {
    // 罠が掛ける動物の重みは土地が宣言する（inherit）ので、土地を決めてから工程を組み立てる。
    const context = location === undefined ? bestAncestorContext(locations) : ancestorContext(location);
    const steps =
      location === undefined ? allSteps(codex, context) : stepsAt(codex, allSteps(codex, context), location);
    const acquisition = new Acquisition(codex, steps);

    return {
      name: location?.name ?? WHOLE_ISLAND,
      properties: propertyChains(codex, acquisition, steps, needs),
      devices: deviceRows(codex, acquisition, steps),
    };
  });
}

/**
 * 必要量のあるプロパティごとに、それを返す工程を総時間の昇順で並べる。**最良経路だけには絞らない**
 * ——順位が入れ替わったときに差分が「1行まるごと差し替え」になり、何が起きたか読めなくなるため。
 */
function propertyChains(
  codex: WorldCodex,
  acquisition: Acquisition,
  steps: readonly StepRef[],
  needs: ReadonlyMap<number, number>,
): readonly PropertyChains[] {
  const byProperty = new Map<number, ChainRoute[]>();

  for (const ref of steps) {
    const cost = acquisition.stepCost(ref);
    if (cost === undefined) continue;

    const deltas = expectedDeltas(ref.step, 'actor');
    for (const [propertyGlobalId, gain] of deltas) {
      const need = needs.get(propertyGlobalId);
      if (gain <= 0 || need === undefined) continue;

      const route = [ref, ...acquisition.routeOf(ref.def.globalId)];
      const routes = byProperty.get(propertyGlobalId) ?? [];
      routes.push(buildRoute(codex, acquisition, route, cost, gain, deltas, propertyGlobalId, need));
      byProperty.set(propertyGlobalId, routes);
    }
  }

  // 前提が揃わない経路は末尾へ。数字は出すが、この文脈では辿れない。
  for (const routes of byProperty.values())
    routes.sort((a, b) => Number(a.blocked) - Number(b.blocked) || a.perUnitMinutes - b.perUnitMinutes);

  return [...byProperty]
    .sort(([a], [b]) => a - b)
    .map(([propertyGlobalId, routes]) => ({
      propertyName: codex.propertyName(propertyGlobalId),
      dailyNeed: needs.get(propertyGlobalId)!,
      routes,
    }));
}

function buildRoute(
  codex: WorldCodex,
  acquisition: Acquisition,
  route: readonly StepRef[],
  cost: Cost,
  gain: number,
  deltas: ReadonlyMap<number, number>,
  propertyGlobalId: number,
  dailyNeed: number,
): ChainRoute {
  // 経路の中で作る物は前提に数えない（自分で用意する手順が既に経路として出ているため）。
  const madeInRoute = new Set(route.flatMap((ref) => [...expectedSpawns(ref.step).keys()]));

  const prerequisites = new Map<string, RoutePrerequisite>();
  for (const ref of route)
    for (const prerequisite of acquisition.prerequisites(ref)) {
      if (prerequisite.objectGlobalId !== undefined && madeInRoute.has(prerequisite.objectGlobalId)) continue;
      prerequisites.set(prerequisite.label, {
        label: prerequisite.label,
        objectName:
          prerequisite.objectGlobalId === undefined
            ? undefined
            : codex.objectName(prerequisite.objectGlobalId),
        minutes: prerequisite.cost === undefined ? undefined : totalOf(prerequisite.cost),
      });
    }

  const perUnitMinutes = totalOf(cost) / gain;
  return {
    steps: [...route].reverse().map((ref) => ({ objectName: ref.def.name, stepName: ref.step.name })),
    perUnitMinutes,
    exploreMinutes: cost.exploreMinutes / gain,
    craftMinutes: cost.craftMinutes / gain,
    deviceCount: deviceCountFor(acquisition, route, perUnitMinutes * dailyNeed),
    coProducts: [...deltas]
      .filter(([otherId]) => otherId !== propertyGlobalId)
      .map(([otherId, amount]) => ({ name: codex.propertyName(otherId), amount })),
    prerequisites: [...prerequisites.values()],
    blocked: [...prerequisites.values()].some(({ minutes }) => minutes === undefined),
    // 摂取そのもの（経路の末尾）が0分なのは仕様。素材を0分で得ている場合だけが数え落とし。
    untimed: route.slice(1).some((ref) => ref.cycle === undefined && ref.step.laborMinutes === 0),
  };
}

/**
 * 1日ぶんの労働を賄うのに同時に要る設備の数。経路に待ち生産が無ければundefined。
 *
 * 設備1つが1日に生む価値は「その設備を寿命の間ずっと作り直し続ける労働」＝製作労働÷寿命の日数に
 * 等しい（連鎖表の単位あたりの労働がこの按分で出ているため）。1日ぶんの労働をそれで割れば個数が出る。
 */
function deviceCountFor(
  acquisition: Acquisition,
  route: readonly StepRef[],
  dailyMinutes: number,
): number | undefined {
  let maintenancePerDay = 0;
  for (const ref of route) {
    if (ref.cycle?.lifetimeMinutes === undefined) continue;
    const deviceCost = acquisition.costByObject.get(ref.def.globalId);
    if (deviceCost === undefined) continue;
    maintenancePerDay += totalOf(deviceCost) / (ref.cycle.lifetimeMinutes / MINUTES_PER_DAY);
  }
  return maintenancePerDay === 0 ? undefined : dailyMinutes / maintenancePerDay;
}

function deviceRows(
  codex: WorldCodex,
  acquisition: Acquisition,
  steps: readonly StepRef[],
): readonly DeviceRow[] {
  const rows: DeviceRow[] = [];
  for (const ref of steps) {
    if (ref.cycle === undefined || ref.step.outputs.length === 0) continue;

    const { periodMinutes, lifetimeMinutes } = ref.cycle;
    const deviceCost = acquisition.costByObject.get(ref.def.globalId);
    const lifetimeDays = lifetimeMinutes === undefined ? undefined : lifetimeMinutes / MINUTES_PER_DAY;
    const cyclesPerDay = MINUTES_PER_DAY / periodMinutes;

    for (const [objectGlobalId, perCycle] of expectedSpawns(ref.step)) {
      // 単独で存在できない型（怪我、7.9節）は産物ではない——獲物に刺さる傷は資源に数えない。
      if (perCycle <= 0 || codex.objects.get(objectGlobalId).boundToOwner) continue;

      const overLifetime = lifetimeDays === undefined ? undefined : perCycle * cyclesPerDay * lifetimeDays;
      rows.push({
        deviceName: ref.def.name,
        stepName: ref.step.name,
        periodMinutes,
        productName: codex.objectName(objectGlobalId),
        perCycle,
        perDay: perCycle * cyclesPerDay,
        lifetimeDays,
        overLifetime,
        buildMinutes: deviceCost === undefined ? undefined : totalOf(deviceCost),
        laborPerUnit:
          deviceCost === undefined || overLifetime === undefined
            ? undefined
            : totalOf(deviceCost) / overLifetime,
      });
    }
  }
  return rows;
}

/** 1回の実行で、その型が生まれる期待個数（分岐の確率で重み付けした和）。 */
function expectedSpawns(step: CraftingStep): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  for (const outcome of step.outcomes)
    for (const spawn of outcome.spawns)
      counts.set(
        spawn.objectGlobalId,
        (counts.get(spawn.objectGlobalId) ?? 0) + outcome.probability * spawn.count,
      );
  return counts;
}

/** 1回の実行で、対象のプロパティが動く期待量（分岐の確率で重み付けした和）。 */
function expectedDeltas(step: CraftingStep, target: 'actor' | 'self'): ReadonlyMap<number, number> {
  const amounts = new Map<number, number>();
  for (const outcome of step.outcomes)
    for (const delta of outcome.deltas) {
      if (delta.target !== target) continue;
      amounts.set(
        delta.propertyGlobalId,
        (amounts.get(delta.propertyGlobalId) ?? 0) + outcome.probability * delta.amount,
      );
    }
  return amounts;
}

/** 工程1つと、それを宣言している型。 */
interface StepRef {
  readonly def: ObjectDef;
  readonly step: CraftingStep;

  /**
   * 時間で回る工程（罠の判定）なら、その周期と、宣言元の寿命。**プレイヤーは待ち時間を払わないが、
   * 設備は待っている間も朽ちる**ので、1周期で使い切る設備の割合（周期÷寿命）が値段になる。
   * 寿命を持たない設備では按分できないためundefined。
   */
  readonly cycle: DeviceCycle | undefined;
}

interface DeviceCycle {
  readonly periodMinutes: number;
  readonly lifetimeMinutes: number | undefined;
}

/** 工程を実行するのに要る、消費されない入力1件。costがundefinedなら、この文脈では前提が揃わない。 */
interface Prerequisite {
  readonly label: string;
  readonly objectGlobalId: number | undefined;
  readonly cost: Cost | undefined;
}

function totalOf(cost: Cost): number {
  return cost.exploreMinutes + cost.craftMinutes;
}

function addCost(a: Cost, b: Cost): Cost {
  return {
    exploreMinutes: a.exploreMinutes + b.exploreMinutes,
    craftMinutes: a.craftMinutes + b.craftMinutes,
  };
}

function divideCost(cost: Cost, divisor: number): Cost {
  return { exploreMinutes: cost.exploreMinutes / divisor, craftMinutes: cost.craftMinutes / divisor };
}

function scaleCost(cost: Cost, factor: number): Cost {
  return { exploreMinutes: cost.exploreMinutes * factor, craftMinutes: cost.craftMinutes * factor };
}

/**
 * 立って作業できる土地か。**製作中オブジェクトは除く**——完成品のタグを引き継ぐ（RecipeSystem.md
 * 5節）ので、作りかけの筏まで土地として並んでしまう。
 */
function isLocation(codex: WorldCodex, def: ObjectDef): boolean {
  const locationTag = codex.tagNames.tryGetId('location');
  if (locationTag === undefined || !def.tags.includes(locationTag)) return false;
  return codex.productOf(def) === undefined;
}

function allDefs(codex: WorldCodex): readonly ObjectDef[] {
  const defs: ObjectDef[] = [];
  for (let globalId = 0; globalId < codex.objects.count; globalId++) defs.push(codex.objects.get(globalId));
  return defs;
}

function locationsOf(codex: WorldCodex): readonly ObjectDef[] {
  return allDefs(codex).filter((def) => isLocation(codex, def));
}

/**
 * 全型の全工程。宣言順（型のグローバルID順、型の中は宣言順）。プレイヤーが起こす工程に続けて、
 * 時間で回る工程（罠の判定）も並べる。
 *
 * outerは、祖先（＝置かれている土地）が入れる値を解く手立て。罠が掛ける動物の重みは土地が
 * 宣言するので（`inherit`）、これが無いと候補が全部0になる。
 */
function allSteps(codex: WorldCodex, outer?: StaticValueResolver): readonly StepRef[] {
  return allDefs(codex).flatMap((def) => {
    const cycles = def.rangeCycles(outer);
    const lifetimeMinutes = lifetimeOf(cycles);
    return [
      ...def.craftingSteps(outer).map((step) => ({ def, step, cycle: undefined })),
      ...cycles
        .filter((cycle) => cycle.repeats)
        .map((cycle) => ({
          def,
          step: cycle.step,
          cycle: { periodMinutes: cycle.minutes, lifetimeMinutes },
        })),
    ];
  });
}

/** その型が朽ちるまでの時間（分）。複数あれば最も早く尽きるもの。朽ちないならundefined。 */
function lifetimeOf(cycles: readonly RangeCycle[]): number | undefined {
  const ends = cycles.filter((cycle) => cycle.destroysSelf && !cycle.repeats).map((cycle) => cycle.minutes);
  return ends.length === 0 ? undefined : Math.min(...ends);
}

/** 祖先（置かれている土地）の宣言値を答える手立て。宣言していないプロパティは寄与0。 */
function ancestorContext(location: ObjectDef): StaticValueResolver {
  return (root, propertyGlobalId) =>
    root === 'ancestor' ? (location.staticValueOf(propertyGlobalId) ?? 0) : undefined;
}

/** どの土地に置いてもよい前提での祖先の値。最も高く宣言している土地に置いたものとして扱う。 */
function bestAncestorContext(locations: readonly ObjectDef[]): StaticValueResolver {
  return (root, propertyGlobalId) => {
    if (root !== 'ancestor') return undefined;
    const declared = locations
      .map((location) => location.staticValueOf(propertyGlobalId))
      .filter((value): value is number => value !== undefined);
    return declared.length === 0 ? 0 : Math.max(...declared);
  };
}

/** その土地に立っているときに実行できる工程（他の土地が宣言する工程は届かない）。 */
function stepsAt(codex: WorldCodex, steps: readonly StepRef[], location: ObjectDef): readonly StepRef[] {
  return steps.filter((ref) => !isLocation(codex, ref.def) || ref.def.globalId === location.globalId);
}

/**
 * 1つの文脈（土地1つ、または島全体）で、各型を1個手に入れるのに要する時間を求める。
 *
 * 全工程を何度も走査して、入力の値段が下がったら出力の値段も下げる、を変化が止まるまで繰り返す
 * （再帰で辿ると、素材どうしが循環している定義で止まらなくなる）。道具（消費されない入力）の
 * 入手時間は含めない——繰り返し使えるものを1個あたりへ按分するには「何回使うか」の仮定が要る。
 */
class Acquisition {
  readonly costByObject = new Map<number, Cost>();

  /** その型を最も安く生む工程。連鎖を遡って前提の道具を集めるのに使う。 */
  private readonly viaStep = new Map<number, StepRef>();

  private readonly steps: readonly StepRef[];
  private readonly codex: WorldCodex;

  constructor(codex: WorldCodex, steps: readonly StepRef[]) {
    this.codex = codex;
    this.steps = steps;
    this.relax();
  }

  /**
   * この工程を1回実行するのに**プレイヤーが払う**時間（労働時間＋消費する入力の入手時間）。
   * 揃わなければundefined。待ち時間は含めない——待っている間に他のことができるため。
   */
  stepCost(ref: StepRef): Cost | undefined {
    const owned = isLocation(this.codex, ref.def);
    let cost: Cost = {
      exploreMinutes: owned ? ref.step.laborMinutes : 0,
      craftMinutes: owned ? 0 : ref.step.laborMinutes,
    };

    // 時間で回る工程は、1周期ぶんだけ設備を使い切る。朽ちない設備は按分できない（待てば無限に得られる）。
    if (ref.cycle !== undefined) {
      if (ref.cycle.lifetimeMinutes === undefined) return undefined;
      const device = this.costByObject.get(ref.def.globalId);
      if (device === undefined) return undefined;
      cost = addCost(cost, scaleCost(device, ref.cycle.periodMinutes / ref.cycle.lifetimeMinutes));
    }

    for (const input of ref.step.inputs) {
      if (!input.consumed) continue;
      const inputCost = this.inputCost(input);
      if (inputCost === undefined) return undefined;
      cost = addCost(cost, inputCost);
    }
    return cost;
  }

  /**
   * この工程を実行するのに要る、消費されない入力（道具・採取ポイント）。土地そのものは除く——
   * どこかの土地には必ず立っているため。
   */
  prerequisites(ref: StepRef): readonly Prerequisite[] {
    const found: Prerequisite[] = [];
    for (const input of ref.step.inputs) {
      if (input.consumed) continue;
      if (input.kind === 'object' && isLocation(this.codex, this.codex.objects.get(input.objectGlobalId)))
        continue;

      // タグ指定の入力は、そのタグを名乗ったうえで実際に使う型を添える（cutting_tool → sharp_stone）。
      const declared =
        input.kind === 'tag'
          ? this.codex.tagName(input.tagGlobalId)
          : this.codex.objectName(input.objectGlobalId);

      const objectGlobalId = this.cheapestCandidate(input);
      if (objectGlobalId === undefined) {
        found.push({ label: declared, objectGlobalId: undefined, cost: undefined });
        continue;
      }

      const chosen = this.codex.objectName(objectGlobalId);
      found.push({
        label: chosen === declared ? chosen : `${declared} → ${chosen}`,
        objectGlobalId,
        cost: this.costByObject.get(objectGlobalId),
      });
    }
    return found;
  }

  /** その型を手に入れるまでの連鎖に現れる工程を、最も安い経路だけ遡って挙げる。 */
  routeOf(objectGlobalId: number, seen = new Set<number>()): readonly StepRef[] {
    if (seen.has(objectGlobalId)) return [];
    seen.add(objectGlobalId);

    const ref = this.viaStep.get(objectGlobalId);
    if (ref === undefined) return [];

    const route: StepRef[] = [ref];
    for (const input of ref.step.inputs) {
      if (!input.consumed) continue;
      const candidate = this.cheapestCandidate(input);
      if (candidate !== undefined) route.push(...this.routeOf(candidate, seen));
    }
    return route;
  }

  /** 入力1件を満たすのに最も安い型。この文脈でどれも手に入らなければundefined。 */
  private cheapestCandidate(input: CraftingStep['inputs'][number]): number | undefined {
    let best: number | undefined;
    let bestCost: Cost | undefined;
    for (const objectGlobalId of this.candidatesOf(input)) {
      const cost = this.costByObject.get(objectGlobalId);
      if (cost === undefined) continue;
      if (bestCost === undefined || totalOf(cost) < totalOf(bestCost)) {
        best = objectGlobalId;
        bestCost = cost;
      }
    }
    return best;
  }

  /** 入力1件を満たすのに最も安い値段。この文脈でどれも手に入らなければundefined。 */
  private inputCost(input: CraftingStep['inputs'][number]): Cost | undefined {
    const objectGlobalId = this.cheapestCandidate(input);
    return objectGlobalId === undefined ? undefined : this.costByObject.get(objectGlobalId);
  }

  /** 入力1件を満たしうる型のグローバルID（タグ指定なら、そのタグを持つ型すべて）。 */
  private candidatesOf(input: CraftingStep['inputs'][number]): readonly number[] {
    if (input.kind === 'object') return [input.objectGlobalId];

    const found: number[] = [];
    for (let globalId = 0; globalId < this.codex.objects.count; globalId++)
      if (this.codex.objects.get(globalId).tags.includes(input.tagGlobalId)) found.push(globalId);
    return found;
  }

  private relax(): void {
    for (let pass = 0; pass <= this.codex.objects.count; pass++) {
      let improved = false;
      for (const ref of this.steps) {
        const cost = this.stepCost(ref);
        if (cost === undefined) continue;

        for (const [objectGlobalId, count] of expectedSpawns(ref.step)) {
          if (count <= 0) continue;
          const candidate = divideCost(cost, count);
          const known = this.costByObject.get(objectGlobalId);
          if (known !== undefined && totalOf(known) <= totalOf(candidate) + EPSILON) continue;

          this.costByObject.set(objectGlobalId, candidate);
          this.viaStep.set(objectGlobalId, ref);
          improved = true;
        }
      }
      if (!improved) return;
    }
  }
}
