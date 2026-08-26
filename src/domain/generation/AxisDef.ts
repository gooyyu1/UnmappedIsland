import type { PropertyRange } from '../PropertyDef';

/** 軸のジェネレータ1層の種類（TerrainGeneration.md 3.1節の汎用プリミティブ）。 */
export type GeneratorLayerType =
  /** 島の縁からの距離場（縁=0、中心=最大）。 */
  | 'distance_field'
  /** シード付きの格子値ノイズ（octaves/frequency/seed_offset）。 */
  | 'layered_noise';

/**
 * 軸のジェネレータの1層（`generator.blend` の1要素）。複数の層のサンプル値をweightで
 * 重み付き平均して軸の値になる。値の計算はDomain.Generation側のサンプラーが担う。
 */
export class GeneratorLayer {
  readonly type: GeneratorLayerType;

  /** 重み合成に使う重み（他の層との比率。整数、100=等倍）。 */
  readonly weight: number;

  /** layered_noise: オクターブ数（重ねるノイズの層数）。 */
  readonly octaves: number;

  /** layered_noise: 基本周波数（島の直径あたりの起伏の数の目安）。 */
  readonly frequency: number;

  /** layered_noise: 島のシードへ加算する軸固有のオフセット。同じシードでも軸ごとに独立したノイズになるようにする。 */
  readonly seedOffset: number;

  constructor(type: GeneratorLayerType, weight: number, octaves = 0, frequency = 0, seedOffset = 0) {
    if (type === 'layered_noise') {
      if (octaves < 1) throw new Error(`octavesは1以上である必要があります（値: ${octaves}）。`);
      if (frequency < 1) throw new Error(`frequencyは1以上である必要があります（値: ${frequency}）。`);
    }

    this.type = type;
    this.weight = weight;
    this.octaves = octaves;
    this.frequency = frequency;
    this.seedOffset = seedOffset;
  }
}

/**
 * 軸（Axis）の定義（TerrainGeneration.md 1節・3.1節）。標高・湿り気など、地点（Site）が持つ
 * 連続値パラメータの1次元。値は整数（通常0〜100の百分率。GameElementDefinition.md 6節の
 * 「数値は32bit整数のみ」の規約により、YAML上にfloatは登場させない）。
 */
export class AxisDef {
  readonly name: string;

  /** 軸の値域。サンプル値はこの範囲へ量子化される。 */
  readonly range: PropertyRange;

  /** 重み合成するジェネレータ層（宣言順）。 */
  readonly layers: readonly GeneratorLayer[];

  /**
   * 1回の生成に出たサンプルの最小・最大が`range`の両端へ来るよう引き伸ばすか（3.1節）。
   * ジェネレータの値はサイトの座標で決まり、どこにサイトが置かれるかは事前に決まらないため、
   * **宣言した値域が実際に現れることを保証できるのはこの引き伸ばしだけ**。値域が現実の単位
   * （標高のメートル）へ読み替えられる軸で要る。
   */
  readonly stretchesSitesToRange: boolean;

  constructor(
    name: string,
    range: PropertyRange,
    layers: readonly GeneratorLayer[],
    stretchesSitesToRange: boolean,
  ) {
    if (layers.length === 0) throw new Error(`軸'${name}': generator.blendには1つ以上の層が必要です。`);

    this.name = name;
    this.range = range;
    this.layers = layers;
    this.stretchesSitesToRange = stretchesSitesToRange;
  }
}
