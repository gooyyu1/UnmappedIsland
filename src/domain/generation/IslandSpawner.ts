import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import { Location } from '../runtime/views/Location';
import type { IslandMap, Site } from './IslandMap';

/** 最初の道が見つかる進捗。1回目の探索でいきなり道が出ないようにする最低値。 */
const FIRST_PATH_PROGRESS = 2;

/**
 * IslandMap（TerrainGeneratorの純粋な計算結果）を、実際の世界（worldツリー）へ実体化する。
 *
 * - 各SiteのLocationTypeが指すobject_defをspawnし、worldのlocationsスロットへ配置する
 * - 各辺（IslandEdge）につき道（path）を両端に1個ずつspawnし、travelMinutes・requiredProgress・
 *   destinationId（相手側LocationのInstanceId）を書き込んで、それぞれの土地の
 *   undiscovered_paths（隠しスロット）へ配置する
 *
 * requiredProgressは土地ごとに [2, 探索上限-1] の範囲へ等間隔に割り当てる。これにより
 * 「探索の進捗が最大へ達する前に、その土地のすべての道が見つかる」という要求を、
 * データの丸め方ではなく生成の不変条件として保証する（テストで検証する）。
 */
export function populate(session: WorldSession, map: IslandMap): void {
  if (session.world === undefined) throw new Error('populate には World を持つ WorldSession が必要です。');

  const codex = session.codex;
  const world = session.world.instance;
  const locationsSlotId = codex.slotNames.getId('locations');
  const undiscoveredPathsSlotId = codex.slotNames.getId('undiscovered_paths');
  const pathDefId = codex.objectNames.getId('path');
  const progressId = codex.propertyNames.getId('exploration_progress');
  const travelMinutesId = codex.propertyNames.getId('travel_minutes');
  const requiredProgressId = codex.propertyNames.getId('required_progress');
  const destinationIdId = codex.propertyNames.getId('destination_id');

  // 1. 土地の実体化。
  const locations = new Array<WorldObject>(map.sites.length);
  for (const site of map.sites) {
    const location = session.spawn(site.type!.objectDefGlobalId);
    const error = location.moveToSlot(world, locationsSlotId, codex.wellKnown);
    if (error !== undefined) throw new Error(`土地 '${site.type!.name}' を配置できません: ${error}`);
    locations[site.index] = location;
    map.siteInstanceIds[site.index] = location.instanceId;
  }

  // 2. 道の実体化（辺1本につき両端へ1個ずつ）。土地ごとに、繋がる相手のindex順で
  //    requiredProgressを[FIRST_PATH_PROGRESS, 探索上限-1]へ等間隔に割り当てる。
  for (const site of map.sites) {
    const touching = map.edges
      .filter((e) => e.a === site.index || e.b === site.index)
      .map((e) => ({ edge: e, other: e.a === site.index ? e.b : e.a }))
      .sort((x, y) => x.other - y.other);
    if (touching.length === 0) continue;

    const progressMax = locations[site.index].def.getPropertyDef(progressId)!.range!.max;
    const lastPathProgress = progressMax - 1;

    for (let i = 0; i < touching.length; i++) {
      const { edge, other } = touching[i];
      const requiredProgress =
        touching.length === 1
          ? FIRST_PATH_PROGRESS
          : FIRST_PATH_PROGRESS +
            Math.trunc(((lastPathProgress - FIRST_PATH_PROGRESS) * i) / (touching.length - 1));

      const path = session.spawn(pathDefId);
      path.setProperty(travelMinutesId, edge.travelMinutes);
      path.setProperty(requiredProgressId, requiredProgress);
      path.setProperty(destinationIdId, locations[other].instanceId);
      const error = path.moveToSlot(locations[site.index], undiscoveredPathsSlotId, codex.wellKnown);
      if (error !== undefined) throw new Error(`道を配置できません: ${error}`);
    }
  }
}

/**
 * プレイヤーキャラクタを開始地点の土地（漂着地）へ配置し、その土地のビューを返す。
 * 開始地点は砂浜を優先し、無ければ外周リング（海岸）、それも無ければ最初のサイト
 * （いずれもindex順で決定的）。
 */
export function placePlayer(session: WorldSession, map: IslandMap, character: WorldObject): Location {
  const codex = session.codex;
  const start: Site =
    map.sites.find((s) => s.type!.name === 'sandy_beach') ??
    map.sites.find((s) => s.onCoastRing) ??
    map.sites[0];

  const location = session.world!.instance.findDescendantByInstanceId(map.siteInstanceIds[start.index]);
  if (location === undefined)
    throw new Error('開始地点の土地が実体化されていません（先にpopulateを呼んでください）。');

  const error = character.moveToSlot(location, codex.slotNames.getId('characters'), codex.wellKnown);
  if (error !== undefined) throw new Error(`プレイヤーを開始地点へ配置できません: ${error}`);

  return new Location(location, codex);
}
