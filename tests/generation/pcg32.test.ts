import { describe, expect, it } from 'vitest';
import { Pcg32 } from '../../src/domain/Pcg32';

describe('Pcg32', () => {
  // 期待値はPCG-XSH-RR 32bit（このクラスと同じ定数）の参照実装から得た固定値。
  // 実行環境やリファクタリングを跨いで「同じシード→同じ乱数列」が保たれることを保証する。
  it.each([
    [0, [3894649422, 2055130073, 2315086854, 2925816488, 3443325253]],
    [1, [1412771199, 1791099446, 124312908, 1968572995, 1080415314]],
    [42, [3270867926, 1795671209, 1924641435, 1143034755, 4121910957]],
    [-1, [1690806306, 1175666736, 601713809, 1455133790, 2659000460]],
  ])('シード%iで既知の乱数列を再現する', (seed, expected) => {
    const rng = new Pcg32(seed);
    expect(expected.map(() => rng.nextUint())).toEqual(expected);
  });

  it('nextDoubleは[0, 1)の値を返す', () => {
    const rng = new Pcg32(12345);
    for (let i = 0; i < 1000; i++) {
      const value = rng.nextDouble();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('nextIntは[min, max)の下端を含み上端を含まない', () => {
    const rng = new Pcg32(7);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const value = rng.nextInt(1, 4);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThan(4);
      seen.add(value);
    }
    expect(seen).toEqual(new Set([1, 2, 3]));
  });

  it('用途が違えば無関係な列になる（同じ種でも）', () => {
    const seed = 12345;
    const sites = Pcg32.forPurpose(seed, 'sites');
    const names = Pcg32.forPurpose(seed, 'names');
    const drawn = (rng: Pcg32): number[] => Array.from({ length: 5 }, () => rng.nextUint());

    expect(drawn(sites)).not.toEqual(drawn(names));
    // 同じ種と用途なら何度作っても同じ列（再現性の土台）。
    expect(drawn(Pcg32.forPurpose(seed, 'sites'))).toEqual(drawn(Pcg32.forPurpose(seed, 'sites')));
  });
});
