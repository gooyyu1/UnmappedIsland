using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Defs;

namespace UnmappedIsland.Domain.Runtime.Views
{
    /// <summary>
    /// 土地（locations.yamlのexplorable trait実装オブジェクト）に対する、UI/ゲームロジック向けの型付き
    /// ビュー。World と同じ理由で継承ではなくラップにしている。
    ///
    /// 探索の入口はExploreに一本化: exploreアクションの実行に加え、道の公開（RevealDuePaths）まで
    /// 自分で行い、呼び出し側に後続手順を持たせない。
    ///
    /// 名前解決はTryGetIdで行い、探索の語彙を持たないcodex（最小のテストフィクスチャ等）でも
    /// 生成できるようにしている。
    /// </summary>
    public sealed class Location
    {
        public WorldObject Instance { get; }

        private readonly int explorationProgressId = -1;
        private readonly int requiredProgressId = -1;
        private readonly int itemsSlotId = -1;
        private readonly int fixturesSlotId = -1;
        private readonly int charactersSlotId = -1;
        private readonly int undiscoveredPathsSlotId = -1;
        private readonly int pathsSlotId = -1;

        public Location(WorldObject instance)
        {
            Instance = instance;
        }

        public Location(WorldObject instance, WorldCodex codex)
        {
            Instance = instance;
            explorationProgressId = IdOrMissing(codex.PropertyNames, "exploration_progress");
            requiredProgressId = IdOrMissing(codex.PropertyNames, "required_progress");
            itemsSlotId = IdOrMissing(codex.SlotNames, "items");
            fixturesSlotId = IdOrMissing(codex.SlotNames, "fixtures");
            charactersSlotId = IdOrMissing(codex.SlotNames, "characters");
            undiscoveredPathsSlotId = IdOrMissing(codex.SlotNames, "undiscovered_paths");
            pathsSlotId = IdOrMissing(codex.SlotNames, "paths");
        }

        /// <summary>未登録の名前は-1（LocalIndexMap.Missing扱い）にする。TryGetId失敗時のout値0は
        /// 別の名前の有効なIDになりうるため、そのままでは使えない。</summary>
        private static int IdOrMissing(NameRegistry names, string name) =>
            names.TryGetId(name, out int id) ? id : -1;

        /// <summary>現在の探索進捗（実効値）。</summary>
        public int ExplorationProgress => Instance.GetEffectiveValue(explorationProgressId);

        /// <summary>探索できる回数（=exploration_progressのrange.max、土地ごとにYAMLで定義）。</summary>
        public int ExplorationProgressMax =>
            Instance.Def.GetPropertyDef(explorationProgressId)?.Range?.Max ?? 0;

        /// <summary>アイテムスロットの中身。</summary>
        public IReadOnlyList<WorldObject> Items => SlotContents(itemsSlotId);

        /// <summary>設置物（木・植物・建築物・家具・洞窟入口など）スロットの中身。</summary>
        public IReadOnlyList<WorldObject> Fixtures => SlotContents(fixturesSlotId);

        /// <summary>キャラクタスロットの中身。</summary>
        public IReadOnlyList<WorldObject> Characters => SlotContents(charactersSlotId);

        /// <summary>発見済みの道。未発見の道（undiscovered_paths側）は含まない。</summary>
        public IReadOnlyList<WorldObject> Paths => SlotContents(pathsSlotId);

        /// <summary>この土地を1回探索する（exploreアクション＋RevealDuePaths）。進捗が上限に達している
        /// （exploreのconditionsが不成立）ならfalse。</summary>
        public bool Explore(WorldObject actor, WorldSession session)
        {
            if (!Instance.TryExecuteAction("explore", actor, session)) return false;
            RevealDuePaths(session);
            return true;
        }

        /// <summary>
        /// undiscovered_pathsの道のうち、required_progressが現在の探索進捗以下のものをpathsへ移して
        /// 「発見」させる。冪等。進捗がYAML側の効果だけで動いた場合に備え、Exploreを介さず単独でも呼べる。
        /// </summary>
        public void RevealDuePaths(WorldSession session)
        {
            if (!Instance.TryGetSlot(undiscoveredPathsSlotId, out Slot hidden)) return;

            int progress = ExplorationProgress;
            foreach (WorldObject path in hidden.Contents.ToArray())
            {
                if (path.GetEffectiveValue(requiredProgressId) <= progress)
                    path.MoveToSlot(Instance, pathsSlotId, session.Codex.WellKnown, out _);
            }
        }

        private IReadOnlyList<WorldObject> SlotContents(int slotGlobalId) =>
            Instance.TryGetSlot(slotGlobalId, out Slot slot) ? slot.Contents : System.Array.Empty<WorldObject>();
    }
}
