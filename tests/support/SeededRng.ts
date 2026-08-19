import { Pcg32 } from '../../src/domain/generation/Pcg32';
import type { Rng } from '../../src/domain/Rng';

/** シードで決定的に振る舞うRng実装。「同じシード→同じ結果」の再現性を検証するテスト用。 */
export class SeededRng implements Rng {
  private readonly pcg: Pcg32;

  constructor(seed: number) {
    this.pcg = new Pcg32(seed);
  }

  nextDouble(): number {
    return this.pcg.nextDouble();
  }

  nextInt(minInclusive: number, maxExclusive: number): number {
    return minInclusive + Math.trunc(this.pcg.nextDouble() * (maxExclusive - minInclusive));
  }
}
