import { ISLAND_RADIUS } from './SitePlacer';

/** guaranteesのpick: 保証対象のサイトを軸値のどちら側から選ぶか。 */
export type GuaranteePick = 'max' | 'min';

/**
 * 島全体のバランス保証の1エントリ（TerrainGeneration.md 3.4節・6節の「カバレッジ保証」）。
 * 指定軸が最大/最小のサイトからcount個へ、このLocationTypeを最近傍マッチングの前に強制割当する
 * （軸の分布だけでは「山が必ず1つ」の類を保証できないため）。
 */
export class CoverageGuaranteeDef {
  readonly locationType: string;
  readonly count: number;
  readonly axis: string;
  readonly pick: GuaranteePick;

  constructor(locationType: string, count: number, axis: string, pick: GuaranteePick) {
    if (count < 1) throw new Error(`'${locationType}'の保証: countは1以上である必要があります。`);

    this.locationType = locationType;
    this.count = count;
    this.axis = axis;
    this.pick = pick;
  }
}

/**
 * 生成スコープ（TerrainGeneration.md 3.7節）: 島の生成と構造物内部の生成が共有する
 * 生成ロジックへの、スコープごとのパラメータプリセット。
 */
export class GenerationScopeDef {
  readonly name: string;

  /** 生成する土地の数の範囲（この範囲からシードで抽選）。 */
  readonly siteCountMin: number;
  readonly siteCountMax: number;

  /** coastal_distanceがこの値以下のサイトを「海岸帯」とみなす。 */
  readonly coastBandMaxDistance: number;

  /** 凸包上（外周）のサイトのcoastal_distanceを海岸帯へクランプするか（島が必ず海岸で囲まれることの保証）。 */
  readonly clampsHullSitesToCoast: boolean;

  /** サイト配置の内陸バイアス（0=一様、1=最大。範囲はparseGenerationが検証する）。外周に張り付くサイトを減らし、海岸が多くなりすぎないようにする。 */
  readonly interiorBias: number;

  /** MST以外のDelaunay辺を復活させる迂回率の閾値（倍率）。現グラフでの2点間最短距離が
   * 直結距離のこの倍を超えるなら、その辺を近道として復活させる。 */
  readonly extraEdgeDetourThreshold: number;

  /** このスコープが生成する土地の差し渡し（m）。抽象座標の直径（ISLAND_RADIUSの2倍）がこの長さに当たる。 */
  readonly diameterMeters: number;

  /** moveCostが1.0の土地を歩く速さ（m/時）。 */
  readonly walkMetersPerHour: number;

  /** 高低差を登り下りする速さ（m/時）。水平移動とは別に、両端の高低差ぶんの時間が乗る。 */
  readonly climbMetersPerHour: number;

  /** 標高として読む軸の名前（実在はGenerationDefsが確かめる）。 */
  readonly elevationAxis: string;

  /** 標高軸の上端が海抜何メートルに当たるか（下端が0m）。 */
  readonly elevationTopMeters: number;

  /**
   * 同じLocationTypeを何個まで置いてよいか（TerrainGeneration.md 3.4節）。同じ地形は環境も発見物も
   * 見た目も同じなので、並べても島は広くならない。0で無制限。
   */
  readonly maxSitesPerType: number;

  /**
   * 同じ型が1個増えるごとにマッチング距離へ乗せる割増（率、0で無効）。上限に当たる前から
   * 他の型へ譲らせて、上限での打ち切りが「よくある結末」にならないようにする。
   */
  readonly crowdingPenaltyPerDuplicate: number;

  readonly guarantees: readonly CoverageGuaranteeDef[];

  constructor(
    name: string,
    siteCountMin: number,
    siteCountMax: number,
    coastBandMaxDistance: number,
    clampsHullSitesToCoast: boolean,
    interiorBias: number,
    extraEdgeDetourThreshold: number,
    diameterMeters: number,
    walkMetersPerHour: number,
    climbMetersPerHour: number,
    elevationAxis: string,
    elevationTopMeters: number,
    maxSitesPerType: number,
    crowdingPenaltyPerDuplicate: number,
    guarantees: readonly CoverageGuaranteeDef[],
  ) {
    if (siteCountMin < 1 || siteCountMax < siteCountMin)
      throw new Error(`'${name}': site_countは1 <= min <= maxである必要があります。`);
    if (interiorBias < 0 || interiorBias > 1)
      throw new Error(`'${name}': interior_biasは0〜1である必要があります。`);
    if (maxSitesPerType < 0)
      throw new Error(`'${name}': max_sites_per_typeは0以上である必要があります（0で無制限）。`);
    if (crowdingPenaltyPerDuplicate < 0)
      throw new Error(`'${name}': crowding_penaltyは0以上である必要があります（0で無効）。`);
    if (diameterMeters <= 0) throw new Error(`'${name}': diameter_metersは正の数である必要があります。`);
    if (walkMetersPerHour <= 0)
      throw new Error(`'${name}': walk_meters_per_hourは正の数である必要があります。`);
    if (climbMetersPerHour <= 0)
      throw new Error(`'${name}': climb_meters_per_hourは正の数である必要があります。`);
    if (elevationTopMeters < 0)
      throw new Error(`'${name}': elevation_top_metersは0以上である必要があります。`);

    this.name = name;
    this.siteCountMin = siteCountMin;
    this.siteCountMax = siteCountMax;
    this.coastBandMaxDistance = coastBandMaxDistance;
    this.clampsHullSitesToCoast = clampsHullSitesToCoast;
    this.interiorBias = interiorBias;
    this.extraEdgeDetourThreshold = extraEdgeDetourThreshold;
    this.diameterMeters = diameterMeters;
    this.walkMetersPerHour = walkMetersPerHour;
    this.climbMetersPerHour = climbMetersPerHour;
    this.elevationAxis = elevationAxis;
    this.elevationTopMeters = elevationTopMeters;
    this.maxSitesPerType = maxSitesPerType;
    this.crowdingPenaltyPerDuplicate = crowdingPenaltyPerDuplicate;
    this.guarantees = guarantees;
  }

  /** 抽象座標1単位が何メートルか。抽象座標系は半径ISLAND_RADIUSの円盤で、その直径がdiameterMeters。 */
  get metersPerDistanceUnit(): number {
    return this.diameterMeters / (ISLAND_RADIUS * 2);
  }

  /** 標高軸の値1あたりの高さ（m）。軸の値域はスコープ側では分からないので呼び手が渡す。 */
  metersPerElevationUnit(elevationAxisSpan: number): number {
    return this.elevationTopMeters / elevationAxisSpan;
  }
}
