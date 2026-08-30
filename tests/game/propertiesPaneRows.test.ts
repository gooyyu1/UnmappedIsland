import { describe, expect, it } from 'vitest';
import { clampScroll, minScrollFor, stackedLength } from '../../src/ui/scroll';

/**
 * プロパティのタブ（PropertiesPane）で、窓に収まらない行が送りで見えるようになるか。
 *
 * **プロパティの数で窓の寸法は変わらない**ので、タグに何本ぶら下がっても窓に出るのは同じ行数で、
 * 残りは送って見る。ここで数えるのは「送り切ったときに最後の行が窓の中に入るか」——タブごとの
 * 本数（腕前11本・状態9本）は世界の定義で増える一方なので、収まる本数を前提にできない。
 */
describe('プロパティのタブの行送り', () => {
  /** 行の高さと行同士の間隔（StatusBarのBAR_HEIGHT・PropertiesPaneのROW_GAP、u=1の画面）。 */
  const ROW_HEIGHT = 36;
  const ROW_GAP = 16;

  /** 窓に見えている高さ。7行ぶんちょうど（issue #1377 で「7つまでしか出ない」と見えていた状態）。 */
  const VIEWPORT = stackedLength(ROW_HEIGHT, ROW_GAP, 7);

  /** 送り量（0が先頭、送るほど負）を、その本数で送れる範囲へ収めたもの。 */
  const scrolledTo = (count: number, offset: number): number =>
    clampScroll(offset, minScrollFor(VIEWPORT, stackedLength(ROW_HEIGHT, ROW_GAP, count)));

  /** その送り量のとき、窓の中に丸ごと入っている行（0始まりの並び順）。 */
  const visibleRows = (count: number, offset: number): number[] => {
    const rows = [...Array(count).keys()];
    return rows.filter((index) => {
      const top = index * (ROW_HEIGHT + ROW_GAP) + offset;
      return top >= 0 && top + ROW_HEIGHT <= VIEWPORT;
    });
  };

  it('窓に収まる本数なら送り先を持たない', () => {
    expect(minScrollFor(VIEWPORT, stackedLength(ROW_HEIGHT, ROW_GAP, 7))).toBe(0);
    expect(visibleRows(7, 0)).toHaveLength(7);
  });

  it('1本も無いタブは送れない（間隔ぶん負の長さにしない）', () => {
    expect(stackedLength(ROW_HEIGHT, ROW_GAP, 0)).toBe(0);
    expect(minScrollFor(VIEWPORT, stackedLength(ROW_HEIGHT, ROW_GAP, 0))).toBe(0);
  });

  it('腕前の11本は、送り切ると11本目まで窓の中に入る', () => {
    // 送る前は先頭の7本（`石器`〜`料理`）だけ。
    expect(visibleRows(11, 0)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    const end = scrolledTo(11, -Infinity);
    expect(end, '4行ぶん送れる').toBe(-4 * (ROW_HEIGHT + ROW_GAP));
    expect(visibleRows(11, end), '末尾は`採鉱・製錬`まで').toEqual([4, 5, 6, 7, 8, 9, 10]);
  });

  it('状態の9本も、送り切ると`荷重`まで窓の中に入る', () => {
    expect(visibleRows(9, 0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(visibleRows(9, scrolledTo(9, -Infinity))).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('送り過ぎても、最後の行が窓の下端より上へは行かない', () => {
    const end = scrolledTo(11, -10000);
    const lastBottom = 10 * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT + end;
    expect(lastBottom).toBe(VIEWPORT);
  });
});
