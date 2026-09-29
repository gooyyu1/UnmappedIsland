import { describe, expect, it } from 'vitest';
import { LoadReport } from '../../src/loader/LoadReport';

/**
 * 読み込みで捨てたものの記録（LoadReport、AssetPack.md 6.1節）に対する自動テスト。
 *
 * 見ているのは`problems`が渡すもの——**実体を渡すという名乗り**（同口のdoc）で、`forgetAfter`は
 * 読んだ側が数えた`problems.length`を印として受け取るので、渡すものが写しへ変わると印の意味も変わる。
 */
describe('捨てた記録が渡すもの', () => {
  it('並びは実体で、読んだ後の足し引きがそのまま見える', () => {
    const report = new LoadReport();
    report.addDiscarded('a.yaml', undefined, '先に在ったぶん');

    const read = report.problems;
    const mark = read.length;
    report.addDiscarded('b.yaml', undefined, '読んだ後に足したぶん');

    expect(
      read.map((problem) => problem.source),
      '足したぶんも同じ並びから見える',
    ).toEqual(['a.yaml', 'b.yaml']);

    report.forgetAfter(mark);
    expect(
      read.map((problem) => problem.source),
      '戻したぶんもそのまま見える',
    ).toEqual(['a.yaml']);
  });
});
