/**
 * 統計レポート（tests/diagnostics/*）が使う標本の集計器。
 *
 * 標本値は離散的（気温は整数、次数は本数、持続時間はtick数の倍数）で相異なる値の数が高々数千に
 * 収まるため、全標本を保持する代わりに値→出現回数のヒストグラムで持つ（標本数は数百万件に達しうる）。
 */
export class Stat {
  private _count = 0;
  private _sum = 0;
  private _sumSq = 0;
  private _min = Number.POSITIVE_INFINITY;
  private _max = Number.NEGATIVE_INFINITY;
  private readonly histogram = new Map<number, number>();

  add(v: number): void {
    this._count++;
    this._sum += v;
    this._sumSq += v * v;
    if (v < this._min) this._min = v;
    if (v > this._max) this._max = v;
    this.histogram.set(v, (this.histogram.get(v) ?? 0) + 1);
  }

  get count(): number {
    return this._count;
  }

  get mean(): number {
    return this._count > 0 ? this._sum / this._count : NaN;
  }

  get min(): number {
    return this._count > 0 ? this._min : NaN;
  }

  get max(): number {
    return this._count > 0 ? this._max : NaN;
  }

  get stdDev(): number {
    if (this._count < 2) return NaN;
    const variance = (this._sumSq - (this._sum * this._sum) / this._count) / (this._count - 1);
    return Math.sqrt(Math.max(0, variance));
  }

  /** 値vの標本が全体に占める割合。 */
  shareOf(v: number): number {
    return this._count > 0 ? (this.histogram.get(v) ?? 0) / this._count : NaN;
  }

  /** 最近隣法（nearest-rank）のpパーセンタイル: 昇順に並べたときceil(p×n)番目の標本値。 */
  percentile(p: number): number {
    if (this._count === 0) return NaN;
    const rank = Math.max(1, Math.ceil(p * this._count));
    let cumulative = 0;
    for (const key of [...this.histogram.keys()].sort((a, b) => a - b)) {
      cumulative += this.histogram.get(key) ?? 0;
      if (cumulative >= rank) return key;
    }
    return this._max;
  }
}
