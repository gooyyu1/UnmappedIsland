import type { Rng } from '../../src/domain/Rng';

/**
 * 意図した値列を順に返す乱数スタブ。抽選結果に依存するテストで、シード任せにせず
 * 「どの抽選でどの値が出るか」をシナリオとして明示するために使う。
 * 用意した値を使い切ったあとに呼ばれたら（テストの想定漏れなので）例外を投げる。
 */
export class StubRng implements Rng {
  private readonly doubles: number[];
  private readonly ints: number[];

  constructor(values: { doubles?: number[]; ints?: number[] }) {
    this.doubles = [...(values.doubles ?? [])];
    this.ints = [...(values.ints ?? [])];
  }

  nextDouble(): number {
    const value = this.doubles.shift();
    if (value === undefined) throw new Error('StubRng: nextDoubleの用意した値を使い切りました。');
    return value;
  }

  nextInt(minInclusive: number, maxExclusive: number): number {
    const value = this.ints.shift();
    if (value === undefined) throw new Error('StubRng: nextIntの用意した値を使い切りました。');
    if (value < minInclusive || value >= maxExclusive)
      throw new Error(`StubRng: 用意した値${value}が要求範囲[${minInclusive}, ${maxExclusive})の外です。`);
    return value;
  }
}
