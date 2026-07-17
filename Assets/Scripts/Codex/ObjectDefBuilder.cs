using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.Codex
{
    /// <summary>
    /// YAMLパーサ（別途）が出力する中間データ。実際の YAML デシリアライズはこのクラスの外側で行う。
    /// ここでは「1つの object_defs エントリを組み立てるのに必要な情報」だけを表す。
    /// </summary>
    public sealed class ObjectDefBlueprint
    {
        public string Name;
        public bool IsSingleton;
        public readonly List<PropertyBlueprint> Properties = new List<PropertyBlueprint>();
        public readonly List<SlotBlueprint> Slots = new List<SlotBlueprint>();
        public readonly List<ContributionBlueprint> Contributions = new List<ContributionBlueprint>();

        /// <summary>スタック内での並び順（表示専用）。null なら未定義（常にスタック末尾へ追加）。</summary>
        public StackOrderBlueprint StackOrder;

        /// <summary>参照したtrait名の一覧。combinationsの`with`のtraitマッチング用のメタ情報として、
        /// そのままObjectDef.Traitsへ引き継がれる（merge自体はローダー側で完了済み）。</summary>
        public readonly List<string> TraitNames = new List<string>();

        public readonly List<ActionBlueprint> Actions = new List<ActionBlueprint>();
        public readonly List<CombinationBlueprint> Combinations = new List<CombinationBlueprint>();
    }

    /// <summary>{path, op, value}のブループリント版。pathのpropertyはまだグローバルIDへ解決されていない。</summary>
    public sealed class ConditionBlueprint
    {
        public ReferenceRoot Root;
        public string PropertyName;
        public ConditionOp Op;
        public readonly List<PropertyValue> Values = new List<PropertyValue>();
    }

    /// <summary>pick候補のweightのブループリント版。</summary>
    public struct WeightBlueprint
    {
        public bool IsPathRef;
        public double Literal;
        public ReferenceRoot PathRoot;
        public string PathPropertyName;
    }

    /// <summary>pickの1候補のブループリント版。ActiveかPickのどちらか一方のみを埋める。</summary>
    public sealed class PickCandidateBlueprint
    {
        public WeightBlueprint Weight;
        public ActiveEffectBlueprint Active;
        public List<PickCandidateBlueprint> Pick;
    }

    /// <summary>メニュー型操作（11節）のブループリント版。ActiveかPickのどちらか一方のみを埋める。</summary>
    public sealed class ActionBlueprint
    {
        public string Name;
        public ShowMenuMode ShowMenu = ShowMenuMode.Always;
        public readonly List<ConditionBlueprint> Conditions = new List<ConditionBlueprint>();
        public ActiveEffectBlueprint Active;
        public List<PickCandidateBlueprint> Pick;
    }

    /// <summary>ドラッグ型操作（12節）のブループリント版。ActiveかPickのどちらか一方のみを埋める。</summary>
    public sealed class CombinationBlueprint
    {
        public string Name;
        public string With;
        public readonly List<ConditionBlueprint> Conditions = new List<ConditionBlueprint>();
        public ActiveEffectBlueprint Active;
        public List<PickCandidateBlueprint> Pick;
    }

    /// <summary>StackOrderDefのブループリント版。プロパティ名はまだグローバルIDへ解決されていない。</summary>
    public sealed class StackOrderBlueprint
    {
        public string PropertyName;
        public bool Ascending;
    }

    public sealed class ContributionBlueprint
    {
        public ContributionTarget Target;
        public ContributionKind Kind;
        public string TargetPropertyName;
        public int Amount;
        public ContributionGateKind GateKind;

        /// <summary>GateKind.WhenSlot用。スロット名（グローバル語彙。将来どの親に付くか分からないため名前のまま持つ）。</summary>
        public string GateSlotName;

        /// <summary>GateKind.WhenOwnStage用。同一object_def内のプロパティ名とstage名。</summary>
        public string GateStagePropertyName;
        public string GateStageName;
    }

    public sealed class PropertyBlueprint
    {
        public string Name;
        public PropertyValue DefaultValue;
        public PropertyRange? RerollRange;
        public PropertyRange? Range;

        /// <summary>on_overflow（6.3節）: Range.Maxを超えた際にselfへ一度だけ適用するactive内容。著者が
        /// 明示的に書かなかった場合、nullのままにしておく（Rangeがあれば、ビルド時にBuildOverflowSideEffect
        /// が既定のset効果を合成する）。</summary>
        public ActiveEffectBlueprint OnOverflow;

        /// <summary>on_shortfall（6.3節）: on_overflowの下限側の鏡像。Range.Minを下回った際にselfへ
        /// 一度だけ適用するactive内容。OnOverflowと同じ既定合成の扱いを受ける。</summary>
        public ActiveEffectBlueprint OnShortfall;

        public readonly List<StageBlueprint> Stages = new List<StageBlueprint>();

        /// <summary>on_min（6.5節、旧on_zero）。null なら持たない。既定の自動生成はしない。</summary>
        public ActiveEffectBlueprint OnMin;

        /// <summary>on_max（6.6節）。null なら持たない。既定の自動生成はしない。on_minの上限側の鏡像。</summary>
        public ActiveEffectBlueprint OnMax;
    }

    /// <summary>
    /// active内容（`set`/`add`/`destroy`/`spawn`、9節）のブループリント版。on_min・on_overflow・
    /// on_shortfall（6節）とactions/combinations/pickのactive（11・12・10節）のすべてがこの1つの型を共用する。
    /// 文法は「操作(set/add)が上位、対象(self/parent/actor/dragged)が下位」。destroyは削除対象を
    /// 直接列挙するリスト、spawnは常にselfが実行するため対象キーを持たない。
    /// </summary>
    public sealed class ActiveEffectBlueprint
    {
        public readonly Dictionary<ReferenceRoot, List<AssignBlueprint>> Sets = new Dictionary<ReferenceRoot, List<AssignBlueprint>>();
        public readonly Dictionary<ReferenceRoot, List<AddBlueprint>> Adds = new Dictionary<ReferenceRoot, List<AddBlueprint>>();
        public readonly List<ReferenceRoot> Destroy = new List<ReferenceRoot>();

        /// <summary>null なら spawn なし。</summary>
        public SpawnBlueprint Spawn;
    }

    /// <summary>set の1エントリ。</summary>
    public struct AssignBlueprint
    {
        public string PropertyName;
        public int Value;
    }

    /// <summary>add の1エントリ。</summary>
    public struct AddBlueprint
    {
        public string PropertyName;
        public int Amount;
    }

    public sealed class SpawnBlueprint
    {
        public string ObjectName;

        /// <summary>省略時（既定値）は SameSlot 、つまり「selfが今いる、まさにその場所」。</summary>
        public SpawnTargetRoot Into;
    }

    public struct StageBlueprint
    {
        public string Name;
        public int? Min;
    }

    public sealed class SlotBlueprint
    {
        public string Name;
        public readonly List<AcceptBlueprint> Accepts = new List<AcceptBlueprint>();
        public double? Capacity;
        public double WeightRate = 1.0;
        public bool Stackable = true;
        public int? UnitCapacity;
        public bool FixedPositions;
    }

    public struct AcceptBlueprint
    {
        public string ObjectName;
        public int Max;
        public bool Consume;
    }

    /// <summary>
    /// ObjectDefBlueprint群から、グローバル/ローカルID変換表を含む ObjectDef群を組み立てる。
    ///
    /// 手順は2パス構成が必須:
    /// (1) 全 object_def（本体＋全MODファイル）を走査し、名前を NameRegistry へ登録し尽くす
    /// (2) その後に確定したグローバルID空間の大きさを使って、各 ObjectDef のローカル配列を構築する
    /// 途中の状態（(1)の途中で(2)を始める等）は、後から読み込むファイルの分だけ配列を作り直す
    /// 羽目になるため避けること。
    /// </summary>
    public static class ObjectDefBuilder
    {
        public static ObjectDefTable Build(
            IReadOnlyList<ObjectDefBlueprint> blueprints,
            NameRegistry objectNames,
            NameRegistry propertyNames,
            NameRegistry slotNames)
        {
            InternAllNames(blueprints, objectNames, propertyNames, slotNames);

            var defsByGlobalId = new ObjectDef[objectNames.Count];

            foreach (var bp in blueprints)
            {
                defsByGlobalId[objectNames.GetId(bp.Name)] =
                    BuildOne(bp, objectNames, propertyNames, slotNames);
            }

            return new ObjectDefTable(defsByGlobalId);
        }

        private static void InternAllNames(
            IReadOnlyList<ObjectDefBlueprint> blueprints,
            NameRegistry objectNames,
            NameRegistry propertyNames,
            NameRegistry slotNames)
        {
            foreach (var bp in blueprints)
            {
                objectNames.Intern(bp.Name);
                foreach (var p in bp.Properties)
                {
                    propertyNames.Intern(p.Name);
                    InternActiveEffect(p.OnOverflow, propertyNames, objectNames);
                    InternActiveEffect(p.OnShortfall, propertyNames, objectNames);
                    InternActiveEffect(p.OnMin, propertyNames, objectNames);
                    InternActiveEffect(p.OnMax, propertyNames, objectNames);
                }
                if (bp.StackOrder != null) propertyNames.Intern(bp.StackOrder.PropertyName);
                foreach (var s in bp.Slots) slotNames.Intern(s.Name);
                foreach (var c in bp.Contributions)
                {
                    propertyNames.Intern(c.TargetPropertyName);
                    if (c.GateKind == ContributionGateKind.WhenSlot) slotNames.Intern(c.GateSlotName);
                    if (c.GateKind == ContributionGateKind.WhenOwnStage) propertyNames.Intern(c.GateStagePropertyName);
                }
                foreach (var a in bp.Actions)
                {
                    InternConditions(a.Conditions, propertyNames);
                    InternActiveEffect(a.Active, propertyNames, objectNames);
                    InternPickList(a.Pick, propertyNames, objectNames);
                }
                foreach (var c in bp.Combinations)
                {
                    InternConditions(c.Conditions, propertyNames);
                    InternActiveEffect(c.Active, propertyNames, objectNames);
                    InternPickList(c.Pick, propertyNames, objectNames);
                }
            }
        }

        private static void InternConditions(IReadOnlyList<ConditionBlueprint> conditions, NameRegistry propertyNames)
        {
            foreach (var c in conditions) propertyNames.Intern(c.PropertyName);
        }

        private static void InternActiveEffect(
            ActiveEffectBlueprint body, NameRegistry propertyNames, NameRegistry objectNames)
        {
            if (body == null) return;

            foreach (var list in body.Sets.Values)
                foreach (var assign in list) propertyNames.Intern(assign.PropertyName);

            foreach (var list in body.Adds.Values)
                foreach (var add in list) propertyNames.Intern(add.PropertyName);

            if (body.Spawn != null) objectNames.Intern(body.Spawn.ObjectName);
        }

        private static void InternPickList(
            List<PickCandidateBlueprint> pick, NameRegistry propertyNames, NameRegistry objectNames)
        {
            if (pick == null) return;
            foreach (var candidate in pick)
            {
                if (candidate.Weight.IsPathRef) propertyNames.Intern(candidate.Weight.PathPropertyName);
                InternActiveEffect(candidate.Active, propertyNames, objectNames);
                InternPickList(candidate.Pick, propertyNames, objectNames);
            }
        }

        private static ObjectDef BuildOne(
            ObjectDefBlueprint bp,
            NameRegistry objectNames,
            NameRegistry propertyNames,
            NameRegistry slotNames)
        {
            var propertyGlobalIds = bp.Properties.Select(p => propertyNames.GetId(p.Name)).ToList();
            var propertyLayout = new LocalIndexMap(propertyNames.Count, propertyGlobalIds);
            var propertyDefs = new PropertyDef[bp.Properties.Count];

            for (int local = 0; local < bp.Properties.Count; local++)
            {
                var p = bp.Properties[local];

                ActiveEffect onOverflow = BuildOverflowSideEffect(
                    p.OnOverflow, p.Range, propertyGlobalIds[local], isMax: true, propertyNames, objectNames);
                ActiveEffect onShortfall = BuildOverflowSideEffect(
                    p.OnShortfall, p.Range, propertyGlobalIds[local], isMax: false, propertyNames, objectNames);
                ActiveEffect onMin = p.OnMin != null ? BuildActiveEffect(p.OnMin, propertyNames, objectNames) : null;
                ActiveEffect onMax = p.OnMax != null ? BuildActiveEffect(p.OnMax, propertyNames, objectNames) : null;

                var stages = p.Stages.Select(s => new PropertyStage(s.Name, s.Min)).ToList();

                propertyDefs[local] = new PropertyDef(
                    propertyGlobalIds[local], p.Name, p.DefaultValue, p.RerollRange, p.Range, onOverflow, stages,
                    onMin, onShortfall, onMax);
            }

            var slotGlobalIds = bp.Slots.Select(s => slotNames.GetId(s.Name)).ToList();
            var slotLayout = new LocalIndexMap(slotNames.Count, slotGlobalIds);
            var slotDefs = new SlotDef[bp.Slots.Count];

            for (int local = 0; local < bp.Slots.Count; local++)
            {
                var s = bp.Slots[local];
                var accepts = s.Accepts
                    .Select(a => new SlotAcceptRule(a.ObjectName, a.Max, a.Consume))
                    .ToList();
                slotDefs[local] = new SlotDef(
                    slotGlobalIds[local], s.Name, accepts, s.Capacity, s.WeightRate,
                    s.Stackable, s.UnitCapacity, s.FixedPositions);
            }

            var contributions = bp.Contributions
                .Select(c => BuildContribution(c, propertyLayout, propertyDefs, propertyNames, slotNames))
                .ToList();

            StackOrderDef stackOrder = bp.StackOrder != null
                ? new StackOrderDef(propertyNames.GetId(bp.StackOrder.PropertyName), bp.StackOrder.Ascending)
                : null;

            var actions = bp.Actions.Select(a => BuildAction(a, propertyNames, objectNames)).ToList();
            var combinations = bp.Combinations.Select(c => BuildCombination(c, propertyNames, objectNames)).ToList();

            return new ObjectDef(
                objectNames.GetId(bp.Name), bp.Name, bp.IsSingleton,
                propertyLayout, propertyDefs, slotLayout, slotDefs, contributions, stackOrder,
                bp.TraitNames, actions, combinations);
        }

        private static ActionDef BuildAction(ActionBlueprint a, NameRegistry propertyNames, NameRegistry objectNames)
        {
            var conditions = a.Conditions.Select(c => BuildCondition(c, propertyNames)).ToList();
            var active = BuildActiveEffect(a.Active, propertyNames, objectNames);
            var pick = BuildPickList(a.Pick, propertyNames, objectNames);
            return new ActionDef(a.Name, a.ShowMenu, conditions, active, pick);
        }

        private static CombinationDef BuildCombination(CombinationBlueprint c, NameRegistry propertyNames, NameRegistry objectNames)
        {
            var conditions = c.Conditions.Select(cc => BuildCondition(cc, propertyNames)).ToList();
            var active = BuildActiveEffect(c.Active, propertyNames, objectNames);
            var pick = BuildPickList(c.Pick, propertyNames, objectNames);
            return new CombinationDef(c.Name, c.With, conditions, active, pick);
        }

        private static ConditionDef BuildCondition(ConditionBlueprint c, NameRegistry propertyNames)
        {
            int propertyGlobalId = propertyNames.GetId(c.PropertyName);
            return new ConditionDef(new PropertyPath(c.Root, propertyGlobalId), c.Op, c.Values);
        }

        private static ActiveEffect BuildActiveEffect(ActiveEffectBlueprint body, NameRegistry propertyNames, NameRegistry objectNames)
        {
            if (body == null) return null;

            var sets = body.Sets.ToDictionary(
                kv => kv.Key,
                kv => (IReadOnlyList<PropertyAssignment>)kv.Value
                    .Select(a => new PropertyAssignment(propertyNames.GetId(a.PropertyName), a.Value))
                    .ToList());

            var adds = body.Adds.ToDictionary(
                kv => kv.Key,
                kv => (IReadOnlyList<PropertyDelta>)kv.Value
                    .Select(a => new PropertyDelta(propertyNames.GetId(a.PropertyName), a.Amount))
                    .ToList());

            SpawnEffect spawn = body.Spawn != null
                ? new SpawnEffect(objectNames.GetId(body.Spawn.ObjectName), body.Spawn.Into)
                : null;

            return new ActiveEffect(sets, adds, body.Destroy, spawn);
        }

        /// <summary>
        /// on_overflow/on_shortfallを組み立てる。著者が明示的に書いていればそれをそのまま使う。書いて
        /// おらず、かつRangeが定義されている場合は、「自分自身をRangeの境界（isMax指定側）へsetする」という
        /// 既定のActiveEffectを合成する。これにより、著者はレンジ型プロパティのクランプを`range`を書くだけで
        /// 実現でき、繰り上げ等の特別な挙動が要る場合だけon_overflow/on_shortfallを明示すればよい。
        /// Rangeが未定義ならnull（上限/下限の仕組み自体を持たない）。
        /// </summary>
        private static ActiveEffect BuildOverflowSideEffect(
            ActiveEffectBlueprint body, PropertyRange? range, int propertyGlobalId, bool isMax,
            NameRegistry propertyNames, NameRegistry objectNames)
        {
            if (body != null) return BuildActiveEffect(body, propertyNames, objectNames);
            if (!range.HasValue) return null;

            var sets = new Dictionary<ReferenceRoot, IReadOnlyList<PropertyAssignment>>
            {
                [ReferenceRoot.Self] = new List<PropertyAssignment>
                {
                    new PropertyAssignment(propertyGlobalId, isMax ? range.Value.Max : range.Value.Min),
                },
            };
            var adds = new Dictionary<ReferenceRoot, IReadOnlyList<PropertyDelta>>();

            return new ActiveEffect(sets, adds, System.Array.Empty<ReferenceRoot>(), spawn: null);
        }

        private static IReadOnlyList<PickCandidateDef> BuildPickList(
            List<PickCandidateBlueprint> pick, NameRegistry propertyNames, NameRegistry objectNames)
        {
            if (pick == null) return null;
            return pick.Select(p => BuildPickCandidate(p, propertyNames, objectNames)).ToList();
        }

        private static PickCandidateDef BuildPickCandidate(
            PickCandidateBlueprint p, NameRegistry propertyNames, NameRegistry objectNames)
        {
            WeightSpec weight = p.Weight.IsPathRef
                ? WeightSpec.FromPath(new PropertyPath(p.Weight.PathRoot, propertyNames.GetId(p.Weight.PathPropertyName)))
                : WeightSpec.FromLiteral(p.Weight.Literal);

            var active = BuildActiveEffect(p.Active, propertyNames, objectNames);
            var pick = BuildPickList(p.Pick, propertyNames, objectNames);
            return new PickCandidateDef(weight, active, pick);
        }

        private static ContributionDef BuildContribution(
            ContributionBlueprint c,
            LocalIndexMap ownPropertyLayout,
            PropertyDef[] ownPropertyDefs,
            NameRegistry propertyNames,
            NameRegistry slotNames)
        {
            int targetPropertyGlobalId = propertyNames.GetId(c.TargetPropertyName);

            ContributionGate gate;
            switch (c.GateKind)
            {
                case ContributionGateKind.WhenSlot:
                    gate = new ContributionGate
                    {
                        Kind = ContributionGateKind.WhenSlot,
                        SlotGlobalId = slotNames.GetId(c.GateSlotName),
                    };
                    break;

                case ContributionGateKind.WhenOwnStage:
                    int stagePropertyLocalId = ownPropertyLayout.ToLocal(propertyNames.GetId(c.GateStagePropertyName));
                    PropertyDef stagePropertyDef = ownPropertyDefs[stagePropertyLocalId];
                    PropertyStage stage = stagePropertyDef.Stages.First(s => s.Name == c.GateStageName);
                    gate = new ContributionGate
                    {
                        Kind = ContributionGateKind.WhenOwnStage,
                        PropertyLocalId = stagePropertyLocalId,
                        Stage = stage,
                    };
                    break;

                default:
                    gate = ContributionGate.Always;
                    break;
            }

            return new ContributionDef(c.Target, c.Kind, targetPropertyGlobalId, c.Amount, gate);
        }
    }
}
