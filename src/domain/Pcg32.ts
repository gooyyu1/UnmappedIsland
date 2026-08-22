const MULTIPLIER = 6364136223846793005n;
const INCREMENT = 1442695040888963407n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * 乱数列の用途。**1つの種から用途ごとに独立した列を作る**ので（forPurpose）、ある用途で引く回数を
 * 変えても他の用途の結果は動かない。用途はここに挙げたものだけで、同じ名前を2つの用途に使わない。
 *
 * - sites: 土地の配置（SitePlacer）
 * - names: 土地の命名（NameAssigner）
 * - play: 遊んでいる間の抽選（Rng.seededRng——pickの重み・初期値ロール・開始時刻）
 */
export type RandomPurpose = 'sites' | 'names' | 'play';

/**
 * 決定的な擬似乱数生成器（PCG-XSH-RR 32bit）。
 *
 * 実行環境に依存しない自前実装なのは、「同じシード→同じ島」の再現を将来にわたって保証するため。
 *
 * **列は用途ごとに分ける**（forPurpose）。1本を共有すると、ある用途で引く回数を変えただけで、
 * 触っていない用途の結果まで動く。ただし守れるのはそこまでで、**上流が出した値が変われば下流は
 * 動く**——サイト配置を変えれば、命名の列を分けていても型も名前も変わる。
 */
export class Pcg32 {
  /** 内部状態は64bit整数。numberでは精度が足りないためbigintで持つ。 */
  private state = 0n;

  /** その用途の列を作る。同じ種でも用途が違えば無関係な列になる。 */
  static forPurpose(seed: number, purpose: RandomPurpose): Pcg32 {
    return new Pcg32(seedFor(seed, purpose));
  }

  constructor(seed: number) {
    this.nextUint();
    this.state = (this.state + BigInt(seed >>> 0)) & MASK_64;
    this.nextUint();
  }

  nextUint(): number {
    const old = this.state;
    this.state = (old * MULTIPLIER + INCREMENT) & MASK_64;
    const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
    const rot = Number(old >> 59n);
    return ((xorshifted >>> rot) | (xorshifted << (-rot & 31))) >>> 0;
  }

  /** [0, 1) の一様乱数。 */
  nextDouble(): number {
    return this.nextUint() / 4294967296;
  }

  /** [minInclusive, maxExclusive) の一様な整数（Rngと同じ契約）。 */
  nextInt(minInclusive: number, maxExclusive: number): number {
    return minInclusive + Math.trunc(this.nextDouble() * (maxExclusive - minInclusive));
  }
}

/**
 * 種と用途名を混ぜて、その用途の種を作る（FNV-1a）。連番（s+1）ではなく混ぜるのは、隣の種の列と
 * 相関を持たせないため、そして用途が名前でコードに残るため。
 */
function seedFor(seed: number, purpose: RandomPurpose): number {
  let hash = Math.imul(seed >>> 0, 374761393) >>> 0;
  for (let i = 0; i < purpose.length; i++) {
    hash = Math.imul(hash ^ purpose.charCodeAt(i), 16777619) >>> 0;
  }
  return (hash ^ (hash >>> 16)) >>> 0;
}
