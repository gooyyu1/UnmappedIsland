import { Pcg32 } from './Pcg32';

/**
 * pickの重み付き抽選（10節）と初期値ロール（6.2節）に使う乱数源。
 * テストで決定的に振る舞わせられるよう、WorldSessionのコンストラクタで差し替え可能。
 */
export interface Rng {
  /** [0, 1) の一様乱数。 */
  nextDouble(): number;

  /** [minInclusive, maxExclusive) の一様な整数。 */
  nextInt(minInclusive: number, maxExclusive: number): number;
}

/** Fisher-Yatesの一様シャッフル。元の配列は変えない。 */
export function shuffled<T>(values: readonly T[], rng: Rng): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 重み付き抽選で1つ選ぶ。負の重みは0として扱う（選ばれない）。候補が空、あるいは重みの合計が0なら
 * 選べないのでundefined——「1つも引けなかったときにどうするか」は、抽選ではなく呼び出し側の決めごと。
 */
export function pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number, rng: Rng): T | undefined {
  const weights = items.map((item) => Math.max(0, weightOf(item)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return undefined;

  const roll = rng.nextDouble() * total;
  let cumulative = 0;
  for (let i = 0; i < items.length; i++) {
    cumulative += weights[i];
    if (roll < cumulative) return items[i];
  }

  return items[items.length - 1];
}

/** 既定の乱数源（非決定）。 */
export function randomRng(): Rng {
  return {
    nextDouble: () => Math.random(),
    nextInt: (minInclusive, maxExclusive) =>
      minInclusive + Math.floor(Math.random() * (maxExclusive - minInclusive)),
  };
}

/**
 * シードから作る決定的な乱数源。地形生成とは別の列なので（RandomPurpose）、地形レイアウトは
 * こちらの消費順序に影響されない。
 */
export function seededRng(seed: number): Rng {
  return Pcg32.forPurpose(seed, 'play');
}
