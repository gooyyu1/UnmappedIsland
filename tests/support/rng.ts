import type { Rng } from '../../src/domain/runtime/Rng';

/**
 * 常に同じ値を返す乱数源。pick（GameElementDefinition.md 10節）がどの候補を引くかを、
 * テストから名指しで決めるために使う。
 *
 * pickは `nextDouble() × 重みの合計` と候補の重みの累積を比べるので、合計100の候補列なら
 * 0.0で先頭、0.95で「重み5以下の末尾」というように、割合そのものを渡せばよい。
 */
export function fixedRng(value: number): Rng {
  return {
    nextDouble: () => value,
    nextInt: (minInclusive, maxExclusive) => minInclusive + Math.trunc(value * (maxExclusive - minInclusive)),
  };
}
