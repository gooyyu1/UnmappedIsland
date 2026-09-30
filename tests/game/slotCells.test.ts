import { describe, expect, it } from 'vitest';
import type { ObjectGlobalId } from '../../src/domain/GlobalId';
import type { WorldObject } from '../../src/domain/WorldObject';
import { COLOR } from '../../src/game/looks/theme';
import type { CardContent } from '../../src/game/ui/Card';
import type { CraftingMaterial } from '../../src/game/view/craftingView';
import type { ObjectCardStack, SlotView } from '../../src/game/view/PlayScreenView';
import { cellsCycleWithBeat, slotCells } from '../../src/game/view/slotCells';

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
  typesShownInEmptyCells: [],
  ...options,
});

/**
 * 型のグローバルID。**この試験はCodexを持たない**——枠の並びは型の中身を見ないので、どの型かを
 * 区別できれば足りる。名前空間を通さずに素の数からIDにするのは、そのぶんここだけ。
 */
const typeId = (id: number): ObjectGlobalId => id as ObjectGlobalId;

/** 型そのものを表す札。どの型を出したかが分かればよい。 */
const cardOfType = (objectGlobalId: ObjectGlobalId): CardContent =>
  ({ icon: '📦', name: `type#${objectGlobalId}` }) as CardContent;

/**
 * その型の個体のインスタンスID。**枠の並びは個体の中身を見ない**——どの要求へ当たったかを引く鍵として、
 * 型ごとに1つあれば足りる（束を2つ以上の個体で組む試験は、自分でIDを並べる）。
 */
const instanceOf = (objectGlobalId: ObjectGlobalId): number => 1000 + objectGlobalId;

/**
 * 要求1件。**当てた物は、要求している型の個体すべて**を既定にする——型から要求を引いていたときと
 * 同じ見え方になるので、割り当てが振り替わる場面だけを試験の側で書けばよい。
 */
const material = (options: Partial<CraftingMaterial> = {}): CraftingMaterial => {
  const objectGlobalIds = options.objectGlobalIds ?? [typeId(1)];
  return {
    objectGlobalIds,
    needed: 1,
    held: 0,
    allocated: new Set(objectGlobalIds.map(instanceOf)),
    inCurrentStep: true,
    ...options,
  };
};

/** その型の個体を入れた枠（既定は型ごとの1つ）。 */
const stack = (
  objectGlobalId: ObjectGlobalId,
  instanceIds: readonly number[] = [instanceOf(objectGlobalId)],
): ObjectCardStack =>
  ({
    objects: instanceIds.map((instanceId) => ({ instanceId }) as WorldObject),
    name: `held#${objectGlobalId}`,
  }) as unknown as ObjectCardStack;

/**
 * 材料の要求を持たないスロットの枠。**枠を並べる入口はslotCellsだけ**なので、材料の枠しか使わない
 * 引数（入っている物）はここで埋める。拍は呼び出し側が渡せる——枠ごとの受け入れも拍で送るため。
 */
const plainCells = (slot: SlotView, cards: readonly (CardContent | undefined)[], cycle = 0) =>
  slotCells(slot, [], cards, cycle, cardOfType);

/**
 * その場所に並べる枠（slotCells）の自動テスト。**縁の色と重ねる文字を持つのは材料スロットだけ**で、
 * 他はスロットの宣言（空けておく枠・受け入れの可否）をそのまま形にする。
 */
describe('スロットの枠', () => {
  it('材料の要求を持つスロットだけが、飾りの付いた枠になる', () => {
    const cards = [card('丸太')];
    const plain = slot({ cells: 3 });
    const materials = slot({ cells: 3, materials: [material({ objectGlobalIds: [typeId(1)] })] });

    expect(slotCells(plain, [undefined], cards, 0, cardOfType), '宣言どおりの3枠').toHaveLength(3);
    expect(
      slotCells(materials, [stack(typeId(1))], cards, 0, cardOfType)[0].borderColor,
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
    // 一度に見せる数（laneCellsのLANE_CELLS_MAX）は窓の幅の話で、枠数の上限ではない。入り切らない枠は
    // 横スクロールで送れるので、10枠の編み籠でも「あと何枠空いているか」が見て取れる。
    const cells = 10;

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

  it('枠が名乗る型は、空き枠のうちに薄く敷いて見せる', () => {
    // 炉の火床。火の中の枠（焼く物）と石の上の枠（器）で、受けるものが違う。
    const hearth = slot({ cells: 2, typesShownInEmptyCells: [[typeId(1)], [typeId(2)]] });

    expect(plainCells(hearth, []).map((cell) => cell.accepts?.name)).toEqual(['type#1', 'type#2']);
  });

  it('名乗る型を持たない枠は、何も敷かない', () => {
    // 手持ちのように、どの枠も同じものを受ける場所（typesShownInEmptyCellsが空）。
    expect(plainCells(slot({ cells: 2 }), []).map((cell) => cell.accepts)).toEqual([undefined, undefined]);
  });

  it('埋まっている枠には敷かない', () => {
    const hearth = slot({ cells: 2, typesShownInEmptyCells: [[typeId(1)], [typeId(2)]] });
    const cells = plainCells(hearth, [card('焼けた肉'), undefined]);

    expect(
      cells.map((cell) => cell.accepts?.name),
      '札の下に透かしは要らない',
    ).toEqual([undefined, 'type#2']);
  });

  it('当てはまる型が複数ある枠は、拍ごとに順に出す', () => {
    // どれか1つを選んで出すと、その型でなければ入らないように見えてしまう。
    const hearth = slot({ cells: 1, typesShownInEmptyCells: [[typeId(1), typeId(2)]] });
    const shownAt = (cycle: number) => plainCells(hearth, [], cycle)[0].accepts?.name;

    expect([shownAt(0), shownAt(1), shownAt(2)]).toEqual(['type#1', 'type#2', 'type#1']);
  });

  it('拍で出し替わる枠があるかを、引き直す側へ答える', () => {
    // 出す型が1つしかないなら、拍を進めても見た目は変わらない（PlayScene.advanceEmptyCellCycle）。
    expect(cellsCycleWithBeat(slot({ typesShownInEmptyCells: [[typeId(1)]] })), '1つなら要らない').toBe(
      false,
    );
    expect(cellsCycleWithBeat(slot({ typesShownInEmptyCells: [[], [typeId(1), typeId(2)]] }))).toBe(true);
    expect(
      cellsCycleWithBeat(slot({ materials: [material({ objectGlobalIds: [typeId(1), typeId(2)] })] })),
      '材料の枠も同じ拍で動く',
    ).toBe(true);
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
    slotCells(
      slot({ materials: options.materials }),
      options.stacks,
      options.stacks.map((held) => (held === undefined ? undefined : (held as CardContent))),
      options.cycle ?? 0,
      cardOfType,
    );

  it('何も入っていなければ、要求の数だけ透かしの入った空き枠が出る', () => {
    // 材料スロットは要求ごとの枠を持つので、その空き枠をそのまま並べると、透かしの入らない枠が
    // 要求の数だけ並んだ後ろに透かしの入った枠が続くことになる（a75472aの回帰）。
    const materials = [
      material({ objectGlobalIds: [typeId(1)] }),
      material({ objectGlobalIds: [typeId(2)] }),
    ];

    const cells = cellsOf({ materials, stacks: [undefined, undefined] });

    expect(cells).toHaveLength(2);
    expect(cells.map((cell) => cell.accepts?.name)).toEqual(['type#1', 'type#2']);
    expect(
      cells.every((cell) => cell.card === undefined),
      'どれも空き枠',
    ).toBe(true);
  });

  it('入っている枠は、札と印の両方を持つ', () => {
    const materials = [material({ objectGlobalIds: [typeId(1)], needed: 3, held: 1 })];

    const [cell] = cellsOf({ materials, stacks: [stack(typeId(1))] });

    expect(cell.card?.name).toBe('held#1');
    expect(cell.overlay, '2つ以上要る枠は、あといくつかを出す').toBe('1/3');
  });

  it('入っている要求は、空き枠として重ねて出さない', () => {
    const materials = [
      material({ objectGlobalIds: [typeId(1)] }),
      material({ objectGlobalIds: [typeId(2)] }),
    ];

    const cells = cellsOf({ materials, stacks: [stack(typeId(1)), undefined] });

    expect(cells).toHaveLength(2);
    expect(cells[0].card?.name, '入っている枠').toBe('held#1');
    expect(cells[1].accepts?.name, 'まだ入っていない要求の空き枠').toBe('type#2');
  });

  it('入っている物の印は、型ではなく当てられた要求から引く', () => {
    // 型2はタグの要求（型1・2）にも型2の要求にも当てはまるが、当てられたのは後者。型から引くと、
    // 先に書いたタグの要求の枠に数が出て、型2の要求は空き枠として重ねて出る。
    const materials = [
      material({ objectGlobalIds: [typeId(1), typeId(2)], allocated: new Set() }),
      material({ objectGlobalIds: [typeId(2)], needed: 2, held: 1 }),
    ];

    const cells = cellsOf({ materials, stacks: [stack(typeId(2))] });

    expect(cells.map((cell) => [cell.card?.name, cell.overlay])).toEqual([
      ['held#2', '1/2'],
      [undefined, undefined],
    ]);
    expect(cells[1].accepts?.name, 'まだ何も当たっていないタグの要求の空き枠').toBe('type#1');
  });

  it('2つの要求に当たっている物は、今の工程の要求の枠に出る', () => {
    // 前の工程の道具を後の工程が素材として消費する物（crafting.heldPerRemainingRequirement）。
    // 並びは要求の順で、今の工程の要求が先に来る（craftingMaterials）。
    const materials = [
      material({ objectGlobalIds: [typeId(1), typeId(2)], needed: 2, held: 1, inCurrentStep: true }),
      material({ objectGlobalIds: [typeId(2)], needed: 3, held: 1, inCurrentStep: false }),
    ];

    const [cell] = cellsOf({ materials, stacks: [stack(typeId(2))] });

    expect(cell.overlay).toBe('1/2');
    expect(cell.borderColor).toBe(COLOR.cellCurrentStep);
  });

  it('束の中身が2つの要求に分かれて当たったら、多く当たっているほうの枠に出る', () => {
    // 並びが先のタグの要求（型1・2）には1つ、後の型2の要求には2つ当たっている。
    const materials = [
      material({ objectGlobalIds: [typeId(1), typeId(2)], allocated: new Set([21]) }),
      material({ objectGlobalIds: [typeId(2)], needed: 2, held: 2, allocated: new Set([22, 23]) }),
    ];

    const cells = cellsOf({ materials, stacks: [stack(typeId(2), [21, 22, 23])] });

    expect(cells[0].overlay).toBe('2/2');
    expect(cells[1].card, '束が出ていない要求は空き枠として足す').toBeUndefined();
  });

  it('子ウィンドウへ貸し出して待ち印だけが残った束も、同じ要求の枠に出る', () => {
    // 待ち印の束は個体を1つも出していない（objectsが空）。待っている個体で引かないと印が消え、
    // 同じ要求の空き枠が重ねて出る。
    const materials = [material({ objectGlobalIds: [typeId(2)], needed: 2, held: 1 })];
    const awaiting = { ...stack(typeId(2), []), awaited: [instanceOf(typeId(2))] };

    const cells = cellsOf({ materials, stacks: [awaiting] });

    expect(cells.map((cell) => [cell.card?.name, cell.overlay])).toEqual([['held#2', '1/2']]);
  });

  it('型が要求に当てはまっても、割り当てで余った物は印を持たない', () => {
    // 要求は自分の枠の物で既に満ちていて、この物は数に入っていない。型から引くと、数に入っていない
    // 物が満ちた枠の印を持つ。
    const materials = [material({ objectGlobalIds: [typeId(2)], needed: 2, held: 2, allocated: new Set() })];

    const cells = cellsOf({ materials, stacks: [stack(typeId(2))] });

    expect(cells[0].card?.name).toBe('held#2');
    expect(cells[0].borderColor, '数に入っていない物').toBeUndefined();
    expect(cells[0].overlay).toBeUndefined();
  });

  it('どの要求にも当たっていない物は、取り出すための枠として残るが印は持たない', () => {
    // 工程を終えて出番が済んだ型。こぼす前に取り出せるよう枠は残る。
    const cells = cellsOf({
      materials: [material({ objectGlobalIds: [typeId(1)] })],
      stacks: [stack(typeId(9))],
    });

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
      material({ objectGlobalIds: [typeId(1)], inCurrentStep: true }),
      material({ objectGlobalIds: [typeId(2)], inCurrentStep: false }),
    ];

    const cells = cellsOf({ materials, stacks: [] });

    expect(cells[0].borderColor).toBe(COLOR.cellCurrentStep);
    expect(cells[1].borderColor).toBe(COLOR.cellLaterStep);
  });

  it('タグの要求は、拍ごとに当てはまる型を順に出す', () => {
    // どれか1つを選んで出すと、その型でなければ入らないように見えてしまう。
    const materials = [material({ objectGlobalIds: [typeId(4), typeId(5), typeId(6)] })];
    const shownAt = (cycle: number) => cellsOf({ materials, stacks: [], cycle })[0].accepts?.name;

    expect([0, 1, 2, 3].map(shownAt)).toEqual(['type#4', 'type#5', 'type#6', 'type#4']);
  });
});
