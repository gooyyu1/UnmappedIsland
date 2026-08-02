/** guaranteesのpick: 保証対象のサイトを軸値のどちら側から選ぶか。 */
export type GuaranteePick = 'max' | 'min';

/**
 * 島全体のバランス保証の1エントリ（TerrainGeneration.md 3.4節・6節の「カバレッジ保証」）。
 * 指定軸が最大/最小のサイトからcount個へ、このLocationTypeを最近傍マッチングの前に強制割当する
 * （軸の分布だけでは「山が必ず1つ」の類を保証できないため）。
 */
export class GuaranteeDef {
  readonly locationType: string;
  readonly count: number;
  readonly axis: string;
  readonly pick: GuaranteePick;

  constructor(locationType: string, count: number, axis: string, pick: GuaranteePick) {
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
  readonly coastBand: number;

  /** 凸包上（外周）のサイトのcoastal_distanceを海岸帯へクランプするか（島が必ず海岸で囲まれることの保証）。 */
  readonly hullCoast: boolean;

  /** サイト配置の内陸バイアス（0=一様、100=最大）。外周に張り付くサイトを減らし、海岸が多くなりすぎないようにする。 */
  readonly interiorBias: number;

  /** MST以外のDelaunay辺を復活させる迂回率の閾値（%）。現グラフでの2点間最短距離が
   * 直結距離のこの割合を超えるなら、その辺を近道として復活させる。 */
  readonly extraEdgeDetourFactor: number;

  /** 抽象座標の距離1あたりの基準移動時間（分）。 */
  readonly baseMinutesPerDistance: number;

  /**
   * 同じLocationTypeを何個まで置いてよいか（TerrainGeneration.md 3.4節）。同じ地形は環境も発見物も
   * 見た目も同じなので、並べても島は広くならない。0で無制限。
   */
  readonly maxSitesPerType: number;

  /**
   * 同じ型が1個増えるごとにマッチング距離へ乗せる割増（%、0で無効）。上限に当たる前から
   * 他の型へ譲らせて、上限での打ち切りが「よくある結末」にならないようにする。
   */
  readonly crowdingPenalty: number;

  readonly guarantees: readonly GuaranteeDef[];

  constructor(
    name: string,
    siteCountMin: number,
    siteCountMax: number,
    coastBand: number,
    hullCoast: boolean,
    interiorBias: number,
    extraEdgeDetourFactor: number,
    baseMinutesPerDistance: number,
    maxSitesPerType: number,
    crowdingPenalty: number,
    guarantees: readonly GuaranteeDef[],
  ) {
    this.name = name;
    this.siteCountMin = siteCountMin;
    this.siteCountMax = siteCountMax;
    this.coastBand = coastBand;
    this.hullCoast = hullCoast;
    this.interiorBias = interiorBias;
    this.extraEdgeDetourFactor = extraEdgeDetourFactor;
    this.baseMinutesPerDistance = baseMinutesPerDistance;
    this.maxSitesPerType = maxSitesPerType;
    this.crowdingPenalty = crowdingPenalty;
    this.guarantees = guarantees;
  }
}
