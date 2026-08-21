import { describe, expect, it } from 'vitest';
import type { CardContent } from '../../src/game/ui/Card';
import { LANE_CELLS_MAX, plainCells, unboundedSlot } from '../../src/game/ui/laneCells';

const card = (name: string): CardContent => ({ icon: '🪵', name });

/** その並びのうち、カードの入っていない枠の数。 */
const emptyCells = (cells: readonly { readonly card?: CardContent }[]): number =>
  cells.filter((cell) => cell.card === undefined).length;

/**
 * カードの並びから作る枠の並び（Windows.md 1節 スロットの子ウィンドウ）。枠数
 * （cell_count、SlotSystem.md 2節）の決まったスロットはその数だけ、決まっていなければ末尾に
 * 1つだけ受け皿の空枠を添える。
 */
describe('レーンの枠', () => {
  it('カードは位置を保ったまま枠に入る', () => {
    const cells = plainCells([card('丸太'), undefined, card('石')], 3, false);
    expect(cells.map((cell) => cell.card?.name)).toEqual(['丸太', undefined, '石']);
  });

  it('枠数の決まったスロットは、埋まるまで常にその数の枠を見せる', () => {
    expect(plainCells([], 1, true), '1枠のスロットは空なら1枠').toHaveLength(1);
    expect(
      plainCells([card('包帯')], 1, true),
      '埋まれば1枠——2枠目は「もう1つ当てられる」と誤って伝わる',
    ).toHaveLength(1);
    expect(plainCells([card('丸太')], 3, true)).toHaveLength(3);
    expect(emptyCells(plainCells([card('丸太')], 3, true))).toBe(2);
  });

  it('無制限のスロットは末尾に1枠だけ添える', () => {
    expect(emptyCells(plainCells([], undefined, true))).toBe(1);
    expect(emptyCells(plainCells([card('石'), card('葉')], undefined, true))).toBe(1);
    expect(unboundedSlot(undefined)).toBe(true);
  });

  it('一度に見せられる数を超える枠も、枠数のぶんだけ並べる', () => {
    // 見える数（LANE_CELLS_MAX）は窓の幅の話で、枠数の上限ではない。入り切らない枠は横スクロールで
    // 送れるので、10枠の編み籠でも「あと何枠空いているか」が見て取れる。
    const cellCount = LANE_CELLS_MAX + 6;

    expect(unboundedSlot(cellCount)).toBe(false);
    expect(emptyCells(plainCells([card('石')], cellCount, true))).toBe(cellCount - 1);
  });

  it('受け入れないスロットは空枠を出さない', () => {
    expect(emptyCells(plainCells([], 1, false)), '怪我のように外から入れられない場所').toBe(0);
    expect(emptyCells(plainCells([card('捻挫')], undefined, false))).toBe(0);
  });

  it('枠数を超えて入っていても、空枠は増えない', () => {
    expect(emptyCells(plainCells([card('丸太'), card('石'), card('葉')], 1, true))).toBe(0);
  });
});
