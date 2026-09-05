import type { IslandMap, Site } from '../domain/generation/IslandMap';
import type { ObjectDef } from '../domain/ObjectDef';
import type { WorldCodex } from '../domain/WorldCodex';
import type { CraftingStep } from './CraftingStep';
import { craftingStepsOf } from './craftingSteps';

/**
 * 生成された島を測って、**最初の段（ContentSkeleton.md 2.1節）を越えるのに要るものが、その地点から
 * 何歩先にあるか**を出す。
 *
 * 返すのは数値と識別子だけで、判定（この地点は初心者向けか・この散らばりは広すぎるか）は持たない。
 * しきい値を決めるのはこの数字が出てからで（同2.3.2節・2.3.3節）、道具の側が先に決めてしまうと、
 * 決める材料が道具の判定に汚染される。
 *
 * 引く線は次のとおり。**道は未発見でも数える**——判定するのは島の作りであってプレイヤーの進み具合では
 * ないので、道を見つけるのに要る探索時間は別の数として添える。**実行時にしか決まらないものは
 * 解かない**——探索の抽選は`pick`の期待値まで読み、どの回に何を引くかは数えない。
 */

/** 最初の段を越えるのに要るもの1つ（ContentSkeleton.md 2.3節の表の1行）。 */
export interface StartupNeed {
  /** レポートの見出しになる呼び名。 */
  readonly label: string;

  /**
   * これを満たす発見物の識別子。**どれか1つ採れれば満たす**——水はヤシの木でも湧き水でもよい。
   * どの土地でそれが採れるかは宣言せず、locations.yamlの`explore`から実測する。
   */
  readonly sourceObjectNames: readonly string[];
}

/**
 * 測る対象（ContentSkeleton.md 2.3節）。**1つの土地では揃わない**ことがこの表の要点で、
 * 荒野は火口・錐・刃を持つが軸が無く、砂浜は軸しか持たない。
 */
export const STARTUP_NEEDS: readonly StartupNeed[] = [
  { label: '火口', sourceObjectNames: ['dry_grass'] },
  { label: '錐', sourceObjectNames: ['twig'] },
  { label: '軸', sourceObjectNames: ['thick_branch'] },
  { label: '刃', sourceObjectNames: ['stone'] },
  { label: '水', sourceObjectNames: ['palm_tree', 'spring'] },
  { label: '道具の要らない食料', sourceObjectNames: ['water_spinach'] },
];

/** 要るもの1つが、ある土地の型で採れること。1回の探索あたりの期待個数を添える。 */
export interface NeedSourceRow {
  readonly needIndex: number;
  readonly locationDefName: string;
  readonly objectName: string;

  /** 1回の探索で見つかる期待個数（`pick`の重みから出した確率×個数の和）。 */
  readonly expectedPerExplore: number;
}

/** 探索できる土地の型1つが、要るものに対して持っているもの。 */
export interface LocationNeedSupply {
  readonly locationDefName: string;

  /** その土地で採れる要るもの（STARTUP_NEEDSの添字）。 */
  readonly needIndices: ReadonlySet<number>;

  /**
   * **その土地の道が全部出そろうまでの探索時間**（分）。探索の進捗が上限へ達する前にすべての道が
   * 見つかることが生成の不変条件（IslandSpawner）なので、`exploration_progress`の上限−1回の
   * 探索で足りる。
   */
  readonly pathDiscoveryMinutes: number;
}

/**
 * locations.yamlの`explore`から実測した出どころ表。定義は島をまたいで変わらないので、島ごとの
 * 算出はこれを使い回す。
 */
export interface StartupNeedSources {
  /** 一覧。並びは要るもの → 土地の型（どちらも宣言順）。 */
  readonly rows: readonly NeedSourceRow[];

  /** object_defのグローバルID → その土地の型の実測。 */
  readonly byLocationDef: ReadonlyMap<number, LocationNeedSupply>;
}

/** サイト1つから、要るもの1つへ届くまで。 */
export interface NeedReach {
  /** 歩数（たどる道の本数）。0はその土地自身で採れること。 */
  readonly hops: number;

  /** その経路の移動時間（分）。 */
  readonly travelMinutes: number;

  /**
   * その経路の道を見つけるのに要る探索時間（分）。**着いた先の探索は含まない**——ここが数えるのは
   * 道を見つける時間だけで、着いた先で目当ての物を引くまでの回数は数えない（引きの運）。
   */
  readonly pathDiscoveryMinutes: number;
}

/** サイト1つの立ち上がりやすさ。needsの並びはSTARTUP_NEEDSと同じで、届かないものはundefined。 */
export interface SiteReach {
  readonly siteIndex: number;
  readonly locationDefName: string;
  readonly needs: readonly (NeedReach | undefined)[];

  /** 島のどこをたどっても届かなかった要るものの数。 */
  readonly unreachableNeedCount: number;

  /**
   * 届いたものの中で**最も遠い**要るもの（歩数、同歩数なら移動時間で比べる）と、その添字。
   * 全部が揃うまでを1本の経路として表す数で、1つも届かないサイトではundefined。
   */
  readonly farthestNeed: NeedReach | undefined;
  readonly farthestNeedIndex: number | undefined;
}

/** 島1つ。 */
export interface IslandReach {
  readonly seed: number;
  readonly sites: readonly SiteReach[];

  /** 島のどの土地でも採れなかった要るもの（STARTUP_NEEDSの添字）。 */
  readonly missingNeedIndices: readonly number[];

  /**
   * **最も条件の良いサイト**。島は引き直さないので（ContentSkeleton.md 2.3.1節）、これがその周回の
   * 実際の立ち上がりになる。比べる順は「届かない数 → 最も遠い要るものの歩数 → その移動時間 →
   * その探索時間 → サイトのindex」で、良し悪しの判定ではなく順序の定義。
   */
  readonly bestSite: SiteReach;
}

/**
 * 要るものの出どころを、探索できる土地の型すべてについて実測する。
 *
 * 宣言した発見物がどの土地でも採れなければ投げる——出どころ表（ContentSkeleton.md 2.3節）と
 * locations.yamlが食い違ったまま数字だけが出ると、その数字は別の物を測っていることになる。
 */
export function startupNeedSourcesOf(codex: WorldCodex): StartupNeedSources {
  const generation = codex.generation;
  if (generation === undefined)
    throw new Error('地形生成の定義（terrain_generation.yaml）がロードされていません。');

  const sourceObjectIds = STARTUP_NEEDS.map((need) =>
    need.sourceObjectNames.map((name) => {
      const id = codex.objectNames.tryGetId(name);
      if (id === undefined) throw new Error(`要るものの出どころ '${name}' の型が定義されていません。`);
      return id;
    }),
  );

  const rows: NeedSourceRow[] = [];
  const byLocationDef = new Map<number, LocationNeedSupply>();

  for (const locationType of generation.locationTypes) {
    const locationDef = codex.objects.get(locationType.objectDefGlobalId);
    if (byLocationDef.has(locationDef.globalId)) continue;

    const explore = exploreStepOf(codex, locationDef);
    const expected = expectedSpawnsOf(explore);
    const needIndices = new Set<number>();
    for (const [needIndex, objectIds] of sourceObjectIds.entries())
      for (const [objectIndex, objectId] of objectIds.entries()) {
        const expectedPerExplore = expected.get(objectId) ?? 0;
        if (expectedPerExplore <= 0) continue;

        needIndices.add(needIndex);
        rows.push({
          needIndex,
          locationDefName: locationDef.name,
          objectName: STARTUP_NEEDS[needIndex].sourceObjectNames[objectIndex],
          expectedPerExplore,
        });
      }

    byLocationDef.set(locationDef.globalId, {
      locationDefName: locationDef.name,
      needIndices,
      pathDiscoveryMinutes: pathDiscoveryMinutesOf(codex, locationDef, explore),
    });
  }

  for (const [needIndex, need] of STARTUP_NEEDS.entries())
    if (!rows.some((row) => row.needIndex === needIndex))
      throw new Error(`要るもの '${need.label}' を採れる土地が1つもありません。`);

  rows.sort((a, b) => a.needIndex - b.needIndex);
  return { rows, byLocationDef };
}

/** 生成された島1つを測る。 */
export function islandReachOf(sources: StartupNeedSources, map: IslandMap): IslandReach {
  const supplies = map.sites.map((site) => supplyOf(sources, site));
  const providers = supplies.map((supply) => supply.needIndices);
  const departureMinutes = supplies.map((supply) => supply.pathDiscoveryMinutes);

  const neighbors: { other: number; travelMinutes: number }[][] = map.sites.map(() => []);
  for (const edge of map.edges) {
    neighbors[edge.a].push({ other: edge.b, travelMinutes: edge.travelMinutes });
    neighbors[edge.b].push({ other: edge.a, travelMinutes: edge.travelMinutes });
  }

  const sites = map.sites.map((site) =>
    siteReachOf(site.index, supplies[site.index].locationDefName, providers, departureMinutes, neighbors),
  );

  const missingNeedIndices = STARTUP_NEEDS.map((_, needIndex) => needIndex).filter((needIndex) =>
    providers.every((needIndices) => !needIndices.has(needIndex)),
  );

  return { seed: map.seed, sites, missingNeedIndices, bestSite: bestSiteOf(sites) };
}

function supplyOf(sources: StartupNeedSources, site: Site): LocationNeedSupply {
  const supply = sources.byLocationDef.get(site.type!.objectDefGlobalId);
  if (supply === undefined)
    throw new Error(`サイト ${site.index} の土地の型が、出どころ表に載っていません。`);
  return supply;
}

/** サイト1つから見た、要るものそれぞれへの最短。 */
function siteReachOf(
  from: number,
  locationDefName: string,
  providers: readonly ReadonlySet<number>[],
  departureMinutes: readonly number[],
  neighbors: readonly { other: number; travelMinutes: number }[][],
): SiteReach {
  const byHops = routeCostsByHopsFrom(from, departureMinutes, neighbors);
  const needs = STARTUP_NEEDS.map((_, needIndex) => nearestProvider(byHops, providers, needIndex));

  let farthest: NeedReach | undefined;
  let farthestNeedIndex: number | undefined;
  for (const [needIndex, need] of needs.entries())
    if (need !== undefined && (farthest === undefined || isFarther(need, farthest))) {
      farthest = need;
      farthestNeedIndex = needIndex;
    }

  return {
    siteIndex: from,
    locationDefName,
    needs,
    unreachableNeedCount: needs.filter((need) => need === undefined).length,
    farthestNeed: farthest,
    farthestNeedIndex,
  };
}

/** 経路1本の重み。歩数はこの型の外（byHopsの添字）が持つ。 */
interface RouteCost {
  readonly travelMinutes: number;
  readonly pathDiscoveryMinutes: number;
}

/**
 * fromから「ちょうどh歩」で各サイトへ届く経路のうち最も安いものを、h=0から順に並べたもの。
 * 同じ土地を通り直す経路は移動時間が伸びるだけなので、歩数ごとに安い方で置き換えるだけで最短が残る。
 */
function routeCostsByHopsFrom(
  from: number,
  departureMinutes: readonly number[],
  neighbors: readonly { other: number; travelMinutes: number }[][],
): readonly (RouteCost | undefined)[][] {
  const siteCount = neighbors.length;
  const byHops: (RouteCost | undefined)[][] = [];

  let current = new Array<RouteCost | undefined>(siteCount).fill(undefined);
  current[from] = { travelMinutes: 0, pathDiscoveryMinutes: 0 };
  byHops.push(current);

  for (let hops = 1; hops < siteCount; hops++) {
    const next = new Array<RouteCost | undefined>(siteCount).fill(undefined);
    for (const [site, cost] of current.entries()) {
      if (cost === undefined) continue;
      for (const { other, travelMinutes } of neighbors[site]) {
        const candidate: RouteCost = {
          travelMinutes: cost.travelMinutes + travelMinutes,
          pathDiscoveryMinutes: cost.pathDiscoveryMinutes + departureMinutes[site],
        };
        const incumbent = next[other];
        if (incumbent === undefined || isCheaper(candidate, incumbent)) next[other] = candidate;
      }
    }
    byHops.push(next);
    current = next;
  }
  return byHops;
}

/** その要るものを採れるサイトのうち、最も歩数が少ないもの（同歩数なら安い方）。 */
function nearestProvider(
  byHops: readonly (RouteCost | undefined)[][],
  providers: readonly ReadonlySet<number>[],
  needIndex: number,
): NeedReach | undefined {
  for (const [hops, costs] of byHops.entries()) {
    let best: RouteCost | undefined;
    for (const [site, cost] of costs.entries())
      if (
        cost !== undefined &&
        providers[site].has(needIndex) &&
        (best === undefined || isCheaper(cost, best))
      )
        best = cost;
    if (best !== undefined) return { hops, ...best };
  }
  return undefined;
}

function isCheaper(candidate: RouteCost, incumbent: RouteCost): boolean {
  return candidate.travelMinutes !== incumbent.travelMinutes
    ? candidate.travelMinutes < incumbent.travelMinutes
    : candidate.pathDiscoveryMinutes < incumbent.pathDiscoveryMinutes;
}

function isFarther(candidate: NeedReach, incumbent: NeedReach): boolean {
  return candidate.hops !== incumbent.hops
    ? candidate.hops > incumbent.hops
    : candidate.travelMinutes > incumbent.travelMinutes;
}

function bestSiteOf(sites: readonly SiteReach[]): SiteReach {
  return sites.reduce((best, site) => (isBetterStart(site, best) ? site : best));
}

function isBetterStart(candidate: SiteReach, incumbent: SiteReach): boolean {
  if (candidate.unreachableNeedCount !== incumbent.unreachableNeedCount)
    return candidate.unreachableNeedCount < incumbent.unreachableNeedCount;

  const a = candidate.farthestNeed;
  const b = incumbent.farthestNeed;
  if (a === undefined || b === undefined) return a !== undefined;
  if (a.hops !== b.hops) return a.hops < b.hops;
  if (a.travelMinutes !== b.travelMinutes) return a.travelMinutes < b.travelMinutes;
  return a.pathDiscoveryMinutes < b.pathDiscoveryMinutes;
}

/** その土地の探索1回を工程として見たもの。探索を宣言していない土地は投げる（土地は必ず探索できる）。 */
function exploreStepOf(codex: WorldCodex, locationDef: ObjectDef): CraftingStep {
  const explore = craftingStepsOf(codex, locationDef).find(
    (step) => step.kind === 'interaction' && step.name === codex.vocabulary.world.exploreAction,
  );
  if (explore === undefined) throw new Error(`土地 '${locationDef.name}' が探索を宣言していません。`);
  return explore;
}

/**
 * その土地の道が全部出そろうまでの探索時間（分）。進捗は探索1回につき1進み、上限へ達する前に
 * すべての道が見つかる（IslandSpawnerが保証する生成の不変条件）。
 */
function pathDiscoveryMinutesOf(codex: WorldCodex, locationDef: ObjectDef, explore: CraftingStep): number {
  const range = locationDef.tryGetPropertyDef(codex.vocabulary.world.explorationProgressId)?.range;
  if (range === undefined)
    throw new Error(`土地 '${locationDef.name}' がexploration_progressのrangeを宣言していません。`);
  return (range.max - 1) * explore.laborMinutes;
}

/** 1回の実行で、その型が生まれる期待個数（分岐の確率で重み付けした和）。 */
function expectedSpawnsOf(step: CraftingStep): ReadonlyMap<number, number> {
  const expected = new Map<number, number>();
  for (const outcome of step.outcomes)
    for (const spawn of outcome.spawns)
      expected.set(
        spawn.objectGlobalId,
        (expected.get(spawn.objectGlobalId) ?? 0) + outcome.probability * spawn.count,
      );
  return expected;
}
