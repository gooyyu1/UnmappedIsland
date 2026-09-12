import type {
  ConditionDeclaration,
  ConditionReader,
  PropertyConditionReading,
} from '../domain/ConditionReader';
import type {
  ConditionalReading,
  DeclaredNumberReading,
  EffectReader,
  PickReading,
  SetValueReading,
} from '../domain/EffectReader';
import type { ObjectDef } from '../domain/ObjectDef';
import type { ObjectRefReading } from '../domain/ObjectRef';
import type { PassivePropertyReading, PassiveReader } from '../domain/PassiveReader';
import type { PropertyDef } from '../domain/PropertyDef';
import type { ReferenceRoot } from '../domain/ReferenceRoot';
import type { TypeMatchReading } from '../domain/TypeMatchRule';
import type { WorldCodex } from '../domain/WorldCodex';
import type { DailyLabour } from './balanceTables';
import type { StepOutcome } from './CraftingStep';
import { craftingStepsOf } from './craftingSteps';
import { rangeEventReadouts } from './rangeEvents';
import { stageModifyDeltasOf } from './stageModifiers';
import type { ObjectGlobalId, PropertyGlobalId, SlotGlobalId, TagGlobalId } from '../domain/GlobalId';

/**
 * 航海（`docs/world/Voyage.md` 3節）を**区間に割って測る**。答えるのは「通して渡ると何日かかるか」と
 * 「1区間で何が返るか」の2つで、どちらも定義（`voyage.yaml`・`core.yaml`）だけから出る——海区の網も
 * 見張りの回数も横断時間も宣言そのものなので、実際に遊ぶ必要が無い。
 *
 * 引く線は次のとおり。
 *
 * - **筏の側の事情（`sail_speed`）は乗せない。** 海流・積載・帆はどれも「どう積んだか」で決まるので、
 *   ここが出すのは素の横断時間だけ。**風は乗せる**——風は筏ではなく航路が持ち（3.2節）、積み方に
 *   よらないので、同じ航海の幅としてそのまま出せる。
 * - **荒天の押し流しと引き返しは数えない。** どちらも何区間ぶん動くかが実行時にしか決まらない
 *   （3.8節・3.5節）ので、ここが出すのはそれらが起きなかった場合の下限になる。
 * - **釣りや拾い物に費やす時間は数えない。** 渡るのに要る時間と、渡りながら何が返るかは別の問いで、
 *   後者は見張り1回あたりの割合として出す。
 * - **読み方が定義とずれたら投げる。** 宣言の形（航路が行き先を型で書く・風の受け方が向きと風向きの
 *   条件で分かれる）を当てにして読むので、当てが外れたまま小さい数を返すと、測っていないものが
 *   測った値として出る。
 */

/** 辺がどちらへ伸びているか（`Voyage.md` 3.2節「航路が風をどう受けるか」）。 */
export type LegDirection = 'toward_mainland' | 'toward_offshore';

const LEG_DIRECTIONS: readonly LegDirection[] = ['toward_mainland', 'toward_offshore'];

/** 見張り1回が返すもの1つ。 */
export interface SeaFind {
  readonly objectName: string;

  /** 見張り1回あたりの期待個数（卓の重みから出した確率×個数の和）。 */
  readonly expectedPerLookout: number;

  /**
   * 手に入るのではなく海区へ立つもの（魚の群れ・海鳥の群れ、3.3節）か。**設置物かどうかで見分ける**
   * ——`spawn` の配置先は読み上げに残らない（`EffectReader`）が、立つものはどれも設置物なので、
   * 型の側の事実で同じ線が引ける。
   */
  readonly spawnsIntoZone: boolean;
}

/** その海区から出る辺1本。 */
export interface SeaLeg {
  readonly routeName: string;
  readonly destinationName: string;

  /** 行き先が名乗る「本土まであと何海区か」（航路の `destination_zones_to_mainland`）。 */
  readonly destinationZonesToMainland: number;
  readonly direction: LegDirection;
}

/** 海区1つ。 */
export interface SeaZoneReading {
  readonly name: string;

  /** その海区から本土まで、その海区を含めて最短で何区間か。 */
  readonly zonesToMainland: number;

  /** 航路が現れるまでの見張りの回数（`exploration_progress` の上限）と、その合計時間（分）。 */
  readonly lookouts: number;
  readonly lookoutMinutes: number;

  /** 素の横断時間（分）。筏の側の事情も風も乗せていない。 */
  readonly crossingMinutes: number;

  /** 荒天にさらされてから押し流されるまで（tick）。 */
  readonly stormDriftTicks: number;

  /** 見張り1回のうち、何も返らない割合・拾えるものが返る割合・湧くものが立つ割合。和は1。 */
  readonly barrenShare: number;
  readonly foragedShare: number;
  readonly spawnedShare: number;

  /** 航路が現れるまでの見張りの間に、湧くものが1度以上立つ割合。 */
  readonly spawnedBySighting: number;

  readonly finds: readonly SeaFind[];
  readonly legs: readonly SeaLeg[];
}

/** 風が1区間へ乗せる量（`sea_route` の passives）。 */
export interface WindLeg {
  readonly wind: string;
  readonly direction: LegDirection;

  /** その風がその向きの辺の横断時間へ乗せる分（分）。負なら短く渡れる。 */
  readonly minutes: number;
}

/** 1つの針路の合計。 */
export interface CourseTotal {
  readonly totalMinutes: number;
  readonly days: number;
}

/** 出航地点1つから本土まで渡り切る針路1本。 */
export interface VoyageCourse {
  readonly coastName: string;
  readonly startZoneName: string;

  /** 分かれ道で遠回りを選ぶ針路か。最も区間の少ない針路が偽。 */
  readonly detour: boolean;

  /** 通る海区（出航地点に立つ海区から、本土の手前の海区まで）。 */
  readonly zoneNames: readonly string[];

  /** 渡る回数。通る海区の数と同じ（最後の1本が本土へ着く）。 */
  readonly legs: number;

  readonly lookouts: number;
  readonly lookoutMinutes: number;

  /** 素の横断時間の合計（分）。 */
  readonly crossingMinutes: number;

  /** 見張りと素の横断の合計。 */
  readonly total: CourseTotal;

  /** 同じ風が通しで吹いた場合の合計（風の綴り → 合計）。 */
  readonly byWind: ReadonlyMap<string, CourseTotal>;

  /** 季節が配る風の重みで期待した合計（季節の段の名前 → 合計）。 */
  readonly bySeason: ReadonlyMap<string, CourseTotal>;
}

/** 航海を区間に割って測ったもの。 */
export interface VoyageLegs {
  /** 海区（宣言順）。 */
  readonly zones: readonly SeaZoneReading[];

  /** 風が1区間へ乗せる量（風の宣言順 × 辺の向き）。 */
  readonly windLegs: readonly WindLeg[];

  /** 出航地点 × 針路（出航地点は宣言順、針路は区間の少ない順）。 */
  readonly courses: readonly VoyageCourse[];

  /** 1日ぶんの自由時間（分）。日数の分母。 */
  readonly dailyFreeMinutes: number;
}

/**
 * 出航の操作（`voyage.yaml` の筏）。**海岸がどの海区に面しているかを言うのはこの卓**——海岸の側は
 * 重みしか持たないので、どの重みがどの海区を指すのかは卓を読まないと出ない。
 */
const SET_SAIL = 'set_sail';

/** 海岸を名乗るタグ（`voyage.yaml` の coast trait）。 */
const COAST_TAG = 'coast';

/** 世界が持つ風向きと、その残り時間（`core.yaml`）。残り時間が尽きるたびに次の風を引く。 */
const WIND_PROPERTY = 'wind';
const WIND_REMAINING_PROPERTY = 'wind_remaining';

/** 季節（`core.yaml`）。段が風向きの重みを配る。 */
const SEASON_PROPERTY = 'season';

/** 海区と航路が持つ、距離と時間のつまみ（`voyage.yaml`）。 */
const ZONES_TO_MAINLAND_PROPERTY = 'zones_to_mainland';
const CROSSING_MINUTES_PROPERTY = 'crossing_minutes';
const STORM_DRIFT_PROPERTY = 'storm_drift';
const DESTINATION_ZONE_PROPERTY = 'destination_zone';
const DESTINATION_ZONES_TO_MAINLAND_PROPERTY = 'destination_zones_to_mainland';

export function voyageLegsOf(codex: WorldCodex, labour: DailyLabour): VoyageLegs {
  const ids = idsOf(codex);
  const routes = routeDestinationsOf(codex, ids);
  const zones = zoneReadingsOf(codex, ids, routes);
  const winds = windDrawOf(codex, ids);
  const windByRoute = windMinutesByRouteOf(codex, ids, routes, winds);

  return {
    zones,
    windLegs: windLegsOf(winds, windByRoute),
    courses: coursesOf(codex, ids, zones, windByRoute, seasonWindSharesOf(codex, ids, winds), labour),
    dailyFreeMinutes: labour.surplusMinutes,
  };
}

/** この解析が名前で引くもの。**引けなければ投げる**——読み方が定義とずれたまま0行を返さないため。 */
interface VoyageIds {
  readonly seaTagId: TagGlobalId;
  readonly coastTagId: TagGlobalId;
  readonly fixtureTagId: TagGlobalId;
  readonly explorationProgressId: PropertyGlobalId;
  readonly zonesToMainlandId: PropertyGlobalId;
  readonly crossingMinutesId: PropertyGlobalId;
  readonly stormDriftId: PropertyGlobalId;
  readonly destinationZoneId: PropertyGlobalId;
  readonly destinationZonesToMainlandId: PropertyGlobalId;
  readonly windId: PropertyGlobalId;
  readonly windRemainingId: PropertyGlobalId;
  readonly seasonId: PropertyGlobalId;
  readonly exploreAction: string;
}

function idsOf(codex: WorldCodex): VoyageIds {
  const { world } = codex.vocabulary;
  return {
    seaTagId: world.seaTagId,
    coastTagId: codex.tagNames.getId(COAST_TAG),
    fixtureTagId: world.fixtureTagId,
    explorationProgressId: world.explorationProgressId,
    zonesToMainlandId: codex.propertyNames.getId(ZONES_TO_MAINLAND_PROPERTY),
    crossingMinutesId: codex.propertyNames.getId(CROSSING_MINUTES_PROPERTY),
    stormDriftId: codex.propertyNames.getId(STORM_DRIFT_PROPERTY),
    destinationZoneId: codex.propertyNames.getId(DESTINATION_ZONE_PROPERTY),
    destinationZonesToMainlandId: codex.propertyNames.getId(DESTINATION_ZONES_TO_MAINLAND_PROPERTY),
    windId: codex.propertyNames.getId(WIND_PROPERTY),
    windRemainingId: codex.propertyNames.getId(WIND_REMAINING_PROPERTY),
    seasonId: codex.propertyNames.getId(SEASON_PROPERTY),
    exploreAction: world.exploreAction,
  };
}

/** 航路の型1つ。 */
interface RouteReading {
  readonly def: ObjectDef;
  readonly destinationName: string;
  readonly destinationZonesToMainland: number;
}

/**
 * 行き先を型で書いている航路（`destination_zone`）の一覧。**島の海岸へ戻る航路は入らない**——行き先が
 * 型ではなく個体なので、型の名前では指せない（`voyage.yaml` の route_to_shore）。
 */
function routeDestinationsOf(codex: WorldCodex, ids: VoyageIds): ReadonlyMap<ObjectGlobalId, RouteReading> {
  const routes = new Map<ObjectGlobalId, RouteReading>();
  for (const def of codex.objects) {
    const destination = def.tryGetPropertyDef(ids.destinationZoneId);
    if (destination === undefined) continue;

    const destinationName = codex.tryObjectNameOfPropertyValue(destination.initialValueAt('lowest'));
    if (destinationName === undefined)
      throw new Error(`航路 '${def.name}' の ${DESTINATION_ZONE_PROPERTY} が型を指していません。`);

    routes.set(def.globalId, {
      def,
      destinationName,
      destinationZonesToMainland: declaredValueOf(def, ids.destinationZonesToMainlandId),
    });
  }
  if (routes.size === 0) throw new Error('行き先を型で書いている航路が1つもありません。');
  return routes;
}

/** 海区（`sea` タグを持ち、見張れる型）を宣言順に測る。 */
function zoneReadingsOf(
  codex: WorldCodex,
  ids: VoyageIds,
  routes: ReadonlyMap<ObjectGlobalId, RouteReading>,
): readonly SeaZoneReading[] {
  const zones: SeaZoneReading[] = [];
  for (const def of codex.objects) {
    const progress = def.tryGetPropertyDef(ids.explorationProgressId);
    if (!def.hasTag(ids.seaTagId) || progress === undefined) continue;
    zones.push(zoneReadingOf(codex, ids, routes, def, progress));
  }
  if (zones.length === 0) throw new Error('見張れる海区が1つもありません。');
  return zones;
}

function zoneReadingOf(
  codex: WorldCodex,
  ids: VoyageIds,
  routes: ReadonlyMap<ObjectGlobalId, RouteReading>,
  def: ObjectDef,
  progress: PropertyDef,
): SeaZoneReading {
  const explore = craftingStepsOf(codex, def).find(
    (step) => step.kind === 'interaction' && step.name === ids.exploreAction,
  );
  if (explore === undefined) throw new Error(`海区 '${def.name}' が見張りを宣言していません。`);

  const range = progress.range;
  if (range === undefined) throw new Error(`海区 '${def.name}' の見張りに上限がありません。`);

  const zonesToMainland = declaredValueOf(def, ids.zonesToMainlandId);
  const yields = yieldsOf(codex, ids, explore.outcomes);
  const lookouts = range.max;

  return {
    name: def.name,
    zonesToMainland,
    lookouts,
    lookoutMinutes: lookouts * explore.laborMinutes,
    crossingMinutes: declaredValueOf(def, ids.crossingMinutesId),
    stormDriftTicks: rangeMaxOf(def, ids.stormDriftId),
    ...yields,
    spawnedBySighting: 1 - (1 - yields.spawnedShare) ** lookouts,
    legs: legsOf(routes, def, progress, zonesToMainland),
  };
}

/** 見張りの卓を、返るものの側から読んだもの。 */
interface SeaYields {
  readonly barrenShare: number;
  readonly foragedShare: number;
  readonly spawnedShare: number;
  readonly finds: readonly SeaFind[];
}

/** 見張り1回の卓。**分けるのは「何も返らない／手に入る／海区へ立つ」の3つ**。 */
function yieldsOf(codex: WorldCodex, ids: VoyageIds, outcomes: readonly StepOutcome[]): SeaYields {
  let barrenShare = 0;
  let spawnedShare = 0;
  const expected = new Map<ObjectGlobalId, number>();
  const intoZone = new Set<ObjectGlobalId>();

  for (const outcome of outcomes) {
    if (outcome.spawns.length === 0) {
      barrenShare += outcome.probability;
      continue;
    }

    let standsInZone = false;
    for (const spawn of outcome.spawns) {
      expected.set(
        spawn.objectGlobalId,
        (expected.get(spawn.objectGlobalId) ?? 0) + outcome.probability * spawn.count,
      );
      if (!codex.objects.get(spawn.objectGlobalId).hasTag(ids.fixtureTagId)) continue;
      standsInZone = true;
      intoZone.add(spawn.objectGlobalId);
    }
    if (standsInZone) spawnedShare += outcome.probability;
  }

  return {
    barrenShare,
    foragedShare: 1 - barrenShare - spawnedShare,
    spawnedShare,
    // **卓に並んでいても重みが0なら落とす**——素の重みは0で、海区が名乗らなかった候補はその海には
    // 無い（3.3節）。落とさないと、どの海区も卓の全候補を並べたまま、無いものと在るものが同じ顔で並ぶ。
    finds: [...expected]
      .filter(([, expectedPerLookout]) => expectedPerLookout > 0)
      .map(([objectGlobalId, expectedPerLookout]) => ({
        objectName: codex.objects.get(objectGlobalId).name,
        expectedPerLookout,
        spawnsIntoZone: intoZone.has(objectGlobalId),
      })),
  };
}

/**
 * その海区から出る辺。**見張り切ったときに湧く航路がそのまま辺**（3節）で、**折り返しの1本は落とす**
 * ——見張りは辺の両端へ1本ずつ立てるので、湧く航路には隣へ置く「この海区への航路」も混じる。
 * 行き先が自分である航路がそれにあたる。
 */
function legsOf(
  routes: ReadonlyMap<ObjectGlobalId, RouteReading>,
  def: ObjectDef,
  progress: PropertyDef,
  zonesToMainland: number,
): readonly SeaLeg[] {
  const legs: SeaLeg[] = [];
  const seen = new Set<ObjectGlobalId>();
  for (const readout of rangeEventReadouts(progress, () => undefined)) {
    if (readout.label !== 'on_max') continue;
    for (const outcome of readout.outcomes)
      for (const spawn of outcome.spawns) {
        const route = routes.get(spawn.objectGlobalId);
        if (route === undefined || route.destinationName === def.name) continue;
        if (seen.has(spawn.objectGlobalId)) continue;
        seen.add(spawn.objectGlobalId);
        legs.push({
          routeName: route.def.name,
          destinationName: route.destinationName,
          destinationZonesToMainland: route.destinationZonesToMainland,
          direction:
            route.destinationZonesToMainland < zonesToMainland ? 'toward_mainland' : 'toward_offshore',
        });
      }
  }
  return legs;
}

/** 風向き1つと、それを引く重みのつまみ（`core.yaml` の `wind_remaining` の卓）。 */
interface WindDraw {
  readonly wind: string;
  readonly weightPropertyGlobalId: PropertyGlobalId;
}

/**
 * 風向きの一覧（宣言順）。**卓から読む**——風の綴りと、その風を引く重みのつまみの対応は卓にしか無く、
 * つまみの名前から綴りを切り出すと、名前の付け方が変わった日に黙って外れる。
 */
function windDrawOf(codex: WorldCodex, ids: VoyageIds): readonly WindDraw[] {
  const world = codex.objects.get(codex.objectNames.getId(codex.vocabulary.world.worldObject));
  const remaining = world.tryGetPropertyDef(ids.windRemainingId);
  if (remaining === undefined) throw new Error(`world が ${WIND_REMAINING_PROPERTY} を宣言していません。`);

  const draws: WindDraw[] = [];
  for (const [, effect] of remaining.rangeEvents())
    for (const candidate of pickCandidatesOf((reader) => effect.read(reader))) {
      const assigned = candidate.setValues.get(ids.windId);
      if (candidate.weightPropertyGlobalId === undefined || assigned === undefined) continue;

      const wind = codex.trySymbolNameOfPropertyValue(assigned);
      if (wind === undefined) throw new Error(`風向きの卓が ${WIND_PROPERTY} にシンボルを代入していません。`);
      draws.push({ wind, weightPropertyGlobalId: candidate.weightPropertyGlobalId });
    }

  if (draws.length === 0) throw new Error('風向きを引く卓が読めません。');
  return draws;
}

/** 航路ごとの、風と辺の向きの組に対する寄与（分）。 */
type WindMinutes = ReadonlyMap<string, number>;

function windKey(wind: string, direction: LegDirection): string {
  return `${wind}:${direction}`;
}

/**
 * 航路の型ごとに、風がその辺の横断時間へ乗せる分を読む。**航路1本で代表しない**——受け方は
 * `sea_route` trait が1箇所で持つが、型ごとに書き足せる以上、代表すると書き足した日に測り落とす。
 */
function windMinutesByRouteOf(
  codex: WorldCodex,
  ids: VoyageIds,
  routes: ReadonlyMap<ObjectGlobalId, RouteReading>,
  winds: readonly WindDraw[],
): ReadonlyMap<ObjectGlobalId, WindMinutes> {
  const byRoute = new Map<ObjectGlobalId, WindMinutes>();
  for (const [globalId, route] of routes) {
    const collector = new WindModifyCollector(codex, ids, winds);
    route.def.passives.read(collector);
    byRoute.set(globalId, collector.minutes);
  }
  return byRoute;
}

/** 風が乗せる分の一覧（風の宣言順 × 辺の向き）。航路どうしで食い違えば投げる。 */
function windLegsOf(
  winds: readonly WindDraw[],
  byRoute: ReadonlyMap<ObjectGlobalId, WindMinutes>,
): readonly WindLeg[] {
  const legs: WindLeg[] = [];
  for (const { wind } of winds)
    for (const direction of LEG_DIRECTIONS) {
      const key = windKey(wind, direction);
      const values = new Set([...byRoute.values()].map((minutes) => minutes.get(key) ?? 0));
      if (values.size > 1)
        throw new Error(`風 '${wind}' の受け方が航路ごとに違います（${[...values].join('・')}）。`);
      legs.push({ wind, direction, minutes: [...values].at(0) ?? 0 });
    }
  return legs;
}

/** 季節の段ごとの、風向きの割合。 */
function seasonWindSharesOf(
  codex: WorldCodex,
  ids: VoyageIds,
  winds: readonly WindDraw[],
): ReadonlyMap<string, ReadonlyMap<string, number>> {
  const world = codex.objects.get(codex.objectNames.getId(codex.vocabulary.world.worldObject));

  const weights = new Map<string, Map<string, number>>();
  for (const { wind, weightPropertyGlobalId } of winds)
    for (const [season, weight] of stageModifyDeltasOf(world, weightPropertyGlobalId, ids.seasonId)) {
      const bySeason = weights.get(season) ?? new Map<string, number>();
      weights.set(season, bySeason);
      bySeason.set(wind, weight);
    }
  if (weights.size === 0) throw new Error('季節が風向きの重みを配っていません。');

  const shares = new Map<string, ReadonlyMap<string, number>>();
  for (const [season, bySeason] of weights) {
    const total = [...bySeason.values()].reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) throw new Error(`季節 '${season}' の風向きの重みが全て0です。`);
    shares.set(season, new Map([...bySeason].map(([wind, weight]) => [wind, weight / total])));
  }
  return shares;
}

/** 出航地点1つ（海岸の型と、そこから立つ海区）。 */
interface Departure {
  readonly coastName: string;
  readonly zoneName: string;
}

/** 出航の卓から、海岸ごとの立つ海区を読む。 */
function departuresOf(codex: WorldCodex, ids: VoyageIds): readonly Departure[] {
  const raft = [...codex.objects].find((def) => def.declaresInteraction(SET_SAIL));
  if (raft === undefined) throw new Error(`${SET_SAIL} を宣言している型がありません。`);

  const trigger = raft.triggers.find(({ interaction }) => interaction.name === SET_SAIL);
  if (trigger === undefined) throw new Error(`${SET_SAIL} の宣言が読めません。`);

  const zoneByWeight = new Map<PropertyGlobalId, string>();
  for (const candidate of pickCandidatesOf((reader) => trigger.interaction.read(reader))) {
    const zone = candidate.movedToObjectGlobalIds.at(0);
    if (candidate.weightPropertyGlobalId === undefined || zone === undefined) continue;
    zoneByWeight.set(candidate.weightPropertyGlobalId, codex.objects.get(zone).name);
  }
  if (zoneByWeight.size === 0) throw new Error(`${SET_SAIL} の卓から立つ海区が読めません。`);

  const departures: Departure[] = [];
  for (const def of codex.objects) {
    if (!def.hasTag(ids.coastTagId)) continue;
    for (const [weightPropertyGlobalId, zoneName] of zoneByWeight)
      if ((def.tryGetPropertyDef(weightPropertyGlobalId)?.initialValueAt('lowest') ?? 0) > 0)
        departures.push({ coastName: def.name, zoneName });
  }
  if (departures.length === 0) throw new Error('どの海岸も面している海区を名乗っていません。');
  return departures;
}

function coursesOf(
  codex: WorldCodex,
  ids: VoyageIds,
  zones: readonly SeaZoneReading[],
  windByRoute: ReadonlyMap<ObjectGlobalId, WindMinutes>,
  seasonShares: ReadonlyMap<string, ReadonlyMap<string, number>>,
  labour: DailyLabour,
): readonly VoyageCourse[] {
  const byName = new Map(zones.map((zone) => [zone.name, zone]));
  const routeIdByName = new Map<string, ObjectGlobalId>();
  for (const zone of zones)
    for (const leg of zone.legs) routeIdByName.set(leg.routeName, codex.objectNames.getId(leg.routeName));

  const courses: VoyageCourse[] = [];
  for (const departure of departuresOf(codex, ids)) {
    const paths = pathsToMainlandFrom(byName, departure.zoneName);
    if (paths.length > 2)
      throw new Error(
        `${departure.zoneName} から本土まで針路が${paths.length}本あります（近道と遠回りの2本を前提にした名前では足りません）。`,
      );

    for (const [index, path] of paths.entries())
      courses.push(
        courseOf(departure, path, index > 0, byName, routeIdByName, windByRoute, seasonShares, labour),
      );
  }
  return courses;
}

/**
 * その海区から本土まで、同じ海区を二度通らない道すじを全部。**短い順**に並べる。
 *
 * 辺は「見張り切って湧く航路」だけなので、どの海区も自分から先へ出る辺しか持たない
 * （戻る1本は隣が立てる）。それでも通った海区を覚えるのは、**網が閉じたときに止まらないため**。
 */
function pathsToMainlandFrom(
  zones: ReadonlyMap<string, SeaZoneReading>,
  start: string,
): readonly (readonly string[])[] {
  const paths: string[][] = [];
  const walk = (name: string, walked: readonly string[]): void => {
    const zone = zones.get(name);
    if (zone === undefined) {
      paths.push([...walked]);
      return;
    }
    if (walked.includes(name)) throw new Error(`海区の網が ${name} で閉じています。`);
    for (const leg of zone.legs) walk(leg.destinationName, [...walked, name]);
  };
  walk(start, []);

  if (paths.length === 0) throw new Error(`${start} から本土へ着く針路がありません。`);
  return paths.sort((a, b) => a.length - b.length);
}

function courseOf(
  departure: Departure,
  zoneNames: readonly string[],
  detour: boolean,
  zones: ReadonlyMap<string, SeaZoneReading>,
  routeIdByName: ReadonlyMap<string, ObjectGlobalId>,
  windByRoute: ReadonlyMap<ObjectGlobalId, WindMinutes>,
  seasonShares: ReadonlyMap<string, ReadonlyMap<string, number>>,
  labour: DailyLabour,
): VoyageCourse {
  let lookouts = 0;
  let lookoutMinutes = 0;
  let crossingMinutes = 0;

  /** 風ごとの横断時間の合計（見張りは風で動かない）。 */
  const crossingByWind = new Map<string, number>();

  for (const [index, name] of zoneNames.entries()) {
    const zone = zones.get(name);
    if (zone === undefined) throw new Error(`海区 '${name}' が読めません。`);

    lookouts += zone.lookouts;
    lookoutMinutes += zone.lookoutMinutes;
    crossingMinutes += zone.crossingMinutes;

    const next = zoneNames.at(index + 1);
    const leg = zone.legs.find((candidate) =>
      next === undefined ? !zones.has(candidate.destinationName) : candidate.destinationName === next,
    );
    if (leg === undefined) throw new Error(`海区 '${name}' から先へ出る辺が読めません。`);

    const windMinutes = windByRoute.get(routeIdByName.get(leg.routeName)!);
    if (windMinutes === undefined) throw new Error(`航路 '${leg.routeName}' の風の受け方が読めません。`);

    for (const key of windMinutes.keys()) {
      const [wind, direction] = key.split(':');
      if (direction !== leg.direction) continue;
      crossingByWind.set(
        wind,
        (crossingByWind.get(wind) ?? 0) + zone.crossingMinutes + (windMinutes.get(key) ?? 0),
      );
    }
  }

  const totalOf = (minutes: number): CourseTotal => ({
    totalMinutes: minutes,
    days: minutes / labour.surplusMinutes,
  });

  return {
    coastName: departure.coastName,
    startZoneName: departure.zoneName,
    detour,
    zoneNames,
    legs: zoneNames.length,
    lookouts,
    lookoutMinutes,
    crossingMinutes,
    total: totalOf(lookoutMinutes + crossingMinutes),
    byWind: new Map([...crossingByWind].map(([wind, minutes]) => [wind, totalOf(lookoutMinutes + minutes)])),
    bySeason: new Map(
      [...seasonShares].map(([season, shares]) => [
        season,
        totalOf(
          lookoutMinutes +
            [...crossingByWind].reduce((sum, [wind, minutes]) => sum + minutes * (shares.get(wind) ?? 0), 0),
        ),
      ]),
    ),
  };
}

/** 宣言された値。そのプロパティを持たない型は投げる。 */
function declaredValueOf(def: ObjectDef, propertyGlobalId: PropertyGlobalId): number {
  const propertyDef = def.tryGetPropertyDef(propertyGlobalId);
  if (propertyDef === undefined) throw new Error(`'${def.name}' が要るつまみを宣言していません。`);
  return propertyDef.initialValueAt('lowest');
}

/** 宣言された range の上限。持たない型は投げる。 */
function rangeMaxOf(def: ObjectDef, propertyGlobalId: PropertyGlobalId): number {
  const range = def.tryGetPropertyDef(propertyGlobalId)?.range;
  if (range === undefined) throw new Error(`'${def.name}' が要る range を宣言していません。`);
  return range.max;
}

/** `pick` の候補1つを、重みのつまみ・移動先の型・代入だけに畳んだもの。 */
interface PickCandidateSummary {
  readonly weightPropertyGlobalId: PropertyGlobalId | undefined;
  readonly movedToObjectGlobalIds: readonly ObjectGlobalId[];
  readonly setValues: ReadonlyMap<PropertyGlobalId, number>;
}

function pickCandidatesOf(read: (reader: EffectReader) => void): readonly PickCandidateSummary[] {
  const reader = new EffectSummaryReader();
  read(reader);
  return reader.candidates;
}

/**
 * 効果の宣言から、卓の候補と、その候補が指す行き先・代入だけを拾う読み手。
 *
 * **行き先を型で指した `move`（9.6節）と、シンボルの代入だけを見る。** 出航がどの海区へ立たせるかも、
 * 風の卓がどの風を引くかも、その2つにしか書かれていない。
 */
class EffectSummaryReader implements EffectReader {
  readonly candidates: PickCandidateSummary[] = [];
  readonly movedToObjectGlobalIds: ObjectGlobalId[] = [];
  readonly setValues = new Map<PropertyGlobalId, number>();

  set(target: ReferenceRoot, propertyGlobalId: PropertyGlobalId, value: SetValueReading): void {
    if (target === 'self' && typeof value === 'number') this.setValues.set(propertyGlobalId, value);
  }

  move(_subject: ObjectRefReading, destination: ObjectRefReading): void {
    if (destination.kind === 'object') this.movedToObjectGlobalIds.push(destination.objectGlobalId);
  }

  pick(reading: PickReading): void {
    reading.forEachCandidate((candidate) => {
      const inner = new EffectSummaryReader();
      candidate.effect.read(inner);
      this.candidates.push({
        weightPropertyGlobalId: weightPropertyOf(candidate.weight),
        movedToObjectGlobalIds: inner.movedToObjectGlobalIds,
        setValues: inner.setValues,
      });
    });
  }

  conditional(reading: ConditionalReading): void {
    reading.readEveryBranch(this);
  }

  add(): void {}

  spawn(): void {}

  destroy(): void {}

  become(): void {}

  transfer(): void {}

  signal(): void {}
}

function weightPropertyOf(weight: DeclaredNumberReading): PropertyGlobalId | undefined {
  return weight.kind === 'property' ? weight.propertyGlobalId : undefined;
}

/**
 * 航路が宣言する、横断時間への風の寄与を集める読み手。**風向きと辺の向きは条件から読む**——
 * どちらも条件にしか書かれていないので、条件が読めなければ投げる。
 */
class WindModifyCollector implements PassiveReader {
  readonly minutes = new Map<string, number>();

  constructor(
    private readonly codex: WorldCodex,
    private readonly ids: VoyageIds,
    private readonly winds: readonly WindDraw[],
  ) {}

  modify(reading: PassivePropertyReading): void {
    if (reading.target !== 'self' || reading.propertyGlobalId !== this.ids.crossingMinutesId) return;
    if (reading.amount.kind !== 'fixed')
      throw new Error('航路の横断時間へ、定数でない寄与が宣言されています。');

    const gate = windGateOf(this.codex, this.ids, reading.gate.conditions);
    for (const { wind } of this.winds) {
      if (gate.wind !== undefined && gate.wind !== wind) continue;
      for (const direction of gate.directions) {
        const key = windKey(wind, direction);
        this.minutes.set(key, (this.minutes.get(key) ?? 0) + reading.amount.value);
      }
    }
  }

  accumulate(): void {}

  transfer(): void {}
}

/** 寄与が効く場面（風向きと辺の向き）。風を名乗らない寄与はどの風でも効く。 */
interface WindGate {
  readonly wind: string | undefined;
  readonly directions: readonly LegDirection[];
}

function windGateOf(
  codex: WorldCodex,
  ids: VoyageIds,
  conditions: ConditionDeclaration | undefined,
): WindGate {
  if (conditions === undefined) return { wind: undefined, directions: LEG_DIRECTIONS };

  const reader = new WindGateReader(codex, ids);
  conditions.read(reader);
  if (reader.unreadable) throw new Error('航路の横断時間への寄与に、読めない条件が付いています。');
  return {
    wind: reader.wind,
    directions: reader.direction === undefined ? LEG_DIRECTIONS : [reader.direction],
  };
}

/** 何の風で、どちらへ伸びる辺に効く寄与かを読む。 */
class WindGateReader implements ConditionReader {
  wind: string | undefined;
  direction: LegDirection | undefined;
  unreadable = false;

  constructor(
    private readonly codex: WorldCodex,
    private readonly ids: VoyageIds,
  ) {}

  property(reading: PropertyConditionReading): void {
    const value = reading.values?.at(0);
    if (reading.propertyGlobalId === this.ids.windId && reading.op === 'eq' && value !== undefined) {
      this.wind = this.codex.trySymbolNameOfPropertyValue(value);
      if (this.wind === undefined) this.unreadable = true;
      return;
    }

    // 行き先の残り海区数と、今いる海区の残り海区数の比較が、そのまま辺の伸びる向き（3.2節）。
    if (
      reading.propertyGlobalId === this.ids.destinationZonesToMainlandId &&
      reading.valueRef?.propertyGlobalId === this.ids.zonesToMainlandId
    ) {
      if (reading.op === 'lt') this.direction = 'toward_mainland';
      else if (reading.op === 'gt') this.direction = 'toward_offshore';
      else this.unreadable = true;
      return;
    }

    this.unreadable = true;
  }

  all(children: readonly ConditionDeclaration[]): void {
    for (const child of children) child.read(this);
  }

  any(): void {
    this.unreadable = true;
  }

  not(): void {
    this.unreadable = true;
  }

  propertyStage(): void {
    this.unreadable = true;
  }

  slotPosition(_root: ReferenceRoot, _slotGlobalId: SlotGlobalId): void {
    this.unreadable = true;
  }

  slotContent(_root: ReferenceRoot, _slotGlobalId: SlotGlobalId, _match: TypeMatchReading): void {
    this.unreadable = true;
  }

  objectMatches(_root: ReferenceRoot, _match: TypeMatchReading): void {
    this.unreadable = true;
  }
}
