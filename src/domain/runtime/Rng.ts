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

/** 既定の乱数源（非決定）。 */
export function randomRng(): Rng {
  return {
    nextDouble: () => Math.random(),
    nextInt: (minInclusive, maxExclusive) =>
      minInclusive + Math.floor(Math.random() * (maxExclusive - minInclusive)),
  };
}
