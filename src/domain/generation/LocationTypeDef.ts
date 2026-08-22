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
    if (tolerance < 1) throw new Error(`軸'${axis}': toleranceは1以上である必要があります。`);
    if (weight < 1) throw new Error(`軸'${axis}': weightは1以上である必要があります。`);

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
    if (min === undefined && max === undefined)
      throw new Error(`軸'${axis}': 'min'または'max'のいずれかが必要です。`);

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
 * 亜種（TerrainGeneration.md 3.6節）: 同じLocationTypeの中の個体差。識別子と、実体化した土地へ
 * 書き込むプロパティの上書きを持つ。表示名はlocaleが持つ（Localization.md）。
 *
 * **上書きしてよいのは発見量のつまみだけ**という制約は、YAMLの書き手が守る（プロパティの実在は
 * build時に検証する）。亜種は「少しだけ木苺が多い森」の類であって、そこにしか無いものを作る
 * 仕組みではない——同じ型は島に高々3個で、型ごとの出現率も5割前後なので、亜種に固有のものを
 * 紐づけると「島のどこにも無い」が普通に起きる。
 */
export class LocationVariantDef {
  /** 亜種の識別子。その型の中で一意で、localeの表示名を引くキーになる。 */
  readonly id: string;

  /** プロパティのグローバルID→実体化時に書き込む値。空なら素の亜種（名前だけが変わる）。 */
  readonly props: ReadonlyMap<number, number>;

  constructor(id: string, props: ReadonlyMap<number, number>) {
    this.id = id;
    this.props = props;
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

  /**
   * 同じ型が島に複数あるときに配る亜種（TerrainGeneration.md 3.6節）。個数が足りなければ名前は
   * 通し番号で埋まるが、それは名前として読めないので、想定される個数ぶんは用意しておく。
   */
  readonly variants: readonly LocationVariantDef[];

  /** この型が適用される生成スコープ名（3.7節）。空なら全スコープに適用される。 */
  readonly applicableScopes: readonly string[];

  /** 移動コストの倍率（1=等倍）。道のtravel_minutesの係数になる。 */
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
    variants: readonly LocationVariantDef[],
    applicableScopes: readonly string[],
    moveCost: number,
    isFallback: boolean,
    priority: number,
    preferences: readonly AxisPreference[],
    hardLimits: readonly AxisLimit[],
  ) {
    if (moveCost <= 0) throw new Error(`'${name}': move_costは正の数である必要があります。`);
    // 全軸に無関心な型は最近傍マッチングで距離が定義できないので、受け皿としてしか置けない。
    if (preferences.length === 0 && !isFallback)
      throw new Error(
        `'${name}': axis_preferencesが空の（全軸に無関心な）型はis_fallback: trueにしてください。`,
      );

    this.name = name;
    this.objectDefGlobalId = objectDefGlobalId;
    this.variants = variants;
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

  /** hard_limitsをすべて満たすか。1つでも外れていればその地点には置けない。 */
  allows(axisValues: ReadonlyMap<string, number>): boolean {
    return this.hardLimits.every((limit) => limit.allows(axisValues.get(limit.axis)!));
  }

  /**
   * 希望する軸の値からの隔たり（重み付き、許容幅で正規化）。0が理想ぴったりで、大きいほど遠い。
   * 型どうしを比べるための尺度なので、軸の単位には依存しない。
   */
  normalizedDistanceFrom(axisValues: ReadonlyMap<string, number>): number {
    let sum = 0;
    let weightSum = 0;
    for (const preference of this.preferences) {
      const deviation = (axisValues.get(preference.axis)! - preference.ideal) / preference.tolerance;
      sum += preference.weight * deviation * deviation;
      weightSum += preference.weight;
    }
    return Math.sqrt(sum / weightSum);
  }
}
