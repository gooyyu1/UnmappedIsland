import { describe, expect, it } from 'vitest';
import { COLOR } from '../../src/game/looks/theme';
import type { CardContent } from '../../src/game/ui/Card';
import type { CraftingMaterial } from '../../src/game/view/craftingView';
import { materialCells } from '../../src/game/view/materialCells';
import type { ObjectCardStack } from '../../src/game/view/PlayScreenView';

/**
 * 製作中オブジェクトの材料レーンの枠（materialCells）の自動テスト。
 *
 * 要求の中身は見ない——何がどれだけ要るかを決めるのは世界側（craftingMaterials）で、ここで見るのは
 * **その要求を何枠にどう並べるか**だけ。
 */
describe('材料レーンの枠', () => {
  /** 型そのものを表す札。どの型を出したかが分かればよい。 */
  const cardOfType = (objectGlobalId: number): CardContent =>
    ({ icon: '📦', name: `type#${objectGlobalId}` }) as CardContent;

  const material = (options: Partial<CraftingMaterial> = {}): CraftingMaterial => ({
    objectGlobalIds: [1],
    needed: 1,
    held: 0,
    inCurrentStep: true,
    ...options,
  });

  /** その型を1つ入れた枠。 */
  const stack = (objectGlobalId: number): ObjectCardStack =>
    ({ objectGlobalId, name: `held#${objectGlobalId}` }) as ObjectCardStack;

  const cellsOf = (options: {
    materials: readonly CraftingMaterial[];
    stacks: readonly (ObjectCardStack | undefined)[];
    cycle?: number;
  }) =>
    materialCells({
      materials: options.materials,
      stacks: options.stacks,
      cards: options.stacks.map((held) => (held === undefined ? undefined : (held as CardContent))),
      cycle: options.cycle ?? 0,
      cardOfType,
    });

  it('何も入っていなければ、要求の数だけ透かしの入った空き枠が出る', () => {
    // 材料スロットは要求ごとの枠を持つので、その空き枠をそのまま並べると、透かしの入らない枠が
    // 要求の数だけ並んだ後ろに透かしの入った枠が続くことになる（a75472aの回帰）。
    const materials = [material({ objectGlobalIds: [1] }), material({ objectGlobalIds: [2] })];

    const cells = cellsOf({ materials, stacks: [undefined, undefined] });

    expect(cells).toHaveLength(2);
    expect(cells.map((cell) => cell.accepts?.name)).toEqual(['type#1', 'type#2']);
    expect(
      cells.every((cell) => cell.card === undefined),
      'どれも空き枠',
    ).toBe(true);
  });

  it('入っている枠は、札と印の両方を持つ', () => {
    const materials = [material({ objectGlobalIds: [1], needed: 3, held: 1 })];

    const [cell] = cellsOf({ materials, stacks: [stack(1)] });

    expect(cell.card?.name).toBe('held#1');
    expect(cell.overlay, '2つ以上要る枠は、あといくつかを出す').toBe('1/3');
  });

  it('入っている要求は、空き枠として重ねて出さない', () => {
    const materials = [material({ objectGlobalIds: [1] }), material({ objectGlobalIds: [2] })];

    const cells = cellsOf({ materials, stacks: [stack(1), undefined] });

    expect(cells).toHaveLength(2);
    expect(cells[0].card?.name, '入っている枠').toBe('held#1');
    expect(cells[1].accepts?.name, 'まだ入っていない要求の空き枠').toBe('type#2');
  });

  it('もう要求されない型は、取り出すための枠として残るが印は持たない', () => {
    // 工程を終えて出番が済んだ型。こぼす前に取り出せるよう枠は残る。
    const cells = cellsOf({ materials: [material({ objectGlobalIds: [1] })], stacks: [stack(9)] });

    expect(cells[0].card?.name).toBe('held#9');
    expect(cells[0].accepts, '何を入れる枠でもない').toBeUndefined();
    expect(cells[0].borderColor).toBeUndefined();
  });

  it('1つしか要らない枠には数を出さない', () => {
    // 枠そのものが既に「1つ」と言っているので、繰り返しにしかならない。
    const [cell] = cellsOf({ materials: [material({ needed: 1, held: 0 })], stacks: [] });

    expect(cell.overlay).toBeUndefined();
  });

  it('今の工程の枠と、後の工程の枠は縁の色で分ける', () => {
    const materials = [
      material({ objectGlobalIds: [1], inCurrentStep: true }),
      material({ objectGlobalIds: [2], inCurrentStep: false }),
    ];

    const cells = cellsOf({ materials, stacks: [] });

    expect(cells[0].borderColor).toBe(COLOR.cellCurrentStep);
    expect(cells[1].borderColor).toBe(COLOR.cellLaterStep);
  });

  it('タグの要求は、拍ごとに当てはまる型を順に出す', () => {
    // どれか1つを選んで出すと、その型でなければ入らないように見えてしまう。
    const materials = [material({ objectGlobalIds: [4, 5, 6] })];
    const shownAt = (cycle: number) => cellsOf({ materials, stacks: [], cycle })[0].accepts?.name;

    expect([0, 1, 2, 3].map(shownAt)).toEqual(['type#4', 'type#5', 'type#6', 'type#4']);
  });
});
