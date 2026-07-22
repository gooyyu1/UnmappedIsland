using System;
using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Domain.Runtime;
using UnmappedIsland.Domain.Runtime.Views;

namespace UnmappedIsland.Domain.Generation
{
    /// <summary>
    /// IslandMap（TerrainGeneratorの純粋な計算結果）を、実際の世界（worldツリー）へ実体化する。
    ///
    /// - 各SiteのLocationTypeが指すobject_defをspawnし、worldのlocationsスロットへ配置する
    /// - 各辺（IslandEdge）につき道（path）を両端に1個ずつspawnし、travel_minutes・required_progress・
    ///   destination_id（相手側LocationのInstanceId）を書き込んで、それぞれの土地の
    ///   undiscovered_paths（隠しスロット）へ配置する
    ///
    /// required_progressは土地ごとに [2, 探索上限-1] の範囲へ等間隔に割り当てる。これにより
    /// 「探索の進捗が最大へ達する前に、その土地のすべての道が見つかる」という要求を、
    /// データの丸め方ではなく生成の不変条件として保証する（テストで検証する）。
    /// </summary>
    public static class IslandSpawner
    {
        /// <summary>最初の道が見つかる進捗。1回目の探索でいきなり道が出ないようにする最低値。</summary>
        private const int FirstPathProgress = 2;

        public static void Populate(WorldSession session, IslandMap map)
        {
            if (session.World == null)
                throw new InvalidOperationException("Populate には World を持つ WorldSession が必要です。");

            WorldCodex codex = session.Codex;
            WorldObject world = session.World.Instance;
            int locationsSlotId = codex.SlotNames.GetId("locations");
            int undiscoveredPathsSlotId = codex.SlotNames.GetId("undiscovered_paths");
            int pathDefId = codex.ObjectNames.GetId("path");
            int progressId = codex.PropertyNames.GetId("exploration_progress");
            int travelMinutesId = codex.PropertyNames.GetId("travel_minutes");
            int requiredProgressId = codex.PropertyNames.GetId("required_progress");
            int destinationIdId = codex.PropertyNames.GetId("destination_id");

            // 1. 土地の実体化。
            var locations = new WorldObject[map.Sites.Count];
            foreach (Site site in map.Sites)
            {
                WorldObject location = session.Spawn(site.Type.ObjectDefGlobalId);
                if (!location.MoveToSlot(world, locationsSlotId, codex.WellKnown, out string error))
                    throw new InvalidOperationException($"土地 '{site.Type.Name}' を配置できません: {error}");
                locations[site.Index] = location;
                map.SiteInstanceIds[site.Index] = location.InstanceId;
            }

            // 2. 道の実体化（辺1本につき両端へ1個ずつ）。土地ごとに、繋がる相手のIndex順で
            //    required_progressを[FirstPathProgress, 探索上限-1]へ等間隔に割り当てる。
            foreach (Site site in map.Sites)
            {
                var touching = map.Edges
                    .Where(e => e.A == site.Index || e.B == site.Index)
                    .Select(e => (Edge: e, Other: e.A == site.Index ? e.B : e.A))
                    .OrderBy(e => e.Other)
                    .ToList();
                if (touching.Count == 0) continue;

                int progressMax = locations[site.Index].Def.GetPropertyDef(progressId).Range.Value.Max;
                int lastPathProgress = progressMax - 1;

                for (int i = 0; i < touching.Count; i++)
                {
                    var (edge, other) = touching[i];
                    int requiredProgress = touching.Count == 1
                        ? FirstPathProgress
                        : FirstPathProgress + (lastPathProgress - FirstPathProgress) * i / (touching.Count - 1);

                    WorldObject path = session.Spawn(pathDefId);
                    path.SetProperty(travelMinutesId, edge.TravelMinutes);
                    path.SetProperty(requiredProgressId, requiredProgress);
                    path.SetProperty(destinationIdId, locations[other].InstanceId);
                    if (!path.MoveToSlot(locations[site.Index], undiscoveredPathsSlotId, codex.WellKnown, out string error))
                        throw new InvalidOperationException($"道を配置できません: {error}");
                }
            }
        }

        /// <summary>
        /// プレイヤーキャラクタを開始地点の土地（漂着地）へ配置し、その土地のビューを返す。
        /// 開始地点は砂浜を優先し、無ければ外周リング（海岸）、それも無ければ最初のサイト
        /// （いずれもIndex順で決定的）。
        /// </summary>
        public static Location PlacePlayer(WorldSession session, IslandMap map, WorldObject character)
        {
            WorldCodex codex = session.Codex;
            Site start =
                map.Sites.FirstOrDefault(s => s.Type.Name == "sandy_beach") ??
                map.Sites.FirstOrDefault(s => s.OnCoastRing) ??
                map.Sites[0];

            WorldObject location = session.World.Instance.FindDescendantByInstanceId(map.SiteInstanceIds[start.Index]);
            if (location == null)
                throw new InvalidOperationException("開始地点の土地が実体化されていません（先にPopulateを呼んでください）。");

            if (!character.MoveToSlot(location, codex.SlotNames.GetId("characters"), codex.WellKnown, out string error))
                throw new InvalidOperationException($"プレイヤーを開始地点へ配置できません: {error}");

            return new Location(location, codex);
        }
    }
}
