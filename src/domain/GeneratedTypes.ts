import type { ObjectDef } from './ObjectDef';

/**
 * 軸の値として「その軸を持たない」を表す識別子。`become: {recipe: none}` は、軸 `recipe` を落とした
 * 座標——つまり素の型——を指す（GameElementDefinition.md 9.9節）。
 */
export const NO_AXIS_VALUE = 'none';

/**
 * 生成された型が居る座標（GameElementDefinition.md 3.5節）。素の型（base）と、軸ごとの値の組。
 * 軸を1つも持たない座標は素の型そのものを指す。
 */
export interface GeneratedCoordinate {
  readonly baseGlobalId: number;

  /** 軸名 → 値の識別子。どちらも生成器が決める名前で、ここは意味を解釈しない。 */
  readonly axisValues: ReadonlyMap<string, string>;

  /**
   * 軸名 → 尽きるとその軸が外れるプロパティのグローバルID（宣言した軸だけ）。
   * **何が「量」かは宣言が決め、エンジンは名前を知りません**（`exhausted_when`、3.5.1節）。
   */
  readonly exhaustedWhen?: ReadonlyMap<string, number>;
}

/**
 * ロード時に生成された型の座標表（GameElementDefinition.md 3.5節）。生成型は素の型と軸の値の組で
 * 決まり、識別子はその組から組み立てた結果でしかないため、`become`（9.9節）は行き先を名前ではなく
 * 座標で指す。ここが持つのはその両方向の対応だけで、**軸の名前が何を意味するかは知らない**。
 */
export class GeneratedTypes {
  /** 生成型のグローバルID → 座標。素の型は登録しない（自分自身がbaseで、軸の値を持たない）。 */
  private readonly coordinates = new Map<number, GeneratedCoordinate>();

  /** 座標の鍵 → その座標に居る型のグローバルID。 */
  private readonly byKey = new Map<string, number>();

  /**
   * 生成した型を、その座標とともに登録する。同じ座標を2つの型が主張したらエラー——生成器が名前を
   * 組み立てる規則の取り違えは、黙って片方を捨てるより早く気付けるほうがよい。
   */
  register(globalId: number, coordinate: GeneratedCoordinate): void {
    const key = keyOf(coordinate);
    const existing = this.byKey.get(key);
    if (existing !== undefined && existing !== globalId)
      throw new Error(`生成型の座標 '${key}' を2つの型が主張しています。`);

    this.coordinates.set(globalId, coordinate);
    this.byKey.set(key, globalId);
  }

  /** defが今居る座標。生成型でなければ、自分自身をbaseとする軸の値を持たない座標。 */
  coordinateOf(def: ObjectDef): GeneratedCoordinate {
    return this.coordinates.get(def.globalId) ?? { baseGlobalId: def.globalId, axisValues: new Map() };
  }

  /**
   * defの座標から、axisValuesで指した軸だけを動かした先に居る型のグローバルID。
   * 誰も居なければundefined（3.5節。「この入れ物にはこれを入れられない」がこれで決まる）。
   *
   * 値が {@link NO_AXIS_VALUE} の軸は落とす。軸を1つも持たない座標へ着いたら素の型そのもの。
   */
  tryResolve(def: ObjectDef, axisValues: ReadonlyMap<string, string>): number | undefined {
    const current = this.coordinateOf(def);
    const moved = new Map(current.axisValues);
    for (const [axis, value] of axisValues) {
      if (value === NO_AXIS_VALUE) moved.delete(axis);
      else moved.set(axis, value);
    }

    if (moved.size === 0) return current.baseGlobalId;
    return this.byKey.get(keyOf({ baseGlobalId: current.baseGlobalId, axisValues: moved }));
  }

  /**
   * defの軸のうち、そのプロパティが尽きたときに外れるもの（軸名 → プロパティのグローバルID）。
   * 宣言が無い軸は含まれない。
   */
  exhaustionRulesOf(def: ObjectDef): ReadonlyMap<string, number> {
    return this.coordinates.get(def.globalId)?.exhaustedWhen ?? EMPTY_RULES;
  }

  /** defが軸axisの値を持つ生成型なら、その素の型のグローバルID。そうでなければundefined。 */
  baseAlong(def: ObjectDef, axis: string): number | undefined {
    const coordinate = this.coordinates.get(def.globalId);
    return coordinate?.axisValues.has(axis) === true ? coordinate.baseGlobalId : undefined;
  }
}

const EMPTY_RULES: ReadonlyMap<string, number> = new Map();

/** 座標を1つの文字列へ畳む。軸は宣言順を持たないので、名前で整列してから並べる。 */
function keyOf(coordinate: GeneratedCoordinate): string {
  const axes = [...coordinate.axisValues]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([axis, value]) => `${axis}=${value}`);
  return `${coordinate.baseGlobalId}:${axes.join(',')}`;
}
