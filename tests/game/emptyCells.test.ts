import { describe, expect, it } from 'vitest';
import { emptyCellsFor, LANE_CELLS_MAX } from '../../src/game/ui/laneCells';

/**
 * レーンの末尾に出す受け皿の空枠の数（ScreenLayout.md スロットの子ウィンドウ節）。枠数
 * （unit_capacity、SlotSystem.md 2節）の決まったスロットはその数だけ、無制限なら1つだけ添える。
 */
describe('受け皿の空枠の数', () => {
  it('枠数の決まったスロットは、埋まるまで常にその数の枠を見せる', () => {
    expect(emptyCellsFor(0, 1, true), '1枠のスロットは空なら1枠').toBe(1);
    expect(emptyCellsFor(1, 1, true), '埋まれば0枠——2枠目は「もう1つ入る」と誤って伝わる').toBe(0);
    expect(emptyCellsFor(1, 3, true), '3枠のスロットに1枚入っていれば残り2枠').toBe(2);
    expect(emptyCellsFor(3, 3, true)).toBe(0);
  });

  it('無制限のスロットは末尾に1枠だけ添える', () => {
    expect(emptyCellsFor(0, undefined, true)).toBe(1);
    expect(emptyCellsFor(5, undefined, true)).toBe(1);
    // 並べ切れない枠数は無制限と区別が付かないので、同じ扱いにする。
    expect(emptyCellsFor(2, 9999, true)).toBe(1);
    expect(emptyCellsFor(0, LANE_CELLS_MAX + 1, true)).toBe(1);
  });

  it('受け入れないスロットは枠を出さない', () => {
    expect(emptyCellsFor(0, 1, false), '怪我のように外から入れられない場所').toBe(0);
    expect(emptyCellsFor(1, undefined, false)).toBe(0);
  });

  it('枠数を超えて入っていても、負の枠数にはならない', () => {
    expect(emptyCellsFor(3, 1, true)).toBe(0);
  });
});
