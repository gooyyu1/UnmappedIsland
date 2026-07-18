using UnmappedIsland.Runtime;

namespace UnmappedIsland.Codex
{
    /// <summary>
    /// ロードされたYAMLファイル全体（GameElementDefinition.md 3.1節: 「ファイル全体が1つの WorldCodex を
    /// 表します」）を表す、唯一の集約オブジェクト。名前空間ではなくこのクラスが「WorldCodex」そのもの。
    ///
    /// 中身は本体データ（ObjectDefTable）と、それを読むために必要な3種の名前空間（object/property/slot）
    /// の NameRegistry、および汎用エンジンが規約として直接参照する WellKnownProperties。
    /// ロード完了後は不変として扱う（Intern は Loader.WorldCodexYamlLoader の中でしか呼ばれない）。
    ///
    /// 実行中に生成される WorldObject（可変な実行時状態）はここには含まれない。WorldCodex はあくまで
    /// 「定義」の集合であり、生成されたインスタンスの管理は別の場所（実行時側、UnmappedIsland.Runtime）が
    /// 担う想定。
    /// </summary>
    public sealed class WorldCodex
    {
        public NameRegistry ObjectNames { get; }
        public NameRegistry PropertyNames { get; }
        public NameRegistry SlotNames { get; }

        public ObjectDefTable Objects { get; }
        public WellKnownProperties WellKnown { get; }

        public WorldCodex(
            NameRegistry objectNames,
            NameRegistry propertyNames,
            NameRegistry slotNames,
            ObjectDefTable objects,
            WellKnownProperties wellKnown)
        {
            ObjectNames = objectNames;
            PropertyNames = propertyNames;
            SlotNames = slotNames;
            Objects = objects;
            WellKnown = wellKnown;
        }

        /// <summary>この WorldCodex に対する move_to_slot（Containment）を1つ作る。</summary>
        public Containment CreateContainment() => new Containment(WellKnown);
    }
}
