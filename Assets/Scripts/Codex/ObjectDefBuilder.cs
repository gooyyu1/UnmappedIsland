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
        public Dictionary<ReferenceRoot, ActiveEffectBlueprint> Active;
        public List<PickCandidateBlueprint> Pick;
    }

    /// <summary>メニュー型操作（11節）のブループリント版。ActiveかPickのどちらか一方のみを埋める。</summary>
    public sealed class ActionBlueprint
    {
        public string Name;
        public ShowMenuMode ShowMenu = ShowMenuMode.Always;
        public readonly List<ConditionBlueprint> Conditions = new List<ConditionBlueprint>();
        public Dictionary<ReferenceRoot, ActiveEffectBlueprint> Active;
        public List<PickCandidateBlueprint> Pick;
    }

    /// <summary>ドラッグ型操作（12節）のブループリント版。ActiveかPickのどちらか一方のみを埋める。</summary>
    public sealed class CombinationBlueprint
    {
        public string Name;
        public string With;
        public readonly List<ConditionBlueprint> Conditions = new List<ConditionBlueprint>();
        public Dictionary<ReferenceRoot, ActiveEffectBlueprint> Active;
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

        /// <summary>on_overflow（6.3節）: Range.Maxを超えた際にselfへ一度だけ適用するaccumulate内容
        /// （on_zeroのadd/AddBlueprintと同じ形をそのまま流用する）。空ならon_overflowを持たない。</summary>
        public readonly List<AddBlueprint> OnOverflow = new List<AddBlueprint>();

        public readonly List<StageBlueprint> Stages = new List<StageBlueprint>();

        /// <summary>on_zero（6.5節）。null なら持たない。</summary>
        public ActiveEffectBlueprint OnZero;
    }

    /// <summary>on_zero（6.5節）の内容。`add`/`destroy`/`spawn`のうち使うものだけを埋める。</summary>
    public sealed class ActiveEffectBlueprint
    {
        public readonly List<AddBlueprint> Adds = new List<AddBlueprint>();
        public bool Destroy;

        /// <summary>null なら spawn なし。</summary>
        public SpawnBlueprint Spawn;
    }

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
                    foreach (var delta in p.OnOverflow) propertyNames.Intern(delta.PropertyName);
                    if (p.OnZero == null) continue;
                    foreach (var add in p.OnZero.Adds) propertyNames.Intern(add.PropertyName);
                    if (p.OnZero.Spawn != null) objectNames.Intern(p.OnZero.Spawn.ObjectName);
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
                    InternActiveMap(a.Active, propertyNames, objectNames);
                    InternPickList(a.Pick, propertyNames, objectNames);
                }
                foreach (var c in bp.Combinations)
                {
                    InternConditions(c.Conditions, propertyNames);
                    InternActiveMap(c.Active, propertyNames, objectNames);
                    InternPickList(c.Pick, propertyNames, objectNames);
                }
            }
        }

        private static void InternConditions(IReadOnlyList<ConditionBlueprint> conditions, NameRegistry propertyNames)
        {
            foreach (var c in conditions) propertyNames.Intern(c.PropertyName);
        }

        private static void InternActiveMap(
            Dictionary<ReferenceRoot, ActiveEffectBlueprint> map, NameRegistry propertyNames, NameRegistry objectNames)
        {
            if (map == null) return;
            foreach (var body in map.Values)
            {
                foreach (var add in body.Adds) propertyNames.Intern(add.PropertyName);
                if (body.Spawn != null) objectNames.Intern(body.Spawn.ObjectName);
            }
        }

        private static void InternPickList(
            List<PickCandidateBlueprint> pick, NameRegistry propertyNames, NameRegistry objectNames)
        {
            if (pick == null) return;
            foreach (var candidate in pick)
            {
                if (candidate.Weight.IsPathRef) propertyNames.Intern(candidate.Weight.PathPropertyName);
                InternActiveMap(candidate.Active, propertyNames, objectNames);
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

                var onOverflow = p.OnOverflow
                    .Select(delta => new PropertyDelta(propertyNames.GetId(delta.PropertyName), delta.Amount))
                    .ToList();

                var stages = p.Stages.Select(s => new PropertyStage(s.Name, s.Min)).ToList();

                ActiveEffect onZero = null;
                if (p.OnZero != null)
                {
                    var adds = p.OnZero.Adds
                        .Select(a => new PropertyDelta(propertyNames.GetId(a.PropertyName), a.Amount))
                        .ToList();

                    SpawnEffect spawn = null;
                    if (p.OnZero.Spawn != null)
                    {
                        spawn = new SpawnEffect(
                            objectNames.GetId(p.OnZero.Spawn.ObjectName),
                            p.OnZero.Spawn.Into);
                    }

                    onZero = new ActiveEffect(adds, p.OnZero.Destroy, spawn);
                }

                propertyDefs[local] = new PropertyDef(
                    propertyGlobalIds[local], p.Name, p.DefaultValue, p.RerollRange, p.Range, onOverflow, stages, onZero);
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
            var active = BuildActiveMap(a.Active, propertyNames, objectNames);
            var pick = BuildPickList(a.Pick, propertyNames, objectNames);
            return new ActionDef(a.Name, a.ShowMenu, conditions, active, pick);
        }

        private static CombinationDef BuildCombination(CombinationBlueprint c, NameRegistry propertyNames, NameRegistry objectNames)
        {
            var conditions = c.Conditions.Select(cc => BuildCondition(cc, propertyNames)).ToList();
            var active = BuildActiveMap(c.Active, propertyNames, objectNames);
            var pick = BuildPickList(c.Pick, propertyNames, objectNames);
            return new CombinationDef(c.Name, c.With, conditions, active, pick);
        }

        private static ConditionDef BuildCondition(ConditionBlueprint c, NameRegistry propertyNames)
        {
            int propertyGlobalId = propertyNames.GetId(c.PropertyName);
            return new ConditionDef(new PropertyPath(c.Root, propertyGlobalId), c.Op, c.Values);
        }

        private static IReadOnlyDictionary<ReferenceRoot, ActiveEffect> BuildActiveMap(
            Dictionary<ReferenceRoot, ActiveEffectBlueprint> map, NameRegistry propertyNames, NameRegistry objectNames)
        {
            if (map == null) return null;

            var result = new Dictionary<ReferenceRoot, ActiveEffect>();
            foreach (var kv in map)
                result[kv.Key] = BuildActiveEffect(kv.Value, propertyNames, objectNames);
            return result;
        }

        private static ActiveEffect BuildActiveEffect(ActiveEffectBlueprint body, NameRegistry propertyNames, NameRegistry objectNames)
        {
            var adds = body.Adds
                .Select(a => new PropertyDelta(propertyNames.GetId(a.PropertyName), a.Amount))
                .ToList();

            SpawnEffect spawn = body.Spawn != null
                ? new SpawnEffect(objectNames.GetId(body.Spawn.ObjectName), body.Spawn.Into)
                : null;

            return new ActiveEffect(adds, body.Destroy, spawn);
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

            var active = BuildActiveMap(p.Active, propertyNames, objectNames);
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
