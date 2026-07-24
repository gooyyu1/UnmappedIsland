/** ある軸に対する「理想点+許容範囲」（axis_preferencesの1エントリ、TerrainGeneration.md 3.2節）。 */
export class AxisPreference {
  readonly axis: string;

  /** 理想の軸値。 */
  readonly ideal: number;

  /** 許容幅（距離のスケール）。軸値がidealからtolerance分ずれると正規化距離1に相当する。
   * 「超えたら除外」のゲートではない（除外はLocationTypeDef.hardLimitsだけが担う）。 */
  readonly tolerance: number;

  /** この軸の重要度（整数、100=等倍）。マッチング距離はΣweightで正規化するため、
   * 言及する軸の数が少ない型が構造的に有利になることはない。 */
  readonly weight: number;

  constructor(axis: string, ideal: number, tolerance: number, weight: number) {
    this.axis = axis;
    this.ideal = ideal;
    this.tolerance = tolerance;
    this.weight = weight;
  }
}

/** ある軸に対する絶対的な除外条件（hard_limitsの1エントリ）。範囲外のサイトにはこの型が絶対にマッチしない。 */
export class AxisLimit {
  readonly axis: string;
  readonly min: number | undefined;
  readonly max: number | undefined;

  constructor(axis: string, min: number | undefined, max: number | undefined) {
    this.axis = axis;
    this.min = min;
    this.max = max;
  }

  allows(value: number): boolean {
    if (this.min !== undefined && value < this.min) return false;
    if (this.max !== undefined && value > this.max) return false;
    return true;
  }
}

/**
 * LocationType（TerrainGeneration.md 1節・3.2節）: 「草原」「洞窟」など、配置の定義。
 * プレイヤーには見えない設計者側の語彙で、実体（Location）はobjectDefGlobalIdが指す
 * object_def（locations.yaml）のインスタンスとして生成される。
 */
export class LocationTypeDef {
  readonly name: string;

  /** この型が実体化するときのobject_defのグローバルID（build時に存在検証済み）。 */
  readonly objectDefGlobalId: number;

  /** 命名処理（「東の草原」等）に使う表示名。 */
  readonly displayName: string;

  /** この型が適用される生成スコープ名（3.7節）。空なら全スコープに適用される。 */
  readonly applicableScopes: readonly string[];

  /** 移動コスト（100=等倍）。道のtravel_minutesの係数になる。 */
  readonly moveCost: number;

  /** どの型もhard_limitsで弾かれたサイトの受け皿か（3.3節のフォールバック）。 */
  readonly isFallback: boolean;

  /** フォールバックが複数あるときの優先度（大きいほど優先）。 */
  readonly priority: number;

  readonly preferences: readonly AxisPreference[];
  readonly hardLimits: readonly AxisLimit[];

  constructor(
    name: string,
    objectDefGlobalId: number,
    displayName: string,
    applicableScopes: readonly string[],
    moveCost: number,
    isFallback: boolean,
    priority: number,
    preferences: readonly AxisPreference[],
    hardLimits: readonly AxisLimit[],
  ) {
    this.name = name;
    this.objectDefGlobalId = objectDefGlobalId;
    this.displayName = displayName;
    this.applicableScopes = applicableScopes;
    this.moveCost = moveCost;
    this.isFallback = isFallback;
    this.priority = priority;
    this.preferences = preferences;
    this.hardLimits = hardLimits;
  }

  appliesTo(scopeName: string): boolean {
    if (this.applicableScopes.length === 0) return true;
    return this.applicableScopes.some((scope) => scope === scopeName);
  }
}
