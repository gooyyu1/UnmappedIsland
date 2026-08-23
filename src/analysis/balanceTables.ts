import type { ObjectDef } from '../domain/ObjectDef';
import type { TickDelta } from './tickDeltas';
import { tickDeltasOf } from './tickDeltas';
import type { WorldCodex } from '../domain/WorldCodex';
import type { CraftingStep } from './CraftingStep';
import { craftingStepsOf } from './craftingSteps';
import type { ExternalTickDelta, RangeCycle } from './rangeCycles';
import { externalTickDeltasOf, rangeCyclesOf } from './rangeCycles';
import { rangeEventReadouts } from './rangeEvents';
import type { StaticValueResolver } from './staticValue';
import { staticValueOf } from './staticValue';

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

  /** 待ち生産を含む経路なら、1回の実行で設備が回っている時間（分）。含まないならundefined。 */
  readonly devicePeriodMinutes: number | undefined;

  readonly prerequisites: readonly RoutePrerequisite[];

  /** 前提の道具に入手経路が無い経路か。 */
  readonly blocked: boolean;

  /**
   * 他の土地で用意した材料・道具が要る経路か。**可否は分けない**——AとBの土地で集めた物を合わせて
   * 作るのは普通の遊び方なので、印として持つだけ（issue #562）。時間の扱いも変わらない。
   */
  readonly needsImport: boolean;

  /**
   * その土地の探索・設置物から始まる経路か。偽なら、その土地の表の対象ではない（できないのではなく、
   * 別の土地を起点にした話）。島全体の文脈では常に真。
   */
  readonly rootedHere: boolean;

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

  /**
   * 待ち生産の経路で、1日ぶんを賄うのに同時に要る設備の数（1日に回す回数 × 周期 ÷ 1日）。
   * 含まないならundefined。
   */
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

/**
 * 島のどこにも入手経路が無いものと、それが塞いでいる経路。**内容の穴**であって土地の性質ではないので、
 * 土地ごとに繰り返さず島全体で1度だけ挙げる（issue #562）。この一覧がそのまま、埋めるべきものになる。
 */
export interface Gap {
  readonly label: string;
  readonly blockedRoutes: readonly RouteSummary[];
}

/** 穴が塞いでいる経路1つ。どの値を返すはずだったかまで出す。 */
export interface RouteSummary {
  readonly steps: readonly RouteStep[];
  readonly deltas: readonly NamedAmount[];
}

/**
 * オブジェクト1つを素材の採集から手に入れるまでの総労働。
 *
 * **生存に要る値だけを見ていると、筏のような物のコストがどこにも出ない**（issue #568）。前提の列で
 * 既に出していた計算を、生存の連鎖から辿れるものに限らず全オブジェクトへ広げたもの。
 */
export interface ObjectCost {
  readonly objectName: string;

  /** 素材の採集から数えた総労働（分）。島のどこにも入手経路が無ければundefined。 */
  readonly minutes: number | undefined;
  readonly exploreMinutes: number | undefined;
  readonly craftMinutes: number | undefined;

  /** 最も安い作り方（上流→下流）。入手経路が無ければ空。 */
  readonly steps: readonly RouteStep[];

  /** 要る道具。単位あたりへは按分しない（#550）。 */
  readonly prerequisites: readonly RoutePrerequisite[];

  /** 入手経路が無いとき、足りていない入力。**どこで詰まっているか**がこれで分かる。 */
  readonly missing: readonly string[];

  /** 材料は揃うが、要る道具に入手経路が無いか。筏は丸太も縄も作れるが、丸太を切る道具が無い。 */
  readonly blockedByTool: boolean;

  /** 生存に要る労働を引いた残りで割った日数。余剰が無ければundefined。 */
  readonly days: number | undefined;
}

export interface BalanceTables {
  readonly characterNames: readonly string[];

  /** 全オブジェクトの総コスト（宣言順）。 */
  readonly objectCosts: readonly ObjectCost[];

  /** 島のどこにも入手経路が無いもの（内容の穴）。 */
  readonly gaps: readonly Gap[];

  /** 代表キャラクタが1日に賄わなければならない値。 */
  readonly dailyNeeds: readonly DailyNeed[];

  readonly consumption: readonly ConsumptionRow[];
  readonly supply: readonly SupplyRow[];
  readonly places: readonly PlaceBalance[];
}

/** 収支表を丸ごと組み立てる。sampleCharacterは1日の必要量を取る代表キャラクタ。 */
export function buildBalanceTables(codex: WorldCodex, sampleCharacter: string): BalanceTables {
  const characterNames = codex.objectDefNamesWithTag(codex.vocabulary.world.characterTagId);
  const character = codex.objects.get(codex.objectNames.getId(sampleCharacter));
  const dailyNeeds = dailyNeedsOf(codex, character);
  const { places, gaps, islandWide } = placeBalances(codex, character, dailyNeeds);

  return {
    characterNames,
    dailyNeeds,
    gaps,
    objectCosts: objectCosts(codex, islandWide, MINUTES_PER_DAY - places[0].menu.totalMinutes),
    consumption: consumptionRows(codex, characterNames),
    // 供給表は島全体の文脈で出す。罠の重みは土地が入れるので、土地を決めないと候補が全部0になる。
    supply: supplyRows(
      codex,
      allSteps(codex, withBestDragged([...codex.objects], bestAncestorContext(explorableLocationsOf(codex)))),
    ),
    places,
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
export interface DailyNeed {
  readonly propertyGlobalId: number;
  readonly name: string;

  /** 1日に賄う量。 */
  readonly amount: number;

  /** この需要を埋められるプロパティ。体脂肪は三大栄養素が原資なので、そちらの増分で埋まる。 */
  readonly suppliedBy: readonly number[];

  /** 尽きると死ぬか（`on_min` が自分を消す、VitalsSystem.md）。 */
  readonly lethal: boolean;
}

/**
 * 代表キャラクタが1日に賄わなければならない値。減らない値は含まない。
 *
 * 段で減る速さが変わる値（体脂肪）は、**初期値が入る段**の速さを採る。段ごとに違う数字を足すと、
 * どの段にも当てはまらない量になる。
 */
function dailyNeedsOf(codex: WorldCodex, character: ObjectDef): readonly DailyNeed[] {
  const deltas = tickDeltasOf(character).filter((delta) => delta.target === 'self');

  // 輸送の両端。負の側（三大栄養素）が原資で、正の側（体脂肪）が受け皿。
  const sources = [...new Set(deltas.filter((d) => d.capped && d.amount < 0).map((d) => d.propertyGlobalId))];
  const sinks = new Set(deltas.filter((d) => d.capped && d.amount > 0).map((d) => d.propertyGlobalId));

  const perTick = new Map<number, number>();
  for (const delta of deltas) {
    if (delta.capped || delta.gate.conditional || delta.amount >= 0) continue;
    if (delta.gate.stage !== undefined && !inInitialStage(character, delta)) continue;
    perTick.set(delta.propertyGlobalId, (perTick.get(delta.propertyGlobalId) ?? 0) + delta.amount);
  }

  return [...perTick].map(([propertyGlobalId, perTickAmount]) => ({
    propertyGlobalId,
    name: codex.propertyNames.getName(propertyGlobalId),
    amount: -perTickAmount * TICKS_PER_DAY,
    suppliedBy: sinks.has(propertyGlobalId) ? sources : [propertyGlobalId],
    lethal: destroysWhenEmpty(character, propertyGlobalId),
  }));
}

/** その増減を縛る段（8.2節）に、初期値が入っているか。段で縛られていない増減は常に真。 */
function inInitialStage(def: ObjectDef, delta: TickDelta): boolean {
  const stage = delta.gate.stage;
  if (stage === undefined) return true;

  const propertyDef = def.tryGetPropertyDef(stage.propertyGlobalId);
  const value = staticValueOf(def, stage.propertyGlobalId);
  if (propertyDef === undefined || value === undefined) return false;
  return propertyDef.isInStage(value, stage.name);
}

/** そのプロパティが尽きたとき、持ち主ごと消えるか（`on_min: destroy self`）。 */
function destroysWhenEmpty(def: ObjectDef, propertyGlobalId: number): boolean {
  const propertyDef = def.tryGetPropertyDef(propertyGlobalId);
  if (propertyDef === undefined) return false;
  return rangeEventReadouts(propertyDef, () => undefined).some(
    (readout) => readout.label === 'on_min' && readout.destroysSelf,
  );
}

function consumptionRows(codex: WorldCodex, characterNames: readonly string[]): readonly ConsumptionRow[] {
  const byCharacter = characterNames.map((name) =>
    tickAmountsByName(codex, codex.objects.get(codex.objectNames.getId(name))),
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
function tickAmountsByName(codex: WorldCodex, def: ObjectDef): ReadonlyMap<string, number> {
  const byKey = new Map<string, number>();
  for (const delta of tickDeltasOf(def)) {
    if (delta.target !== 'self') continue;
    const key = `${codex.propertyNames.getName(delta.propertyGlobalId)}${KEY_SEPARATOR}${conditionLabel(codex, delta)}`;
    byKey.set(key, (byKey.get(key) ?? 0) + delta.amount);
  }
  return byKey;
}

/** そのゲート（8.2節）と輸送かどうかを1語で言い表す。 */
function conditionLabel(codex: WorldCodex, delta: TickDelta): string {
  const capped = delta.capped ? '（輸送・在庫がある間）' : '';
  if (delta.gate.stage !== undefined)
    return `段 ${codex.propertyNames.getName(delta.gate.stage.propertyGlobalId)}=${delta.gate.stage.name}${capped}`;
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
      spawns: [...spawns].map(([globalId, amount]) => ({
        name: codex.objectNames.getName(globalId),
        amount,
      })),
      actorDeltas: [...actorDeltas].map(([globalId, amount]) => ({
        name: codex.propertyNames.getName(globalId),
        amount,
      })),
      selfDeltas: [...selfDeltas].map(([globalId, amount]) => ({
        name: codex.propertyNames.getName(globalId),
        amount,
      })),
    });
  }
  return rows;
}

function placeBalances(
  codex: WorldCodex,
  character: ObjectDef,
  dailyNeeds: readonly DailyNeed[],
): {
  readonly places: readonly PlaceBalance[];
  readonly gaps: readonly Gap[];
  readonly islandWide: Acquisition;
} {
  const locations = explorableLocationsOf(codex);
  const defs = [...codex.objects];

  // 持ち運べる道具は島のどこかで作れれば持ち込めるので、先に島全体を解いて各土地へ渡す。
  const islandContext = withBestDragged(defs, bestAncestorContext(locations));
  const islandWide = new Acquisition(codex, allSteps(codex, islandContext));

  let islandRoutes: readonly ChainRoute[] = [];
  const places = [undefined, ...locations].map((location) => {
    // 罠が掛ける動物の重みは土地が宣言する（inherit）ので、土地を決めてから工程を組み立てる。
    const context = location === undefined ? islandContext : withBestDragged(defs, ancestorContext(location));
    const steps =
      location === undefined ? allSteps(codex, context) : stepsAt(codex, allSteps(codex, context), location);
    const acquisition = location === undefined ? islandWide : new Acquisition(codex, steps, islandWide);
    const routes = routeCandidates(codex, character, acquisition, steps, dailyNeeds, location);

    if (location === undefined) islandRoutes = routes;

    // その土地を起点にしない経路は「できない」のではなく、この表の対象ではない。島のどこにも
    // 入手経路が無いものは、繰り返さず島全体の「穴」へまとめる。**表と献立で同じ集合を見る。**
    const usable = routes.filter((route) => route.rootedHere && !route.blocked);
    return {
      name: location?.name ?? WHOLE_ISLAND,
      properties: propertyChains(codex, dailyNeeds, usable),
      menu: greedyMenu(dailyNeeds, usable),
      devices: deviceRows(codex, acquisition, steps),
    };
  });

  return { places, gaps: gapsOf(islandRoutes), islandWide };
}

/**
 * 全オブジェクトの総コスト。**生存の連鎖から辿れるものに限らない**——筏のように、どの生存経路の
 * 前提でもない物のコストが、これまでどこにも出ていなかった（issue #568）。
 *
 * 並びは宣言順にする。値で並べ替えると、数値を触るたびに行が入れ替わって差分が読めなくなる。
 * 対象から外すのは、手に入れるという言い方が成り立たないもの——土地・キャラクタ・世界（singleton）、
 * 単独で存在できない物（怪我・道）、レシピが自動生成する製作中オブジェクト。
 */
function objectCosts(
  codex: WorldCodex,
  islandWide: Acquisition,
  surplusMinutes: number,
): readonly ObjectCost[] {
  const rows: ObjectCost[] = [];
  for (const def of [...codex.objects]) {
    if (def.isSingleton || def.boundToOwner) continue;
    if (codex.isGenerated(def)) continue;
    // 土地は生成されるもので、手に入れるものではない。**ただし作れる土地は対象**——筏は乗り込む
    // 場所であると同時に、丸太と縄から組み上げる物でもある。
    if (isLocation(codex, def) && !islandWide.producedObjects.has(def.globalId)) continue;

    const cost = islandWide.costByObject.get(def.globalId);
    const route = islandWide.routeOf(def.globalId);
    const prerequisites = route.length === 0 ? [] : [...prerequisitesOf(codex, islandWide, route).values()];

    rows.push({
      objectName: def.name,
      minutes: cost === undefined ? undefined : totalOf(cost),
      exploreMinutes: cost?.exploreMinutes,
      craftMinutes: cost?.craftMinutes,
      steps: [...route].reverse().map((ref) => ({ objectName: ref.def.name, stepName: ref.step.name })),
      prerequisites,
      missing: cost === undefined ? islandWide.missingInputsFor(def.globalId) : [],
      blockedByTool: cost !== undefined && prerequisites.some(({ minutes }) => minutes === undefined),
      days: cost === undefined || surplusMinutes <= 0 ? undefined : totalOf(cost) / surplusMinutes,
    });
  }
  return rows;
}

/**
 * 島のどこにも入手経路が無いものを、それが塞いでいる経路とともに挙げる。同じものが複数の経路を
 * 塞いでいれば1件にまとめる——**読み手が知りたいのは「何が足りないか」**で、経路ごとの数字ではない。
 */
function gapsOf(islandRoutes: readonly ChainRoute[]): readonly Gap[] {
  const byLabel = new Map<string, RouteSummary[]>();
  for (const route of islandRoutes) {
    if (!route.blocked) continue;
    for (const prerequisite of route.prerequisites) {
      if (prerequisite.minutes !== undefined) continue;
      const blocked = byLabel.get(prerequisite.label) ?? [];
      blocked.push({ steps: route.steps, deltas: route.deltas });
      byLabel.set(prerequisite.label, blocked);
    }
  }
  return [...byLabel].map(([label, blockedRoutes]) => ({ label, blockedRoutes }));
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
  dailyNeeds: readonly DailyNeed[],
  place: ObjectDef | undefined,
): readonly ChainRoute[] {
  const suppliers = new Map<number, number[]>();
  for (const dailyNeed of dailyNeeds)
    for (const propertyGlobalId of dailyNeed.suppliedBy) {
      const list = suppliers.get(propertyGlobalId) ?? [];
      list.push(dailyNeed.propertyGlobalId);
      suppliers.set(propertyGlobalId, list);
    }

  const candidates: ChainRoute[] = [];
  for (const ref of steps) {
    // 休息はどのキャラクタも同じ宣言を持つ（trait が配る）。プレイするのは1人なので代表だけを見る。
    if (isCharacter(codex, ref.def) && ref.def.globalId !== character.globalId) continue;

    const resolved = acquisition.stepCost(ref);
    if (resolved === undefined) continue;

    const deltas = gainsOf(codex, ref);
    // その工程が埋める需要（体脂肪は三大栄養素の増分がまとまって効く）。
    const fills = new Map<number, number>();
    for (const [propertyGlobalId, amount] of deltas) {
      if (amount <= 0) continue;
      for (const requirementId of suppliers.get(propertyGlobalId) ?? [])
        fills.set(requirementId, (fills.get(requirementId) ?? 0) + amount);
    }
    if (fills.size === 0) continue;

    const route = [ref, ...acquisition.routeOf(ref.def.globalId)];
    candidates.push(buildRoute(codex, acquisition, route, resolved, deltas, fills, place));
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
  dailyNeeds: readonly DailyNeed[],
  routes: readonly ChainRoute[],
): readonly PropertyChains[] {
  return dailyNeeds
    .map((dailyNeed) => ({
      propertyGlobalId: dailyNeed.propertyGlobalId,
      propertyName: dailyNeed.name,
      dailyNeed: dailyNeed.amount,
      lethal: dailyNeed.lethal,
      suppliedByNames: dailyNeed.suppliedBy
        .filter((propertyGlobalId) => propertyGlobalId !== dailyNeed.propertyGlobalId)
        .map((propertyGlobalId) => codex.propertyNames.getName(propertyGlobalId)),
      routes: routes
        .filter((route) => (route.fills.get(dailyNeed.propertyGlobalId) ?? 0) > 0)
        .map((route) => propertyRoute(route, dailyNeed))
        // 数えられない経路は末尾へ。数字は出すが、最安として混ぜない。
        .sort(
          (a, b) => Number(a.route.untimed) - Number(b.route.untimed) || a.perUnitMinutes - b.perUnitMinutes,
        ),
    }))
    .filter((chains) => chains.routes.length > 0);
}

function propertyRoute(route: ChainRoute, dailyNeed: DailyNeed): PropertyRoute {
  const gain = route.fills.get(dailyNeed.propertyGlobalId)!;
  const perUnitMinutes = route.executionMinutes / gain;
  const dailyMinutes = perUnitMinutes * dailyNeed.amount;
  return {
    route,
    gain,
    perUnitMinutes,
    dailyMinutes,
    dailyShare: (dailyMinutes * 100) / MINUTES_PER_DAY,
    deviceCount:
      route.devicePeriodMinutes === undefined
        ? undefined
        : ((dailyNeed.amount / gain) * route.devicePeriodMinutes) / MINUTES_PER_DAY,
  };
}

/**
 * 経路を通して要る道具（消費されない入力）。**経路の中で作る物は数えない**——自分で用意する手順が
 * 既に経路として出ているため。同じ物が複数の工程で要っても1件にまとめる。
 */
function prerequisitesOf(
  codex: WorldCodex,
  acquisition: Acquisition,
  route: readonly StepRef[],
): ReadonlyMap<string, RoutePrerequisite> {
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
            : codex.objectNames.getName(prerequisite.objectGlobalId),
        minutes: prerequisite.cost === undefined ? undefined : totalOf(prerequisite.cost),
        imported: prerequisite.imported,
      });
    }
  return prerequisites;
}

function buildRoute(
  codex: WorldCodex,
  acquisition: Acquisition,
  route: readonly StepRef[],
  resolved: StepCost,
  deltas: ReadonlyMap<number, number>,
  fills: ReadonlyMap<number, number>,
  place: ObjectDef | undefined,
): ChainRoute {
  const cost = resolved.cost;
  const prerequisites = prerequisitesOf(codex, acquisition, route);

  return {
    steps: [...route].reverse().map((ref) => ({ objectName: ref.def.name, stepName: ref.step.name })),
    executionMinutes: totalOf(cost),
    exploreMinutes: cost.exploreMinutes,
    craftMinutes: cost.craftMinutes,
    fills,
    deltas: [...deltas].map(([propertyGlobalId, amount]) => ({
      name: codex.propertyNames.getName(propertyGlobalId),
      amount,
    })),
    devicePeriodMinutes: devicePeriodOf(route),
    prerequisites: [...prerequisites.values()],
    blocked: [...prerequisites.values()].some(({ minutes }) => minutes === undefined),
    needsImport: resolved.imported || [...prerequisites.values()].some(({ imported }) => imported),
    // その土地を起点にする経路か。**持ち込みが1つも要らないなら起点はここ**——他の土地の産物は
    // 必ず持ち込みとして解かれるため（stepsAtが他の土地の探索を外している）。休息もここに入る。
    rootedHere:
      place === undefined ||
      route.some((ref) => ref.def.globalId === place.globalId) ||
      !(resolved.imported || [...prerequisites.values()].some(({ imported }) => imported)),
    // 労働0で値が返るなら、時間を数えられていない（雨で溜まる水など）。摂取そのものが0分なのは仕様
    // なので、素材を0分で得ている場合と、経路まるごとが0分の場合だけを印にする。時間で回る工程
    // （罠・焼き上がり）は労働0でよい——待つ間に他のことができるだけで、数え落としではない。
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
function greedyMenu(dailyNeeds: readonly DailyNeed[], routes: readonly ChainRoute[]): DailyMenu {
  const usable = routes.filter((route) => !route.blocked && !route.untimed && route.executionMinutes > 0);
  const remaining = new Map(dailyNeeds.map((need) => [need.propertyGlobalId, need.amount]));
  const chosen = new Map<number, ChainRoute>();

  // **menuForと同じ順序で、同じ数え方で選ぶ。** 「どの需要を先に満たしたか」で経路を割り当てると、
  // その経路がその需要を丸ごと賄うことになり、得意でない値を1つで埋めさせてしまう
  // （水20を返す青い実で、満腹1536を賄う類）。
  for (const dailyNeed of dailyNeeds) {
    const left = remaining.get(dailyNeed.propertyGlobalId) ?? 0;
    if (left <= 0) continue;

    let best: ChainRoute | undefined;
    let bestMinutes = Number.POSITIVE_INFINITY;
    for (const route of usable) {
      const gain = route.fills.get(dailyNeed.propertyGlobalId) ?? 0;
      if (gain <= 0) continue;
      const minutes = (left / gain) * route.executionMinutes;
      if (minutes < bestMinutes) {
        bestMinutes = minutes;
        best = route;
      }
    }
    if (best === undefined) continue;

    chosen.set(dailyNeed.propertyGlobalId, best);
    const repetitions = left / best.fills.get(dailyNeed.propertyGlobalId)!;
    for (const [propertyGlobalId, filled] of best.fills)
      remaining.set(propertyGlobalId, (remaining.get(propertyGlobalId) ?? 0) - filled * repetitions);
  }

  return menuFor(dailyNeeds, chosen);
}

/**
 * 需要ごとに経路を1つ選んだときの合計労働（分）。**同時に返る値は差し引く**ので、宣言順に前から
 * 埋めていく。viewerが選び替えたときもここを呼ぶ——合算をブラウザ側で書き直すと、ずれたときに
 * どちらが正か分からなくなる。
 */
export function menuFor(
  dailyNeeds: readonly DailyNeed[],
  chosen: ReadonlyMap<number, ChainRoute>,
): DailyMenu {
  const remaining = new Map(dailyNeeds.map((need) => [need.propertyGlobalId, need.amount]));
  const entries: MenuEntry[] = [];

  for (const dailyNeed of dailyNeeds) {
    const route = chosen.get(dailyNeed.propertyGlobalId);
    const left = remaining.get(dailyNeed.propertyGlobalId) ?? 0;
    if (route === undefined || left <= 0) continue;

    const gain = route.fills.get(dailyNeed.propertyGlobalId) ?? 0;
    if (gain <= 0) continue;

    const repetitions = left / gain;
    for (const [propertyGlobalId, filled] of route.fills)
      remaining.set(propertyGlobalId, (remaining.get(propertyGlobalId) ?? 0) - filled * repetitions);
    addEntry(entries, route, repetitions);
  }

  return {
    entries,
    totalMinutes: entries.reduce((sum, entry) => sum + entry.minutes, 0),
    unmet: dailyNeeds
      .filter((dailyNeed) => (remaining.get(dailyNeed.propertyGlobalId) ?? 0) > 0)
      .map((dailyNeed) => dailyNeed.name),
    chosen,
  };
}

/** 同じ経路が複数回選ばれたら1行にまとめる（献立として読むとき、同じ料理は1行で足りる）。 */
function addEntry(entries: MenuEntry[], route: ChainRoute, repetitions: number): void {
  const existing = entries.find((entry) => entry.route === route);
  if (existing === undefined) {
    entries.push({ route, repetitions, minutes: repetitions * route.executionMinutes });
  } else {
    const merged = existing.repetitions + repetitions;
    entries[entries.indexOf(existing)] = {
      route,
      repetitions: merged,
      minutes: merged * route.executionMinutes,
    };
  }
}

/**
 * その経路を1回実行する間に、設備が回っている時間（分）。待ち生産を含まないならundefined。
 *
 * **同時に何個要るかはここから出る**（deviceCount）——1日に回す回数 × この時間が1日を超えるなら、
 * 1つでは間に合わないということ。周期が長いほど数が要る。
 */
function devicePeriodOf(route: readonly StepRef[]): number | undefined {
  let periodMinutes = 0;
  for (const ref of route) {
    if (ref.cycle?.repeats !== true) continue;
    periodMinutes += ref.cycle.periodMinutes;
  }
  return periodMinutes === 0 ? undefined : periodMinutes;
}

function deviceRows(
  codex: WorldCodex,
  acquisition: Acquisition,
  steps: readonly StepRef[],
): readonly DeviceRow[] {
  const rows: DeviceRow[] = [];
  for (const ref of steps) {
    // 繰り返す仕掛けだけ。1回で終わる作り替え（焼き上がり・失血死）は、設備を1つ保って何個返るかを
    // 数える表に載せる意味が無い——返るのは常に1個で、消えるのは設備ではなく入力そのもの。
    if (ref.cycle?.repeats !== true || ref.step.outputs.length === 0) continue;

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
        productName: codex.objectNames.getName(objectGlobalId),
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

  /** 時間で回る工程（罠の判定、火にかけた肉の焼き上がり）なら、その周期。 */
  readonly cycle: DeviceCycle | undefined;
}

interface DeviceCycle {
  readonly periodMinutes: number;

  /**
   * 繰り返す仕掛け（罠）か。真なら**プレイヤーは待ち時間を払わないが、設備は待っている間も朽ちる**
   * ので、1周期で使い切る設備の割合（周期÷寿命）が値段になる。偽は1回で終わる作り替えで、
   * 消えるのは入力そのものなので按分は要らない。
   */
  readonly repeats: boolean;

  /** 宣言元が朽ちるまでの時間（分）。朽ちない設備では按分できないためundefined。 */
  readonly lifetimeMinutes: number | undefined;
}

/** 工程1回の値段と、それが他の土地からの持ち込みを含むか。 */
interface StepCost {
  readonly cost: Cost;
  readonly imported: boolean;
}

/** 工程を実行するのに要る、消費されない入力1件。costがundefinedなら、島のどこにも入手経路が無い。 */
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

function scaleCost(cost: Cost, factor: number): Cost {
  return { exploreMinutes: cost.exploreMinutes * factor, craftMinutes: cost.craftMinutes * factor };
}

/**
 * 立って作業できる土地か。**製作中オブジェクトは除く**——完成品のタグを引き継ぐ（RecipeSystem.md
 * 5節）ので、作りかけの筏まで土地として並んでしまう。
 */
function isLocation(codex: WorldCodex, def: ObjectDef): boolean {
  return def.hasTag(codex.vocabulary.world.locationTagId) && !def.isInProgress;
}

/** プレイヤーが操作するキャラクタか（休息のように自分の値を自分で戻す工程の宣言元）。 */
function isCharacter(codex: WorldCodex, def: ObjectDef): boolean {
  return def.hasTag(codex.vocabulary.world.characterTagId);
}

/**
 * 連鎖の起点にできる土地。**探索できるものだけ**——筏や外洋も土地（location）だが、探索を持たない
 * ので何も産まず、空の節が並ぶだけになる。`explorable` trait が配る進捗の宣言で見分ける。
 */
function explorableLocationsOf(codex: WorldCodex): readonly ObjectDef[] {
  const progress = codex.vocabulary.world.explorationProgressId;
  return [...codex.objects].filter(
    (def) => isLocation(codex, def) && def.tryGetPropertyDef(progress) !== undefined,
  );
}

/**
 * 全型の全工程。宣言順（型のグローバルID順、型の中は宣言順）。プレイヤーが起こす工程に続けて、
 * 時間で回る工程（罠の判定）も並べる。
 *
 * outerは、祖先（＝置かれている土地）が入れる値を解く手立て。罠が掛ける動物の重みは土地が
 * 宣言するので（`inherit`）、これが無いと候補が全部0になる。
 */
function allSteps(codex: WorldCodex, outer?: StaticValueResolver): readonly StepRef[] {
  const defs = [...codex.objects];
  return defs.flatMap((def) => {
    const cycles = rangeCyclesOf(def, outer, externalTickDeltasOn(def, defs));
    const lifetimeMinutes = lifetimeOf(cycles);
    return [
      ...craftingStepsOf(def, outer).map((step) => ({ def, step, cycle: undefined })),
      // 繰り返す周期は設備（罠）。1回で終わる周期は、外から押されて初めて起こる作り替え
      // （火にかけた肉が焼ける・失血した獲物が死体になる）。朽ちるだけの周期は工程ではない。
      ...cycles
        .filter((cycle) => cycle.repeats || cycle.drivenBy !== undefined)
        .map((cycle) => ({
          def,
          step: cycle.step,
          cycle: { periodMinutes: cycle.minutes, repeats: cycle.repeats, lifetimeMinutes },
        })),
    ];
  });
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

/**
 * その型が朽ちるまでの時間（分）。複数あれば最も早く尽きるもの。朽ちないならundefined。
 *
 * 外から押されて消える周期（焼き上がり・失血死）は数えない——**置いておくだけでは起こらない**ので、
 * それを寿命と呼ぶと、火にかけていない肉まで勝手に焼け落ちることになる。
 */
function lifetimeOf(cycles: readonly RangeCycle[]): number | undefined {
  const ends = cycles
    .filter((cycle) => cycle.destroysSelf && !cycle.repeats && cycle.drivenBy === undefined)
    .map((cycle) => cycle.minutes);
  return ends.length === 0 ? undefined : Math.min(...ends);
}

/** 祖先（置かれている土地）の宣言値を答える手立て。宣言していないプロパティは寄与0。 */
function ancestorContext(location: ObjectDef): StaticValueResolver {
  return (root, propertyGlobalId) =>
    root === 'ancestor' ? (staticValueOf(location, propertyGlobalId) ?? 0) : undefined;
}

/** どの土地に置いてもよい前提での祖先の値。最も高く宣言している土地に置いたものとして扱う。 */
function bestAncestorContext(locations: readonly ObjectDef[]): StaticValueResolver {
  return (root, propertyGlobalId) => {
    if (root !== 'ancestor') return undefined;
    const declared = locations
      .map((location) => staticValueOf(location, propertyGlobalId))
      .filter((value): value is number => value !== undefined);
    return declared.length === 0 ? 0 : Math.max(...declared);
  };
}

/**
 * ancestorに、重ねる相手（dragged）の値を足した文脈。**最も高く宣言している型を重ねたものとして
 * 扱う**（bestAncestorContextと同じ見方）。
 *
 * これが無いと、相手の値を見る重み——一撃がどう入るかは武器が決める（HuntingSystem.md 1.2節）——が
 * 全て0になり、宣言順で最初の候補だけが起こることになる（PickEffect.selectWeighted）。
 * 分岐ごとに最も良い武器を選べる前提の配分なので、**どれか1つの武器で出る配分ではない**。
 */
function withBestDragged(defs: readonly ObjectDef[], ancestor: StaticValueResolver): StaticValueResolver {
  return (root, propertyGlobalId) => {
    if (root !== 'dragged') return ancestor(root, propertyGlobalId);
    const declared = defs
      .map((def) => staticValueOf(def, propertyGlobalId))
      .filter((value): value is number => value !== undefined);
    return declared.length === 0 ? undefined : Math.max(...declared);
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

  /** どこかの工程が生み出す型。土地のように「生成されるもの」と、作れる物を分けるのに使う。 */
  readonly producedObjects = new Set<number>();

  /**
   * その型を最も安く手に入れる道筋が、他の土地の産物を含むか。**入手連鎖を伝って残す**——
   * 熟したヤシの実を持ち込んで加工した果肉は、果肉そのものがこの土地で作れても「持ち込みが要る」。
   */
  private readonly importedByObject = new Map<number, boolean>();

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
    for (const ref of steps)
      for (const objectGlobalId of expectedSpawns(ref.step).keys()) this.producedObjects.add(objectGlobalId);
    this.relax();
  }

  /**
   * この工程を1回実行するのに**プレイヤーが払う**時間（労働時間＋消費する入力の入手時間）。
   * 揃わなければundefined。待ち時間は含めない——待っている間に他のことができるため。
   */
  stepCost(ref: StepRef): StepCost | undefined {
    const owned = isLocation(this.codex, ref.def);
    let cost: Cost = {
      exploreMinutes: owned ? ref.step.laborMinutes : 0,
      craftMinutes: owned ? 0 : ref.step.laborMinutes,
    };
    let imported = false;

    // 繰り返す仕掛けは、1周期ぶんだけ設備を使い切る。朽ちない設備は按分できない（待てば無限に得られる）。
    if (ref.cycle?.repeats === true) {
      if (ref.cycle.lifetimeMinutes === undefined) return undefined;
      const device = this.costByObject.get(ref.def.globalId);
      if (device === undefined) return undefined;
      cost = addCost(cost, scaleCost(device, ref.cycle.periodMinutes / ref.cycle.lifetimeMinutes));
    }

    for (const input of ref.step.inputs) {
      if (!input.consumed) continue;
      const resolved = this.inputCost(input);
      if (resolved === undefined) return undefined;
      // **要る個数を掛ける。** 筏は丸太を6本使うので、1本ぶんで数えると桁が変わる。
      cost = addCost(cost, scaleCost(resolved.cost, input.count));
      imported ||= resolved.imported;
    }
    return { cost, imported };
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
          ? this.codex.tagNames.getName(input.tagGlobalId)
          : this.codex.objectNames.getName(input.objectGlobalId);

      const local = this.cheapestCandidate(input);
      // この土地で用意できなければ、他の土地で用意したものとして島全体から取る。
      const imported = local === undefined ? this.importable(input) : undefined;
      const objectGlobalId = local ?? imported?.objectGlobalId;
      if (objectGlobalId === undefined) {
        found.push({ label: declared, objectGlobalId: undefined, cost: undefined, imported: false });
        continue;
      }

      const chosen = this.codex.objectNames.getName(objectGlobalId);
      found.push({
        label: chosen === declared ? chosen : `${declared} → ${chosen}`,
        objectGlobalId,
        cost: imported?.cost ?? this.costByObject.get(objectGlobalId),
        imported: imported !== undefined,
      });
    }
    return found;
  }

  /**
   * その型が手に入らないとき、足りていない入力。**最も惜しい工程**（足りない入力が最も少ない
   * 工程）のものを返す——どこで詰まっているかを1つに絞らないと、読み手が辿る先を決められない。
   * 手に入る型では空。
   */
  missingInputsFor(objectGlobalId: number): readonly string[] {
    if (this.costByObject.has(objectGlobalId)) return [];

    let best: string[] | undefined;
    for (const ref of this.steps) {
      if (!expectedSpawns(ref.step).has(objectGlobalId)) continue;

      const missing: string[] = [];
      for (const input of ref.step.inputs) {
        if (input.kind === 'object' && this.isAlwaysAtHand(input.objectGlobalId)) continue;
        if (this.cheapestCandidate(input) !== undefined) continue;
        if (this.importable(input) !== undefined) continue;
        missing.push(
          input.kind === 'tag'
            ? this.codex.tagNames.getName(input.tagGlobalId)
            : this.codex.objectNames.getName(input.objectGlobalId),
        );
      }
      if (best === undefined || missing.length < best.length) best = missing;
    }
    return best ?? [];
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
   * 他の土地から持ち込んだ場合の入力。**型を選ばない**——Aの土地で集めた材料とBの土地で集めた
   * 材料を合わせて作るのは普通の遊び方であって、不可能な経路ではない（issue #562）。
   *
   * 島全体の文脈そのものではundefined（自分が答えなので、持ち込むという概念が無い）。
   */
  private importable(
    input: CraftingStep['inputs'][number],
  ): { readonly objectGlobalId: number; readonly cost: Cost } | undefined {
    const island = this.islandWide;
    if (island === undefined) return undefined;

    let best: { objectGlobalId: number; cost: Cost } | undefined;
    for (const objectGlobalId of this.candidatesOf(input)) {
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

  /**
   * 入力1件を満たすのに最も安い値段。この土地で手に入らなければ、他の土地から持ち込んだものとして
   * 島全体の値段を使う——**入手できるかの判定は島全体でだけ行う**（issue #562）。島のどこにも
   * 無ければundefined。
   */
  private inputCost(input: CraftingStep['inputs'][number]): StepCost | undefined {
    const local = this.cheapestCandidate(input);
    if (local !== undefined) {
      const cost = this.costByObject.get(local);
      if (cost !== undefined) return { cost, imported: this.importedByObject.get(local) === true };
    }
    const imported = this.importable(input);
    return imported === undefined ? undefined : { cost: imported.cost, imported: true };
  }

  /** 入力1件を満たしうる型のグローバルID（タグ指定なら、そのタグを持つ型すべて）。 */
  private candidatesOf(input: CraftingStep['inputs'][number]): readonly number[] {
    if (input.kind === 'object') return [input.objectGlobalId];

    const found: number[] = [];
    for (const def of this.codex.objects) if (def.hasTag(input.tagGlobalId)) found.push(def.globalId);
    return found;
  }

  private relax(): void {
    for (let pass = 0; pass <= this.codex.objects.count; pass++) {
      let improved = false;
      for (const ref of this.steps) {
        const resolved = this.stepCost(ref);
        if (resolved === undefined) continue;

        for (const [objectGlobalId, count] of expectedSpawns(ref.step)) {
          if (count <= 0) continue;
          const candidate = scaleCost(resolved.cost, 1 / count);
          const known = this.costByObject.get(objectGlobalId);
          if (known !== undefined && totalOf(known) <= totalOf(candidate) + EPSILON) continue;

          this.costByObject.set(objectGlobalId, candidate);
          this.importedByObject.set(objectGlobalId, resolved.imported);
          this.viaStep.set(objectGlobalId, ref);
          improved = true;
        }
      }
      if (!improved) return;
    }
  }
}
