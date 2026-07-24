namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// ロードされたYAMLファイル全体を表す集約オブジェクト（GameElementDefinition.md 3.1節）。
    /// 本体データ（ObjectDefTable）、5種の独立した名前空間（object/property/slot/tag/symbol）の
    /// NameRegistry、およびWellKnownPropertiesを持つ。ロード完了後は不変として扱う。
    /// SymbolNamesはシンボル型props（6節）の値の名前空間。実行時状態（WorldObject）は含まない
    /// （UnmappedIsland.Domain.Runtimeが担う）。
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
