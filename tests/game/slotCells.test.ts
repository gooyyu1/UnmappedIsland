import { describe, expect, it } from 'vitest';
import { COLOR } from '../../src/game/looks/theme';
import type { CardContent } from '../../src/game/ui/Card';
import { LANE_CELLS_MAX } from '../../src/game/ui/laneCells';
import type { CraftingMaterial } from '../../src/game/view/craftingView';
import type { ObjectCardStack, SlotView } from '../../src/game/view/PlayScreenView';
import { materialCells, plainCells, slotCells } from '../../src/game/view/slotCells';

const card = (name: string): CardContent => ({ icon: '🪵', name });

/** その並びのうち、カードの入っていない枠の数。 */
const emptyCells = (cells: readonly { readonly card?: CardContent }[]): number =>
  cells.filter((cell) => cell.card === undefined).length;

/** 枠の並びを決める宣言だけを持つスロット（見出し・敷く絵は枠に効かない）。 */
const slot = (options: Partial<SlotView> = {}): SlotView => ({
  key: 'slot',
  label: 'スロット',
  cells: 'grows',
  acceptsCards: true,
  background: undefined,
  materials: undefined,
  ...options,
});

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

/**
 * その場所に並べる枠（slotCells）の自動テスト。**枠ごとの飾りを持つのは材料スロットだけ**で、
 * 他はスロットの宣言（空けておく枠・受け入れの可否）をそのまま形にする。
 */
describe('スロットの枠', () => {
  it('材料の要求を持つスロットだけが、飾りの付いた枠になる', () => {
    const cards = [card('丸太')];
    const plain = slot({ cells: 3 });
    const materials = slot({ cells: 3, materials: [material({ objectGlobalIds: [1] })] });

    expect(slotCells(plain, [undefined], cards, 0, cardOfType), '宣言どおりの3枠').toHaveLength(3);
    expect(
      slotCells(materials, [stack(1)], cards, 0, cardOfType)[0].borderColor,
      '要求の枠は縁が染まる',
    ).toBe(COLOR.cellCurrentStep);
  });
});

/**
 * 宣言をそのまま形にする枠（plainCells、Windows.md 1節 スロットの子ウィンドウ）。枠数
 * （cell_count、SlotSystem.md 3節）を宣言したスロットはその数だけ、宣言していなければ末尾に
 * 1つだけ受け皿の空枠を添える。
 */
describe('クセの無い枠', () => {
  it('カードは位置を保ったまま枠に入る', () => {
    const cells = plainCells(slot({ cells: 3, acceptsCards: false }), [card('丸太'), undefined, card('石')]);

    expect(cells.map((cell) => cell.card?.name)).toEqual(['丸太', undefined, '石']);
  });

  it('枠数の決まったスロットは、埋まるまで常にその数の枠を見せる', () => {
    expect(plainCells(slot({ cells: 1 }), []), '1枠のスロットは空なら1枠').toHaveLength(1);
    expect(
      plainCells(slot({ cells: 1 }), [card('包帯')]),
      '埋まれば1枠——2枠目は「もう1つ当てられる」と誤って伝わる',
    ).toHaveLength(1);
    expect(plainCells(slot({ cells: 3 }), [card('丸太')])).toHaveLength(3);
    expect(emptyCells(plainCells(slot({ cells: 3 }), [card('丸太')]))).toBe(2);
  });

  it('落とせば枠が増えるスロットは、末尾に1枠だけ添える', () => {
    // 一度に増える枠は1つなので、見せる先も1つ。
    expect(emptyCells(plainCells(slot(), []))).toBe(1);
    expect(emptyCells(plainCells(slot(), [card('石'), card('葉')]))).toBe(1);
  });

  it('一度に見せられる数を超える枠も、枠数のぶんだけ並べる', () => {
    // 見える数（LANE_CELLS_MAX）は窓の幅の話で、枠数の上限ではない。入り切らない枠は横スクロールで
    // 送れるので、10枠の編み籠でも「あと何枠空いているか」が見て取れる。
    const cells = LANE_CELLS_MAX + 6;

    expect(emptyCells(plainCells(slot({ cells }), [card('石')]))).toBe(cells - 1);
  });

  it('受け入れないスロットは空枠を出さない', () => {
    expect(
      emptyCells(plainCells(slot({ cells: 1, acceptsCards: false }), [])),
      '怪我のように外から入れられない場所',
    ).toBe(0);
    expect(emptyCells(plainCells(slot({ acceptsCards: false }), [card('捻挫')]))).toBe(0);
  });

  it('枠数を超えて入っていても、空枠は増えない', () => {
    expect(emptyCells(plainCells(slot({ cells: 1 }), [card('丸太'), card('石'), card('葉')]))).toBe(0);
  });
});

/**
 * 製作中オブジェクトの材料の枠（materialCells）。
 *
 * 要求の中身は見ない——何がどれだけ要るかを決めるのは世界側（craftingMaterials）で、ここで見るのは
 * **その要求を何枠にどう並べるか**だけ。
 */
describe('材料の枠', () => {
  const cellsOf = (options: {
    materials: readonly CraftingMaterial[];
    stacks: readonly (ObjectCardStack | undefined)[];
    cycle?: number;
  }) =>
    materialCells(
      options.materials,
      options.stacks,
      options.stacks.map((held) => (held === undefined ? undefined : (held as CardContent))),
      options.cycle ?? 0,
      cardOfType,
    );

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
