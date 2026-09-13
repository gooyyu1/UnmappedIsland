import type { IslandMap } from '../domain/generation/IslandMap';
import type {
  NeedRoute,
  SiteStartupReach,
  StartupNeedSuppliers,
} from '../domain/generation/StartSiteSelection';
import {
  islandStartupReachOf,
  STARTUP_NEEDS,
  startupNeedSuppliersOf,
} from '../domain/generation/StartSiteSelection';
import type { ObjectDef } from '../domain/ObjectDef';
import type { WorldCodex } from '../domain/WorldCodex';
import type { CraftingStep } from './CraftingStep';
import { craftingStepsOf } from './craftingSteps';

/**
 * 生成された島を測って、**最初の段（ContentSkeleton.md 2.1節）を越えるのに要るものが、その地点から
 * 何歩先にあるか**を出す。
 *
 * **歩数と移動時間はドメインが出す**（`src/domain/generation/StartSiteSelection.ts`）——開始地点の
 * 選抜が見ているのと同じ数でなければ、測ったものが遊びの現物とずれる。ここが足すのは**近似でしか
 * 出ない数**だけ——1回の探索あたり何個採れるか（抽選の重みを確率と見なす）と、道を見つけるのに
 * 要る時間（探索1回の所要時間）。近似をドメインへ置かないのはCodeStructure.md 5節。
 *
 * 返すのは数値と識別子だけで、判定（この散らばりは広すぎるか）は持たない。しきい値を決めるのは
 * この数字が出てからで（ContentSkeleton.md 2.3.3節）、道具の側が先に決めてしまうと、決める材料が
 * 道具の判定に汚染される。
 */

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

  /** 歩数を出すためにドメインへ渡すもの。 */
  readonly suppliers: StartupNeedSuppliers;
}

/** サイト1つから、要るもの1つへ届くまで。 */
export interface NeedReach extends NeedRoute {
  /**
   * その経路の道を見つけるのに要る探索時間（分）。**着いた先の探索は含まない**——ここが数えるのは
   * 道を見つける時間だけで、着いた先で目当ての物を引くまでの回数は数えない（引きの運）。
   */
  readonly pathDiscoveryMinutes: number;
}

/** サイト1つの立ち上がりやすさ。needsの並びはSTARTUP_NEEDSと同じで、届かないものはundefined。 */
export interface SiteReach extends Omit<SiteStartupReach, 'needs' | 'farthestNeed'> {
  readonly needs: readonly (NeedReach | undefined)[];
  readonly farthestNeed: NeedReach | undefined;
}

/** 島1つ。 */
export interface IslandReach {
  readonly seed: number;
  readonly sites: readonly SiteReach[];

  /** 島のどの土地でも採れなかった要るもの（STARTUP_NEEDSの添字）。 */
  readonly missingNeedIndices: readonly number[];

  /**
   * **選抜が選んだ開始地点**（ContentSkeleton.md 2.3節）。島は引き直さないので（同2.3.1節）、
   * これがその周回の実際の立ち上がりになる。
   */
  readonly startSite: SiteReach;
}

/**
 * 要るものの出どころを、探索できる土地の型すべてについて実測する。
 *
 * 採れると宣言している土地の期待個数が0なら投げる——選抜は宣言を見て「ここで採れる」と決めるので、
 * 実際には引けない土地をそこに数えていたら、選んだ地点は成り立たない道順で選ばれたことになる。
 */
export function startupNeedSourcesOf(codex: WorldCodex): StartupNeedSources {
  const suppliers = startupNeedSuppliersOf(codex);

  const sourceObjectIds = STARTUP_NEEDS.map((need) =>
    need.sourceObjectNames.map((name) => codex.objectNames.getId(name)),
  );

  const rows: NeedSourceRow[] = [];
  const byLocationDef = new Map<number, LocationNeedSupply>();

  for (const [locationDefGlobalId, supply] of suppliers) {
    const locationDef = codex.objects.get(locationDefGlobalId);
    const explore = exploreStepOf(codex, locationDef);
    const expected = expectedSpawnsOf(explore);

    for (const needIndex of [...supply.needIndices].sort((a, b) => a - b)) {
      const before = rows.length;
      for (const [objectIndex, objectId] of sourceObjectIds[needIndex].entries()) {
        const expectedPerExplore = expected.get(objectId) ?? 0;
        if (expectedPerExplore <= 0) continue;

        rows.push({
          needIndex,
          locationDefName: supply.locationDefName,
          objectName: STARTUP_NEEDS[needIndex].sourceObjectNames[objectIndex],
          expectedPerExplore,
        });
      }
      if (rows.length === before)
        throw new Error(
          `土地 '${supply.locationDefName}' の探索は '${STARTUP_NEEDS[needIndex].label}' を` +
            '生むと宣言していますが、1回あたりの期待個数が0です。',
        );
    }

    byLocationDef.set(locationDefGlobalId, {
      locationDefName: supply.locationDefName,
      needIndices: supply.needIndices,
      pathDiscoveryMinutes: pathDiscoveryMinutesOf(codex, locationDef, explore),
    });
  }

  rows.sort((a, b) => a.needIndex - b.needIndex);
  return { rows, byLocationDef, suppliers };
}

/** 生成された島1つを測る。 */
export function islandReachOf(sources: StartupNeedSources, map: IslandMap): IslandReach {
  const reach = islandStartupReachOf(sources.suppliers, map);
  const departureMinutes = map.sites.map(
    (site) => sources.byLocationDef.get(site.type!.objectDefGlobalId)!.pathDiscoveryMinutes,
  );

  const sites = reach.sites.map((site) => withPathDiscovery(site, departureMinutes));
  return {
    seed: reach.seed,
    sites,
    missingNeedIndices: reach.missingNeedIndices,
    startSite: sites[reach.startSite.siteIndex],
  };
}

/** ドメインが出した経路に、その経路を見つけるのに要る探索時間を添える。 */
function withPathDiscovery(site: SiteStartupReach, departureMinutes: readonly number[]): SiteReach {
  const needs = site.needs.map((need) => pathDiscoveryOf(need, departureMinutes));
  return {
    ...site,
    needs,
    farthestNeed: site.farthestNeedIndex === undefined ? undefined : needs[site.farthestNeedIndex],
  };
}

/** 通る土地それぞれで、道が全部出そろうまでの探索時間。**着いた先では探索しない**ので最後は数えない。 */
function pathDiscoveryOf(
  route: NeedRoute | undefined,
  departureMinutes: readonly number[],
): NeedReach | undefined {
  if (route === undefined) return undefined;
  const minutes = route.sites.slice(0, -1).reduce((sum, siteIndex) => sum + departureMinutes[siteIndex], 0);
  return { ...route, pathDiscoveryMinutes: minutes };
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
