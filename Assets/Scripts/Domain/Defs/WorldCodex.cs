namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// ロードされたYAMLファイル全体（GameElementDefinition.md 3.1節: 「ファイル全体が1つの WorldCodex を
    /// 表します」）を表す、唯一の集約オブジェクト。名前空間ではなくこのクラスが「WorldCodex」そのもの。
    ///
    /// 中身は本体データ（ObjectDefTable）と、それを読むために必要な5種の名前空間
    /// （object/property/slot/tag/symbol）の NameRegistry、および汎用エンジンが規約として直接参照する
    /// WellKnownProperties。ロード完了後は不変として扱う（Intern は Loader.WorldCodexYamlLoader の中でしか
    /// 呼ばれない）。SymbolNamesは、シンボル型のprops（6節）の値（整数にも真偽値にもならない識別子）が
    /// 登録される名前空間で、他の4種とは独立（同じ文字列が別の名前空間で使われていても衝突しない）。
    ///
    /// 実行中に生成される WorldObject（可変な実行時状態）はここには含まれない。WorldCodex はあくまで
    /// 「定義」の集合であり、生成されたインスタンスの管理は別の場所（実行時側、UnmappedIsland.Domain.Runtime）が
    /// 担う想定。
    /// </summary>
    public sealed class WorldCodex
    {
        public NameRegistry ObjectNames { get; }
        public NameRegistry PropertyNames { get; }
        public NameRegistry SlotNames { get; }
        public NameRegistry TagNames { get; }
        public NameRegistry SymbolNames { get; }

        public ObjectDefTable Objects { get; }
        public WellKnownProperties WellKnown { get; }

        /// <summary>地形生成の定義一式（terrain_generation.yamlのaxes/location_types/generation_scopes）。
        /// 生成定義を1つも含まないロードではnull（地形生成を使わないCodexも成立する）。</summary>
        public Generation.GenerationDefs Generation { get; }

        public WorldCodex(
            NameRegistry objectNames,
            NameRegistry propertyNames,
            NameRegistry slotNames,
            NameRegistry tagNames,
            NameRegistry symbolNames,
            ObjectDefTable objects,
            WellKnownProperties wellKnown,
            Generation.GenerationDefs generation = null)
        {
            ObjectNames = objectNames;
            PropertyNames = propertyNames;
            SlotNames = slotNames;
            TagNames = tagNames;
            SymbolNames = symbolNames;
            Objects = objects;
            WellKnown = wellKnown;
            Generation = generation;
        }
    }
}
