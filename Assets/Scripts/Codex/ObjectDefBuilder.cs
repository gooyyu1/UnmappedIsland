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
        public OverflowMode OverflowMode;

        /// <summary>OverflowMode.Wrap のときの繰り上げ先プロパティ名（同一 object_def 内）。</summary>
        public string OverflowCarryToName;

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

                OverflowRule overflow = OverflowRule.None;
                if (p.OverflowMode == OverflowMode.Wrap)
                {
                    int carryToGlobal = propertyNames.GetId(p.OverflowCarryToName);
                    overflow = new OverflowRule(OverflowMode.Wrap, propertyLayout.ToLocal(carryToGlobal));
                }

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
                    propertyGlobalIds[local], p.Name, p.DefaultValue, p.RerollRange, p.Range, overflow, stages, onZero);
            }

            var slotGlobalIds = bp.Slots.Select(s => slotNames.GetId(s.Name)).ToList();
            var slotLayout = new LocalIndexMap(slotNames.Count, slotGlobalIds);
            var slotDefs = new SlotDef[bp.Slots.Count];

            for (int local = 0; local < bp.Slots.Count; local++)
            {
                var s = bp.Slots[local];
                var accepts = s.Accepts
                    .Select(a => new SlotAcceptRule(objectNames.GetId(a.ObjectName), a.Max, a.Consume))
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

            return new ObjectDef(
                objectNames.GetId(bp.Name), bp.Name, bp.IsSingleton,
                propertyLayout, propertyDefs, slotLayout, slotDefs, contributions, stackOrder);
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
