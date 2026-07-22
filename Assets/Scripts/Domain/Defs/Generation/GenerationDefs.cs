using System.Collections.Generic;

namespace UnmappedIsland.Domain.Defs.Generation
{
    /// <summary>
    /// 地形生成の定義一式（terrain_generation.yamlのaxes/location_types/generation_scopes）。
    /// WorldCodexの一部としてロード後不変。生成ファイルがロードされていない場合、
    /// WorldCodex.Generationはnullになる。
    ///
    /// 軸名・LocationType名・スコープ名は生成時にしか使われず実行時ホットパスに乗らないため、
    /// NameRegistryでinternせずstringのまま持つ（5種のレジストリを生成専用の名前で汚さない）。
    /// LocationTypesの並びはYAMLの宣言順（マッチングの同点解決を決定的にするため）。
    /// </summary>
    public sealed class GenerationDefs
    {
        public IReadOnlyDictionary<string, AxisDef> Axes { get; }
        public IReadOnlyList<LocationTypeDef> LocationTypes { get; }
        public IReadOnlyDictionary<string, GenerationScopeDef> Scopes { get; }

        public GenerationDefs(
            IReadOnlyDictionary<string, AxisDef> axes,
            IReadOnlyList<LocationTypeDef> locationTypes,
            IReadOnlyDictionary<string, GenerationScopeDef> scopes)
        {
            Axes = axes;
            LocationTypes = locationTypes;
            Scopes = scopes;
        }
    }
}
