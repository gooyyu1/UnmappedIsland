using System.Collections.Generic;

namespace UnmappedIsland.Domain.Defs.Generation
{
    /// <summary>軸のジェネレータ1層の種類（TerrainGeneration.md 3.1節の汎用プリミティブ）。
    /// 現時点はdistance_field/layered_noiseの2種。blob_scatter・modifiers（合成演算）は
    /// 必要になった時点で追加する。</summary>
    public enum GeneratorLayerType
    {
        /// <summary>島の縁からの距離場（縁=0、中心=最大）。</summary>
        DistanceField,

        /// <summary>シード付きの格子値ノイズ（octaves/frequency/seed_offset）。</summary>
        LayeredNoise,
    }

    /// <summary>
    /// 軸のジェネレータの1層（`generator.blend` の1要素）。複数の層のサンプル値をWeightで
    /// 重み付き平均して軸の値になる。値の実際の計算（ノイズ・距離場）はDomain.Generation側の
    /// サンプラーが担い、この定義は「どう計算するか」のパラメータだけを持つ。
    /// </summary>
    public sealed class GeneratorLayer
    {
        public GeneratorLayerType Type { get; }

        /// <summary>重み合成に使う重み（他の層との比率。整数、100=等倍）。</summary>
        public int Weight { get; }

        /// <summary>LayeredNoise: オクターブ数（重ねるノイズの層数）。</summary>
        public int Octaves { get; }

        /// <summary>LayeredNoise: 基本周波数（島の直径あたりの起伏の数の目安）。</summary>
        public int Frequency { get; }

        /// <summary>LayeredNoise: 島のシードへ加算する軸固有のオフセット。同じシードでも軸ごとに
        /// 独立したノイズになるようにする。</summary>
        public int SeedOffset { get; }

        public GeneratorLayer(GeneratorLayerType type, int weight, int octaves = 0, int frequency = 0, int seedOffset = 0)
        {
            Type = type;
            Weight = weight;
            Octaves = octaves;
            Frequency = frequency;
            SeedOffset = seedOffset;
        }
    }

    /// <summary>
    /// 軸（Axis）の定義（TerrainGeneration.md 1節・3.1節）。標高・湿り気など、地点（Site）が持つ
    /// 連続値パラメータの1次元。値は整数（通常0〜100の百分率。GameElementDefinition.md 6節の
    /// 「数値は32bit整数のみ」の規約に合わせ、YAML上にfloatは登場させない）。
    /// </summary>
    public sealed class AxisDef
    {
        public string Name { get; }

        /// <summary>軸の値域。サンプル値はこの範囲へ量子化される。</summary>
        public PropertyRange Range { get; }

        /// <summary>重み合成するジェネレータ層（宣言順）。</summary>
        public IReadOnlyList<GeneratorLayer> Layers { get; }

        public AxisDef(string name, PropertyRange range, IReadOnlyList<GeneratorLayer> layers)
        {
            Name = name;
            Range = range;
            Layers = layers;
        }
    }
}
