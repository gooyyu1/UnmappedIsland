const MULTIPLIER = 6364136223846793005n;
const INCREMENT = 1442695040888963407n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * 決定的な擬似乱数生成器（PCG-XSH-RR 32bit）。地形生成と、シードから作るWorldSession.rng
 * （Rng.seededRng）が、それぞれ別インスタンスとして使う。
 *
 * 実行環境に依存しない自前実装なのは、(a)「同じシード→同じ島」の再現を将来にわたって保証するため、
 * (b)WorldSession.rng（pickの抽選・初期値ロール）とインスタンスを分離することで、他の抽選の消費順序に
 * 依らず地形レイアウトが決定的であることを保証するため。
 */
export class Pcg32 {
  /** 内部状態は64bit整数。numberでは精度が足りないためbigintで持つ。 */
  private state = 0n;

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

  /** [minInclusive, maxInclusive] の一様な整数。 */
  nextInt(minInclusive: number, maxInclusive: number): number {
    const span = maxInclusive - minInclusive + 1;
    return minInclusive + Math.trunc(this.nextDouble() * span);
  }
}
