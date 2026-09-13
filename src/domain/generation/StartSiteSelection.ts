import type { ConditionalReading, EffectReader, PickReading } from '../EffectReader';
import type { ObjectGlobalId } from '../GlobalId';
import type { ObjectDef } from '../ObjectDef';
import type { WorldCodex } from '../WorldCodex';
import type { IslandMap, Site } from './IslandMap';

/**
 * 開始地点の選抜（ContentSkeleton.md 2.3節）。**生成の後段が持つ**——歩数は生成が出したパス
 * ネットワークからしか出ないので、島が出来上がってから選ぶ。
 *
 * 選ぶ材料は「最初の段（同2.1節）を越えるのに要るものが、その地点から何歩先にあるか」だけで、
 * 難易度もそこで切る（同2.3.2節）。**島は引き直さない**ので、どの候補も条件を満たさない島では
 * その中で最も近いものを返す（同2.3.1節）。
 *
 * **数えるのは宣言だけ。** どの土地で何が採れるかは`explore`が生みうる型で決め、1回あたり何個
 * 採れるか（抽選の重み）は見ない——重みを確率へ直すのは近似なので、解析側の仕事
 * （`src/analysis/startupReach.ts`、CodeStructure.md 5節）。**道は未発見でも数える**——選ぶのは
 * 島の作りを見てのことで、プレイヤーの進み具合ではない。
 */

/** 漂着できる地点の第一候補（GameConcept.md 概要の「無人島に漂着した主人公」）。 */
const LANDFALL_LOCATION_TYPE = 'sandy_beach';

/** 最初の段を越えるのに要るもの1つ（ContentSkeleton.md 2.3節の表の1行）。 */
export interface StartupNeed {
  /** レポートの見出しになる呼び名。 */
  readonly label: string;

  /**
   * これを満たす発見物の識別子。**どれか1つ採れれば満たす**——水はヤシの木でも湧き水でもよい。
   * どの土地でそれが採れるかは宣言せず、locations.yamlの`explore`から読む。
   */
  readonly sourceObjectNames: readonly string[];
}

/**
 * 測る対象（ContentSkeleton.md 2.3節）。**1つの土地では揃わない**ことがこの表の要点で、
 * 荒野は火口・錐・刃を持つが軸が無く、砂浜は軸と水しか持たない。
 */
export const STARTUP_NEEDS: readonly StartupNeed[] = [
  { label: '火口', sourceObjectNames: ['dry_grass'] },
  { label: '錐', sourceObjectNames: ['twig'] },
  { label: '軸', sourceObjectNames: ['thick_branch'] },
  { label: '刃', sourceObjectNames: ['stone'] },
  { label: '水', sourceObjectNames: ['palm_tree', 'spring'] },
  { label: '道具の要らない食料', sourceObjectNames: ['water_spinach'] },
];

/** 土地の型1つが、要るものに対して持っているもの。 */
export interface StartupNeedSupply {
  readonly locationDefName: string;

  /** その土地の`explore`が生みうる要るもの（STARTUP_NEEDSの添字）。 */
  readonly needIndices: ReadonlySet<number>;
}

/** object_defのグローバルID → その土地の型が持っているもの。島をまたいで変わらない。 */
export type StartupNeedSuppliers = ReadonlyMap<ObjectGlobalId, StartupNeedSupply>;

/** サイト1つから、要るもの1つへ届く経路。 */
export interface NeedRoute {
  /** 歩数（たどる道の本数）。0はその土地自身で採れること。 */
  readonly hops: number;

  /** その経路の移動時間（分）。 */
  readonly travelMinutes: number;

  /**
   * たどったサイトのindex（開始地点から採れる土地まで、両端を含む）。歩数と移動時間だけでは、
   * 経路に沿って積む数——道を見つけるのに要る時間など——を後から出せない。
   */
  readonly sites: readonly number[];
}

/** サイト1つの立ち上がりやすさ。needsの並びはSTARTUP_NEEDSと同じで、届かないものはundefined。 */
export interface SiteStartupReach {
  readonly siteIndex: number;
  readonly locationDefName: string;
  readonly needs: readonly (NeedRoute | undefined)[];

  /** 島のどこをたどっても届かなかった要るものの数。 */
  readonly unreachableNeedCount: number;

  /**
   * 届いたものの中で**最も遠い**要るもの（歩数、同歩数なら移動時間で比べる）と、その添字。
   * 全部が揃うまでを1本の経路として表す数で、1つも届かないサイトではundefined。
   */
  readonly farthestNeed: NeedRoute | undefined;
  readonly farthestNeedIndex: number | undefined;
}

/** 島1つ。 */
export interface IslandStartupReach {
  readonly seed: number;
  readonly sites: readonly SiteStartupReach[];

  /** 島のどの土地でも採れなかった要るもの（STARTUP_NEEDSの添字）。 */
  readonly missingNeedIndices: readonly number[];

  /** 選抜が選んだ開始地点（{@link selectStartSite} が返すサイトのもの）。 */
  readonly startSite: SiteStartupReach;
}

/**
 * 要るものの出どころを、探索できる土地の型すべてについて読む。
 *
 * 宣言した発見物がどの土地でも採れなければ投げる——要るものの表（ContentSkeleton.md 2.3節）と
 * locations.yamlが食い違ったまま選抜が動くと、その地点は別の物を見て選ばれたことになる。
 */
export function startupNeedSuppliersOf(codex: WorldCodex): StartupNeedSuppliers {
  const generation = codex.generation;
  if (generation === undefined)
    throw new Error('地形生成の定義（terrain_generation.yaml）がロードされていません。');

  const needIndexBySourceId = new Map<ObjectGlobalId, number>();
  for (const [needIndex, need] of STARTUP_NEEDS.entries())
    for (const name of need.sourceObjectNames) {
      const id = codex.objectNames.tryGetId(name);
      if (id === undefined) throw new Error(`要るものの出どころ '${name}' の型が定義されていません。`);
      needIndexBySourceId.set(id, needIndex);
    }

  const suppliers = new Map<ObjectGlobalId, StartupNeedSupply>();
  for (const locationType of generation.locationTypes) {
    const locationDef = codex.objects.get(locationType.objectDefGlobalId);
    if (suppliers.has(locationDef.globalId)) continue;

    const needIndices = new Set<number>();
    for (const objectGlobalId of exploreSpawnsOf(codex, locationDef)) {
      const needIndex = needIndexBySourceId.get(objectGlobalId);
      if (needIndex !== undefined) needIndices.add(needIndex);
    }
    suppliers.set(locationDef.globalId, { locationDefName: locationDef.name, needIndices });
  }

  for (const [needIndex, need] of STARTUP_NEEDS.entries())
    if (![...suppliers.values()].some((supply) => supply.needIndices.has(needIndex)))
      throw new Error(`要るもの '${need.label}' を採れる土地が1つもありません。`);

  return suppliers;
}

/**
 * プレイヤーが漂着する地点を選ぶ（ContentSkeleton.md 2.3節）。
 *
 * 候補は砂浜で、無ければ外周リング（海岸）、それも無ければ全サイト。**その中を並び順ではなく
 * 歩数で選ぶ**——届かない要るものが少ない順、次に全部が揃うまでの歩数、次にその移動時間。
 */
export function selectStartSite(codex: WorldCodex, map: IslandMap): Site {
  const reach = islandStartupReachOf(startupNeedSuppliersOf(codex), map);
  return map.sites[reach.startSite.siteIndex];
}

/**
 * 候補を絞って開始地点を選ぶ（ContentSkeleton.md 2.3節の順はそのまま）。候補が空ならundefined。
 *
 * 絞るのは、**漂着ではない事情で開始地点を決める側**——特定の土地から試したいシナリオ
 * （`src/scenario/Scenario.ts` の `location.type`）。絞った先でも並び順では採らない。
 */
export function selectStartSiteAmong(
  codex: WorldCodex,
  map: IslandMap,
  candidates: readonly Site[],
): Site | undefined {
  if (candidates.length === 0) return undefined;

  const reach = islandStartupReachOf(startupNeedSuppliersOf(codex), map);
  const best = bestCandidateOf(candidates.map((site) => reach.sites[site.index]));
  return map.sites[best.siteIndex];
}

/** 生成された島1つを、全サイトについて測る。 */
export function islandStartupReachOf(suppliers: StartupNeedSuppliers, map: IslandMap): IslandStartupReach {
  const supplies = map.sites.map((site) => supplyOf(suppliers, site));
  const providers = supplies.map((supply) => supply.needIndices);

  const neighbors: { other: number; travelMinutes: number }[][] = map.sites.map(() => []);
  for (const edge of map.edges) {
    neighbors[edge.a].push({ other: edge.b, travelMinutes: edge.travelMinutes });
    neighbors[edge.b].push({ other: edge.a, travelMinutes: edge.travelMinutes });
  }

  const sites = map.sites.map((site) =>
    siteStartupReachOf(site.index, supplies[site.index].locationDefName, providers, neighbors),
  );

  const missingNeedIndices = STARTUP_NEEDS.map((_, needIndex) => needIndex).filter((needIndex) =>
    providers.every((needIndices) => !needIndices.has(needIndex)),
  );

  const candidates = landfallCandidatesOf(map).map((site) => sites[site.index]);
  return { seed: map.seed, sites, missingNeedIndices, startSite: bestCandidateOf(candidates) };
}

/**
 * 漂着しうるサイト。**選抜が並べ替えるのはこの中だけ**——主人公は海から流れ着くので
 * （GameConcept.md 概要）、島の内陸から始まることはない。
 */
function landfallCandidatesOf(map: IslandMap): readonly Site[] {
  const beaches = map.sites.filter((site) => site.type!.name === LANDFALL_LOCATION_TYPE);
  if (beaches.length > 0) return beaches;

  const coast = map.sites.filter((site) => site.onCoastRing);
  return coast.length > 0 ? coast : map.sites;
}

function supplyOf(suppliers: StartupNeedSuppliers, site: Site): StartupNeedSupply {
  const supply = suppliers.get(site.type!.objectDefGlobalId);
  if (supply === undefined)
    throw new Error(`サイト ${site.index} の土地の型が、要るものの出どころ表に載っていません。`);
  return supply;
}

/** サイト1つから見た、要るものそれぞれへの最短。 */
function siteStartupReachOf(
  from: number,
  locationDefName: string,
  providers: readonly ReadonlySet<number>[],
  neighbors: readonly { other: number; travelMinutes: number }[][],
): SiteStartupReach {
  const byHops = routesByHopsFrom(from, neighbors);
  const needs = STARTUP_NEEDS.map((_, needIndex) => nearestProvider(byHops, providers, needIndex));

  let farthest: NeedRoute | undefined;
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

/** 経路1本。歩数はこの型の外（byHopsの添字）が持つ。 */
interface Route {
  readonly travelMinutes: number;
  readonly sites: readonly number[];
}

/**
 * fromから「ちょうどh歩」で各サイトへ届く経路のうち最も移動時間の短いものを、h=0から順に
 * 並べたもの。同じ土地を通り直す経路は移動時間が伸びるだけなので、歩数ごとに短い方で置き換えるだけで
 * 最短が残る。**同じ移動時間なら先に見つかった方を残す**ので、並び順（サイトのindex）が同点を解く。
 */
function routesByHopsFrom(
  from: number,
  neighbors: readonly { other: number; travelMinutes: number }[][],
): readonly (Route | undefined)[][] {
  const siteCount = neighbors.length;
  const byHops: (Route | undefined)[][] = [];

  let current = new Array<Route | undefined>(siteCount).fill(undefined);
  current[from] = { travelMinutes: 0, sites: [from] };
  byHops.push(current);

  for (let hops = 1; hops < siteCount; hops++) {
    const next = new Array<Route | undefined>(siteCount).fill(undefined);
    for (const [site, route] of current.entries()) {
      if (route === undefined) continue;
      for (const { other, travelMinutes } of neighbors[site]) {
        const incumbent = next[other];
        const candidateMinutes = route.travelMinutes + travelMinutes;
        if (incumbent !== undefined && incumbent.travelMinutes <= candidateMinutes) continue;
        next[other] = { travelMinutes: candidateMinutes, sites: [...route.sites, other] };
      }
    }
    byHops.push(next);
    current = next;
  }
  return byHops;
}

/** その要るものを採れるサイトのうち、最も歩数が少ないもの（同歩数なら移動時間が短い方）。 */
function nearestProvider(
  byHops: readonly (Route | undefined)[][],
  providers: readonly ReadonlySet<number>[],
  needIndex: number,
): NeedRoute | undefined {
  for (const [hops, routes] of byHops.entries()) {
    let best: Route | undefined;
    for (const [site, route] of routes.entries())
      if (
        route !== undefined &&
        providers[site].has(needIndex) &&
        (best === undefined || route.travelMinutes < best.travelMinutes)
      )
        best = route;
    if (best !== undefined) return { hops, travelMinutes: best.travelMinutes, sites: best.sites };
  }
  return undefined;
}

function isFarther(candidate: NeedRoute, incumbent: NeedRoute): boolean {
  return candidate.hops !== incumbent.hops
    ? candidate.hops > incumbent.hops
    : candidate.travelMinutes > incumbent.travelMinutes;
}

/**
 * 最も条件の良い候補。比べる順は「届かない数 → 全部が揃うまでの歩数 → その移動時間 →
 * サイトのindex」で、良し悪しの判定ではなく順序の定義。
 */
function bestCandidateOf(candidates: readonly SiteStartupReach[]): SiteStartupReach {
  return candidates.reduce((best, site) => (isBetterStart(site, best) ? site : best));
}

function isBetterStart(candidate: SiteStartupReach, incumbent: SiteStartupReach): boolean {
  if (candidate.unreachableNeedCount !== incumbent.unreachableNeedCount)
    return candidate.unreachableNeedCount < incumbent.unreachableNeedCount;

  const a = candidate.farthestNeed;
  const b = incumbent.farthestNeed;
  if (a === undefined || b === undefined) return a !== undefined;
  if (a.hops !== b.hops) return a.hops < b.hops;
  return a.travelMinutes < b.travelMinutes;
}

/**
 * その土地の探索が生みうる型（`spawn`、9.4節）。探索を宣言していない土地は投げる
 * （土地は必ず探索できる）。
 */
function exploreSpawnsOf(codex: WorldCodex, locationDef: ObjectDef): ReadonlySet<ObjectGlobalId> {
  const explore = locationDef.triggers.find(
    (trigger) => trigger.interaction.name === codex.vocabulary.world.exploreAction,
  );
  if (explore === undefined) throw new Error(`土地 '${locationDef.name}' が探索を宣言していません。`);

  const collector = new SpawnCollector();
  explore.interaction.read(collector);
  return collector.objectGlobalIds;
}

/** 生みうる型だけを集める読み手。**起こりうるかだけを問う**ので、重みも条件も見ない。 */
class SpawnCollector implements EffectReader {
  readonly objectGlobalIds = new Set<ObjectGlobalId>();

  spawn(objectGlobalId: ObjectGlobalId): void {
    this.objectGlobalIds.add(objectGlobalId);
  }

  pick(reading: PickReading): void {
    // 重み0の候補も生む先として数える。抽選は分岐でしかなく、起こることを隠さない。
    reading.readEveryCandidate(this);
  }

  /** 条件つき（6.3節）も同じ——満たさない回へ倒れる先も、生む先としては数える。 */
  conditional(reading: ConditionalReading): void {
    reading.readEveryBranch(this);
  }

  set(): void {}

  add(): void {}

  destroy(): void {}

  become(): void {}

  transfer(): void {}

  move(): void {}

  signal(): void {}
}
