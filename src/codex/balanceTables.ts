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

  /** 1回実行するのにプレイヤーが払う時間（分）と、その内訳。 */
  readonly executionMinutes: number;
  readonly exploreMinutes: number;
  readonly craftMinutes: number;

  /** 1回の実行で埋まる需要（キーは需要のプロパティ）。体脂肪は三大栄養素の増分がまとまって効く。 */
  readonly fills: ReadonlyMap<number, number>;

  /** 1回の実行で動く値すべて。時間を按分していないので、これらを縦に足すと二重計上になる。 */
  readonly deltas: readonly NamedAmount[];

  /** 待ち生産を含む経路なら、設備1つを保つのに要る1日あたりの労働（分）。含まないならundefined。 */
  readonly deviceCount: number | undefined;

  readonly prerequisites: readonly RoutePrerequisite[];

  /** 前提の道具に入手経路が無い経路か。 */
  readonly blocked: boolean;

  /**
   * この土地では作れない道具を持ち込む必要がある経路か。**漂着直後に自力で回るか**を見るための印で、
   * 時間の扱いは変わらない（道具は1度だけ払う費用として、単位あたりへ按分しない）。
   */
  readonly needsImport: boolean;

  /** 労働0で値が返る経路か（雨で溜まる水など、この表が時間を数えられていない）。 */
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

  /** この土地では作れず、他の土地から持ち込むことになる道具か。 */
  readonly imported: boolean;
}

/** 連鎖表の、プロパティ1つぶん。 */
export interface PropertyChains {
  readonly propertyGlobalId: number;
  readonly propertyName: string;

  /** 1日に減る量。 */
  readonly dailyNeed: number;

  /** 尽きると死ぬ値か（VitalsSystem.md）。 */
  readonly lethal: boolean;

  /** その値を埋める別のプロパティ（体脂肪なら三大栄養素）。自分自身で埋まるなら空。 */
  readonly suppliedByNames: readonly string[];

  /** 単位あたりの労働の昇順。数えられない経路と前提が揃わない経路は末尾。 */
  readonly routes: readonly PropertyRoute[];
}

/**
 * ある需要から見た経路1つ。**割り算はここで済ませる**——同じ数字を描き手ごとに計算し直すと、
 * ずれたときにどちらが正か分からなくなる。
 */
export interface PropertyRoute {
  readonly route: ChainRoute;

  /** 1回の実行でこの需要が埋まる量。 */
  readonly gain: number;

  /** この需要を1単位埋めるのに要る労働（分）。 */
  readonly perUnitMinutes: number;

  /** 1日ぶんを賄うのに要る労働（分）と、それが1日（1440分）に占める割合（%）。 */
  readonly dailyMinutes: number;
  readonly dailyShare: number;

  /** 待ち生産の経路で、1日ぶんを賄うのに同時に要る設備の数。含まないならundefined。 */
  readonly deviceCount: number | undefined;
}

/** 1日を賄う献立の1行。 */
export interface MenuEntry {
  readonly route: ChainRoute;
  readonly repetitions: number;
  readonly minutes: number;
}

/** 1日を賄う献立と、その合計労働。 */
export interface DailyMenu {
  readonly entries: readonly MenuEntry[];
  readonly totalMinutes: number;

  /** どの経路でも埋まらなかった需要の名前。 */
  readonly unmet: readonly string[];

  /** 需要ごとに選んだ経路。viewerはこれを`<select>`の既定値にする。 */
  readonly chosen: ReadonlyMap<number, ChainRoute>;
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

  /** 1日を賄う献立（貪欲解）。viewerはこれを既定値にして、経路を選び替えられるようにする。 */
  readonly menu: DailyMenu;

  readonly devices: readonly DeviceRow[];
}

export interface BalanceTables {
  readonly characterNames: readonly string[];

  /** 代表キャラクタが1日に賄わなければならない値。 */
  readonly requirements: readonly Requirement[];

  readonly consumption: readonly ConsumptionRow[];
  readonly supply: readonly SupplyRow[];
  readonly places: readonly PlaceBalance[];
}

/** 収支表を丸ごと組み立てる。sampleCharacterは1日の必要量を取る代表キャラクタ。 */
export function buildBalanceTables(codex: WorldCodex, sampleCharacter: string): BalanceTables {
  const characterNames = codex.objectDefNamesWithTag('character');
  const character = codex.objects.get(codex.objectNames.getId(sampleCharacter));
  const requirements = requirementsOf(codex, character);

  return {
    characterNames,
    requirements,
    consumption: consumptionRows(codex, characterNames),
    // 供給表は島全体の文脈で出す。罠の重みは土地が入れるので、土地を決めないと候補が全部0になる。
    supply: supplyRows(codex, allSteps(codex, bestAncestorContext(explorableLocationsOf(codex)))),
    places: placeBalances(codex, character, requirements),
  };
}

/**
 * 1日に賄わなければならない値1つ。
 *
 * **輸送で減る値は需要にしない。** `carbohydrate`/`protein`/`lipid` は tick 毎に体脂肪へ流れるが、
 * あの速さは在庫がある間の流量であって、要る量ではない——体が実際に燃やすのは受け皿側
 * （`body_fat`）の減りだけで、三大栄養素はそこへ注ぐ原資（DigestionSystem.md 3節）。
 * 流量を要求量として数えると、必要な3.5倍を食べさせることになる。
 */
export interface Requirement {
  readonly propertyGlobalId: number;
  readonly name: string;
  readonly dailyNeed: number;

  /** この需要を埋められるプロパティ。体脂肪は三大栄養素が原資なので、そちらの増分で埋まる。 */
  readonly suppliedBy: readonly number[];

  /** 尽きると死ぬか（`on_shortfall` が自分を消す、VitalsSystem.md）。 */
  readonly lethal: boolean;
}

/**
 * 代表キャラクタが1日に賄わなければならない値。減らない値は含まない。
 *
 * 段で減る速さが変わる値（体脂肪）は、**初期値が入る段**の速さを採る。段ごとに違う数字を足すと、
 * どの段にも当てはまらない量になる。
 */
function requirementsOf(codex: WorldCodex, character: ObjectDef): readonly Requirement[] {
  const deltas = character.passives.tickDeltas().filter((delta) => delta.target === 'self');

  // 輸送の両端。負の側（三大栄養素）が原資で、正の側（体脂肪）が受け皿。
  const sources = [...new Set(deltas.filter((d) => d.capped && d.amount < 0).map((d) => d.propertyGlobalId))];
  const sinks = new Set(deltas.filter((d) => d.capped && d.amount > 0).map((d) => d.propertyGlobalId));

  const perTick = new Map<number, number>();
  for (const delta of deltas) {
    if (delta.capped || delta.gate.conditional || delta.amount >= 0) continue;
    if (delta.gate.stage !== undefined && !inInitialStage(character, delta)) continue;
    perTick.set(delta.propertyGlobalId, (perTick.get(delta.propertyGlobalId) ?? 0) + delta.amount);
  }

  return [...perTick].map(([propertyGlobalId, amount]) => ({
    propertyGlobalId,
    name: codex.propertyName(propertyGlobalId),
    dailyNeed: -amount * TICKS_PER_DAY,
    suppliedBy: sinks.has(propertyGlobalId) ? sources : [propertyGlobalId],
    lethal: destroysWhenEmpty(character, propertyGlobalId),
  }));
}

/** その増減を縛る段（8.2節）に、初期値が入っているか。段で縛られていない増減は常に真。 */
function inInitialStage(def: ObjectDef, delta: TickDelta): boolean {
  const stage = delta.gate.stage;
  if (stage === undefined) return true;

  const propertyDef = def.getPropertyDef(stage.propertyGlobalId);
  const value = def.staticValueOf(stage.propertyGlobalId);
  if (propertyDef === undefined || value === undefined) return false;
  return propertyDef.stageOf(value)?.name === stage.name;
}

/** そのプロパティが尽きたとき、持ち主ごと消えるか（`on_shortfall: destroy self`）。 */
function destroysWhenEmpty(def: ObjectDef, propertyGlobalId: number): boolean {
  const propertyDef = def.getPropertyDef(propertyGlobalId);
  if (propertyDef === undefined) return false;
  return propertyDef
    .rangeEventReadouts(() => undefined)
    .some((readout) => readout.label === 'on_shortfall' && readout.destroysSelf);
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

function placeBalances(
  codex: WorldCodex,
  character: ObjectDef,
  requirements: readonly Requirement[],
): readonly PlaceBalance[] {
  const locations = explorableLocationsOf(codex);

  // 持ち運べる道具は島のどこかで作れれば持ち込めるので、先に島全体を解いて各土地へ渡す。
  const islandContext = bestAncestorContext(locations);
  const islandWide = new Acquisition(codex, allSteps(codex, islandContext));

  return [undefined, ...locations].map((location) => {
    // 罠が掛ける動物の重みは土地が宣言する（inherit）ので、土地を決めてから工程を組み立てる。
    const context = location === undefined ? islandContext : ancestorContext(location);
    const steps =
      location === undefined ? allSteps(codex, context) : stepsAt(codex, allSteps(codex, context), location);
    const acquisition = location === undefined ? islandWide : new Acquisition(codex, steps, islandWide);
    const routes = routeCandidates(codex, character, acquisition, steps, requirements);

    return {
      name: location?.name ?? WHOLE_ISLAND,
      properties: propertyChains(codex, requirements, routes),
      menu: greedyMenu(requirements, routes),
      devices: deviceRows(codex, acquisition, steps),
    };
  });
}

/**
 * 需要のどれかを埋める経路をすべて挙げる。**プロパティごとではなく経路ごとに1件**——1回の実行で
 * 複数の値が返るので、献立（greedyMenu）はまとめて見ないと同時に返る分を差し引けない。
 */
function routeCandidates(
  codex: WorldCodex,
  character: ObjectDef,
  acquisition: Acquisition,
  steps: readonly StepRef[],
  requirements: readonly Requirement[],
): readonly ChainRoute[] {
  const suppliers = new Map<number, number[]>();
  for (const requirement of requirements)
    for (const propertyGlobalId of requirement.suppliedBy) {
      const list = suppliers.get(propertyGlobalId) ?? [];
      list.push(requirement.propertyGlobalId);
      suppliers.set(propertyGlobalId, list);
    }

  const candidates: ChainRoute[] = [];
  for (const ref of steps) {
    // 休息はどのキャラクタも同じ宣言を持つ（trait が配る）。プレイするのは1人なので代表だけを見る。
    if (isCharacter(codex, ref.def) && ref.def.globalId !== character.globalId) continue;

    const cost = acquisition.stepCost(ref);
    if (cost === undefined) continue;

    const deltas = gainsOf(codex, ref);
    // その工程が埋める需要（体脂肪は三大栄養素の増分がまとまって効く）。
    const fills = new Map<number, number>();
    for (const [propertyGlobalId, amount] of deltas) {
      if (amount <= 0) continue;
      for (const requirementId of suppliers.get(propertyGlobalId) ?? [])
        fills.set(requirementId, (fills.get(requirementId) ?? 0) + amount);
    }
    if (fills.size === 0) continue;

    candidates.push(
      buildRoute(codex, acquisition, [ref, ...acquisition.routeOf(ref.def.globalId)], cost, deltas, fills),
    );
  }
  return candidates;
}

/**
 * その工程がキャラクタへ返す値。**宣言元がキャラクタ自身なら `self` も数える**——休息
 * （`wait`/`rest`/`nap`/`sleep`）は自分の値を自分で戻す工程で、他の工程のように `actor` を持たない。
 */
function gainsOf(codex: WorldCodex, ref: StepRef): ReadonlyMap<number, number> {
  const actor = expectedDeltas(ref.step, 'actor');
  if (!isCharacter(codex, ref.def)) return actor;

  const merged = new Map(actor);
  for (const [propertyGlobalId, amount] of expectedDeltas(ref.step, 'self'))
    merged.set(propertyGlobalId, (merged.get(propertyGlobalId) ?? 0) + amount);
  return merged;
}

/**
 * 需要ごとに、それを埋める経路を単位あたりの労働の昇順で並べる。**最良経路だけには絞らない**
 * ——順位が入れ替わったときに差分が「1行まるごと差し替え」になり、何が起きたか読めなくなるため。
 */
function propertyChains(
  codex: WorldCodex,
  requirements: readonly Requirement[],
  routes: readonly ChainRoute[],
): readonly PropertyChains[] {
  return requirements
    .map((requirement) => ({
      propertyGlobalId: requirement.propertyGlobalId,
      propertyName: requirement.name,
      dailyNeed: requirement.dailyNeed,
      lethal: requirement.lethal,
      suppliedByNames: requirement.suppliedBy
        .filter((propertyGlobalId) => propertyGlobalId !== requirement.propertyGlobalId)
        .map((propertyGlobalId) => codex.propertyName(propertyGlobalId)),
      routes: routes
        .filter((route) => (route.fills.get(requirement.propertyGlobalId) ?? 0) > 0)
        .map((route) => propertyRoute(route, requirement))
        // 数えられない経路・前提が揃わない経路は末尾へ。数字は出すが、最安として混ぜない。
        .sort(
          (a, b) =>
            Number(a.route.untimed) - Number(b.route.untimed) ||
            Number(a.route.blocked) - Number(b.route.blocked) ||
            a.perUnitMinutes - b.perUnitMinutes,
        ),
    }))
    .filter((chains) => chains.routes.length > 0);
}

function propertyRoute(route: ChainRoute, requirement: Requirement): PropertyRoute {
  const gain = route.fills.get(requirement.propertyGlobalId)!;
  const perUnitMinutes = route.executionMinutes / gain;
  const dailyMinutes = perUnitMinutes * requirement.dailyNeed;
  return {
    route,
    gain,
    perUnitMinutes,
    dailyMinutes,
    dailyShare: (dailyMinutes * 100) / MINUTES_PER_DAY,
    deviceCount: route.deviceCount === undefined ? undefined : dailyMinutes / route.deviceCount,
  };
}

function buildRoute(
  codex: WorldCodex,
  acquisition: Acquisition,
  route: readonly StepRef[],
  cost: Cost,
  deltas: ReadonlyMap<number, number>,
  fills: ReadonlyMap<number, number>,
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
        imported: prerequisite.imported,
      });
    }

  return {
    steps: [...route].reverse().map((ref) => ({ objectName: ref.def.name, stepName: ref.step.name })),
    executionMinutes: totalOf(cost),
    exploreMinutes: cost.exploreMinutes,
    craftMinutes: cost.craftMinutes,
    fills,
    deltas: [...deltas].map(([propertyGlobalId, amount]) => ({
      name: codex.propertyName(propertyGlobalId),
      amount,
    })),
    deviceCount: deviceMaintenancePerDay(acquisition, route),
    prerequisites: [...prerequisites.values()],
    blocked: [...prerequisites.values()].some(({ minutes }) => minutes === undefined),
    needsImport: [...prerequisites.values()].some(({ imported }) => imported),
    // 労働0で値が返るなら、時間を数えられていない（雨で溜まる水など）。摂取そのものが0分なのは仕様
    // なので、素材を0分で得ている場合と、経路まるごとが0分の場合だけを印にする。
    untimed:
      totalOf(cost) === 0 ||
      route.slice(1).some((ref) => ref.cycle === undefined && ref.step.laborMinutes === 0),
  };
}

/**
 * 1日を賄う献立を貪欲に組む。**同時に返る値は差し引く**——按分しないと決めた以上、合計は献立を
 * 1つ選んで出すしかない（issue #550 で時間を按分しないと決めた帰結）。
 *
 * 毎回、まだ足りない分を最も速く埋める経路を選ぶ。速さは「1分あたりに埋まる需要の割合」で測る
 * ——プロパティごとに単位が違うので、必要量に対する割合へ直さないと足し合わせられない。
 */
export function greedyMenu(requirements: readonly Requirement[], routes: readonly ChainRoute[]): DailyMenu {
  const usable = routes.filter((route) => !route.blocked && !route.untimed && route.executionMinutes > 0);
  const remaining = new Map(requirements.map((r) => [r.propertyGlobalId, r.dailyNeed]));
  const chosen = new Map<number, ChainRoute>();

  // **menuForと同じ順序で、同じ数え方で選ぶ。** 「どの需要を先に満たしたか」で経路を割り当てると、
  // その経路がその需要を丸ごと賄うことになり、得意でない値を1つで埋めさせてしまう
  // （水20を返す青い実で、満腹1536を賄う類）。
  for (const requirement of requirements) {
    const left = remaining.get(requirement.propertyGlobalId) ?? 0;
    if (left <= 0) continue;

    let best: ChainRoute | undefined;
    let bestMinutes = Number.POSITIVE_INFINITY;
    for (const route of usable) {
      const gain = route.fills.get(requirement.propertyGlobalId) ?? 0;
      if (gain <= 0) continue;
      const minutes = (left / gain) * route.executionMinutes;
      if (minutes < bestMinutes) {
        bestMinutes = minutes;
        best = route;
      }
    }
    if (best === undefined) continue;

    chosen.set(requirement.propertyGlobalId, best);
    const repetitions = left / best.fills.get(requirement.propertyGlobalId)!;
    for (const [propertyGlobalId, filled] of best.fills)
      remaining.set(propertyGlobalId, (remaining.get(propertyGlobalId) ?? 0) - filled * repetitions);
  }

  return menuFor(requirements, chosen);
}

/**
 * 需要ごとに経路を1つ選んだときの合計労働（分）。**同時に返る値は差し引く**ので、宣言順に前から
 * 埋めていく。viewerが選び替えたときもここを呼ぶ——合算をブラウザ側で書き直すと、ずれたときに
 * どちらが正か分からなくなる。
 */
export function menuFor(
  requirements: readonly Requirement[],
  chosen: ReadonlyMap<number, ChainRoute>,
): DailyMenu {
  const remaining = new Map(requirements.map((r) => [r.propertyGlobalId, r.dailyNeed]));
  const entries: MenuEntry[] = [];

  for (const requirement of requirements) {
    const route = chosen.get(requirement.propertyGlobalId);
    const left = remaining.get(requirement.propertyGlobalId) ?? 0;
    if (route === undefined || left <= 0) continue;

    const gain = route.fills.get(requirement.propertyGlobalId) ?? 0;
    if (gain <= 0) continue;

    const repetitions = left / gain;
    for (const [propertyGlobalId, filled] of route.fills)
      remaining.set(propertyGlobalId, (remaining.get(propertyGlobalId) ?? 0) - filled * repetitions);
    addEntry(entries, route, repetitions);
  }

  return {
    entries,
    totalMinutes: entries.reduce((sum, entry) => sum + entry.minutes, 0),
    unmet: requirements
      .filter((requirement) => (remaining.get(requirement.propertyGlobalId) ?? 0) > 0)
      .map((requirement) => requirement.name),
    chosen,
  };
}

/** 同じ経路が複数回選ばれたら1行にまとめる（献立として読むとき、同じ料理は1行で足りる）。 */
function addEntry(entries: MenuEntry[], route: ChainRoute, repetitions: number): void {
  const existing = entries.find((entry) => entry.route === route);
  if (existing === undefined) {
    entries.push({ route, repetitions, minutes: repetitions * route.executionMinutes });
    return;
  }
  const merged = existing.repetitions + repetitions;
  entries[entries.indexOf(existing)] = {
    route,
    repetitions: merged,
    minutes: merged * route.executionMinutes,
  };
}

/**
 * その経路が使う設備を保つのに要る、1日あたりの労働（分）。待ち生産を含まないならundefined。
 *
 * 設備は寿命の間に朽ちるので、使い続けるには作り直し続けることになる。1日ぶんの労働をこれで割れば
 * 「同時に何個要るか」が出る——**待ち時間が労働へ跳ね返る場所がここ**で、周期が長いほど数が要る。
 */
function deviceMaintenancePerDay(acquisition: Acquisition, route: readonly StepRef[]): number | undefined {
  let perDay = 0;
  for (const ref of route) {
    if (ref.cycle?.lifetimeMinutes === undefined) continue;
    const deviceCost = acquisition.costByObject.get(ref.def.globalId);
    if (deviceCost === undefined) continue;
    perDay += totalOf(deviceCost) / (ref.cycle.lifetimeMinutes / MINUTES_PER_DAY);
  }
  return perDay === 0 ? undefined : perDay;
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
  readonly imported: boolean;
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

/**
 * 連鎖の起点にできる土地。**探索できるものだけ**——筏や外洋も土地（location）だが、探索を持たない
 * ので何も産まず、空の節が並ぶだけになる。`explorable` trait が配る進捗の宣言で見分ける。
 */
function explorableLocationsOf(codex: WorldCodex): readonly ObjectDef[] {
  const progress = codex.propertyNames.tryGetId('exploration_progress');
  if (progress === undefined) return [];
  return allDefs(codex).filter((def) => isLocation(codex, def) && def.getPropertyDef(progress) !== undefined);
}

/** プレイヤーが操作するキャラクタか（休息のように自分の値を自分で戻す工程の宣言元）。 */
function isCharacter(codex: WorldCodex, def: ObjectDef): boolean {
  const characterTag = codex.tagNames.tryGetId('character');
  return characterTag !== undefined && def.tags.includes(characterTag);
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

  /**
   * 島全体で見たときの入手時間。**持ち運べる前提（道具）だけがこれを見る。**
   *
   * 道具は1度作れば繰り返し使えるので、その土地で作れるかは可否を分けない——尖った石は石のある
   * 土地で作って持ち歩ける。一方で消費される素材は毎回要るため、持ち込みには回数ぶんの移動が
   * 要り、この表は移動を数えていないので局所のままにする（#550で時間を按分しないと決めたのと
   * 同じ「何回要るか」の軸）。
   *
   * 島全体の文脈そのものではundefined（自分が答え）。
   */
  private readonly islandWide: Acquisition | undefined;

  constructor(codex: WorldCodex, steps: readonly StepRef[], islandWide?: Acquisition) {
    this.codex = codex;
    this.steps = steps;
    this.islandWide = islandWide;
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
   * この工程を実行するのに要る、消費されない入力（道具・採取ポイント）。**土地とキャラクタ自身は
   * 除く**——どこかの土地には必ず立っているし、休息（`sleep`）の入力である自分は用意する物ではない。
   */
  prerequisites(ref: StepRef): readonly Prerequisite[] {
    const found: Prerequisite[] = [];
    for (const input of ref.step.inputs) {
      if (input.consumed) continue;
      if (input.kind === 'object' && this.isAlwaysAtHand(input.objectGlobalId)) continue;

      // タグ指定の入力は、そのタグを名乗ったうえで実際に使う型を添える（cutting_tool → sharp_stone）。
      const declared =
        input.kind === 'tag'
          ? this.codex.tagName(input.tagGlobalId)
          : this.codex.objectName(input.objectGlobalId);

      const local = this.cheapestCandidate(input);
      // この土地で作れなければ、持ち運べる道具に限って島全体から取る。
      const imported = local === undefined ? this.importable(input) : undefined;
      const objectGlobalId = local ?? imported?.objectGlobalId;
      if (objectGlobalId === undefined) {
        found.push({ label: declared, objectGlobalId: undefined, cost: undefined, imported: false });
        continue;
      }

      const chosen = this.codex.objectName(objectGlobalId);
      found.push({
        label: chosen === declared ? chosen : `${declared} → ${chosen}`,
        objectGlobalId,
        cost: imported?.cost ?? this.costByObject.get(objectGlobalId),
        imported: imported !== undefined,
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

  /**
   * 他の土地から持ち込める入力か。持ち運べる型（`item` タグ）に限る——設置物は持ち込めないので、
   * その土地に無ければブロックのままにする（ヤシの木を砂浜へ持って行くことはできない）。
   */
  private importable(
    input: CraftingStep['inputs'][number],
  ): { readonly objectGlobalId: number; readonly cost: Cost } | undefined {
    const island = this.islandWide;
    if (island === undefined) return undefined;

    const itemTag = this.codex.tagNames.tryGetId('item');
    if (itemTag === undefined) return undefined;

    let best: { objectGlobalId: number; cost: Cost } | undefined;
    for (const objectGlobalId of this.candidatesOf(input)) {
      if (!this.codex.objects.get(objectGlobalId).tags.includes(itemTag)) continue;
      const cost = island.costByObject.get(objectGlobalId);
      if (cost === undefined) continue;
      if (best === undefined || totalOf(cost) < totalOf(best.cost)) best = { objectGlobalId, cost };
    }
    return best;
  }

  /** 用意する必要が無い入力か（立っている土地と、自分自身）。 */
  private isAlwaysAtHand(objectGlobalId: number): boolean {
    const def = this.codex.objects.get(objectGlobalId);
    return isLocation(this.codex, def) || isCharacter(this.codex, def);
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
