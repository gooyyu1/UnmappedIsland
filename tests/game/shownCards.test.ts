import { describe, expect, it } from 'vitest';
import type { WorldObject } from '../../src/domain/runtime/WorldObject';
import type { AloftCards, CardSource, CardSpot } from '../../src/game/ShownCards';
import { ShownCards } from '../../src/game/ShownCards';
import type { CardCombination, CardPlace, ObjectCardStack } from '../../src/game/PlayScreenView';

/**
 * 画面に出ている札の並び（ShownCards）の自動テスト。
 *
 * **ワールドの中身には依らない。** 見ているのは「持ち出されている札を引くと何が残るか」だけなので、
 * オブジェクトは番号だけを持つ個体で足りる。石が何と組み合わさるかといった内容の話は
 * ここでは要らない。
 */
describe('画面に出ている札', () => {
  /** 番号だけを持つ個体。ShownCardsが読むのはinstanceIdだけ。 */
  const object = (instanceId: number): WorldObject => ({ instanceId }) as WorldObject;

  /** その個体たちを1枚に束ねた札。 */
  const stack = (place: CardPlace, ...ids: readonly number[]): ObjectCardStack =>
    ({
      icon: '📦',
      name: `#${ids.join('+')}`,
      identity: ids,
      count: ids.length,
      objects: ids.map(object),
      actions: [],
      place,
      movedIds: (count: number) => ids.slice(0, count),
    }) as ObjectCardStack;

  /**
   * その並びを持つ画面。borrowedは子ウィンドウへ貸した1枚、unplacedは探索ウィンドウが抱えている札。
   *
   * combinationOfは、掴んだ札が出している個体のどれか1つを`held`として返すだけの最小の実装
   * （CardCombination.heldの契約そのもの）。何と何が組み合わさるかはここでは問わない。
   */
  const screen = (
    places: Partial<Record<'hand' | 'items' | 'fixtures', readonly (ObjectCardStack | undefined)[]>>,
    aloft: AloftCards = new Map(),
    borrowedCard?: ObjectCardStack,
  ): ShownCards => {
    const source: CardSource = {
      stacksIn: (place) => (typeof place === 'string' ? (places[place as 'hand'] ?? []) : []),
      borrowedCard: () => borrowedCard,
      aloft: () => aloft,
      cardOfObjects: (objects, place) => stack(place, ...objects.map((entry) => entry.instanceId)),
      combinationOf: (dragged, target) => {
        const [first, second] = target.objects;
        const held = dragged === target ? second : dragged.objects[0];
        return held === undefined || first === undefined
          ? undefined
          : ({ name: '組み合わせ', minutes: 0, held, execute: () => {} } as CardCombination);
      },
    };
    return new ShownCards(source);
  };

  /** その場所のi番目の札が名乗っている個体。 */
  const idsAt = (shown: ShownCards, spot: CardSpot, index: number): readonly number[] =>
    (shown.stacksAt(spot)[index]?.objects ?? []).map((entry) => entry.instanceId);

  it('持ち出されていなければ、ワールドの並びがそのまま出る', () => {
    const shown = screen({ hand: [stack('hand', 1, 2), undefined, stack('hand', 3)] });

    expect(shown.stacksAt('hand').map((entry) => entry?.name)).toEqual(['#1+2', undefined, '#3']);
  });

  it('子ウィンドウへ貸した1枚は、束から引かれる', () => {
    const shown = screen({ hand: [stack('hand', 1, 2)] }, new Map([[1, 'awaited']]));

    expect(idsAt(shown, 'hand', 0), '手元に残っているのは貸していないほう').toEqual([2]);
    expect(
      shown.stacksAt('hand')[0]?.identity,
      '識別子は貸した1個も含めたまま——帰り着いたときに同じ札として繋がる',
    ).toEqual([1, 2]);
  });

  it('丸ごと貸した束は、帰ってくる場所を示す印として残る', () => {
    const shown = screen({ hand: [stack('hand', 1)] }, new Map([[1, 'awaited']]));

    expect(shown.stacksAt('hand')).toHaveLength(1);
    expect(idsAt(shown, 'hand', 0), '内容はそのまま。押せるかどうかは枚数を知っている札が決める').toEqual([
      1,
    ]);
  });

  it('探索が抱えている札は並びに入らず、後ろの札が繰り上がる', () => {
    // まだどの枠にも居たことがないので、帰る場所を空けておく理由が無い（Windows.md 5.1節）。
    const shown = screen(
      { items: [stack('items', 1), stack('items', 2), stack('items', 3)] },
      new Map([[2, 'unplaced']]),
    );

    expect(shown.stacksAt('items').map((entry) => entry?.name)).toEqual(['#1', '#3']);
  });

  it('借りた1枚の枠には、その1枚だけが出る', () => {
    const borrowed = stack('hand', 1);
    const shown = screen({ hand: [stack('hand', 1, 2)] }, new Map([[1, 'awaited']]), borrowed);

    expect(shown.stacksAt('windowCard')).toEqual([borrowed]);
  });

  it('重ねて動くのは、掴んだ札が見せている個体', () => {
    // 手持ちの石2個のうち1個を子ウィンドウへ貸し、残りをその札へ重ねる。動くのは手元に残っている
    // ほうでなければならない——貸した1個は画面のあちら側に出ていて、掴めるものではない。
    const borrowed = stack('hand', 1);
    const shown = screen({ hand: [stack('hand', 1, 2)] }, new Map([[1, 'awaited']]), borrowed);

    const combination = shown.combinationAt('hand', 0, 'windowCard', 0);

    expect(combination?.held.instanceId).toBe(2);
  });

  it('どこから重ねても、動くのはその札が見せている個体のどれか', () => {
    // 上の1件の一般形。掴んだ札に出ていない個体が動くことは、どの組み合わせでも起きてはいけない。
    const borrowed = stack('hand', 1);
    const shown = screen(
      { hand: [stack('hand', 1, 2), stack('hand', 4, 5)], items: [stack('items', 3)] },
      new Map([[1, 'awaited']]),
      borrowed,
    );
    const spots: readonly CardSpot[] = ['hand', 'items', 'windowCard'];

    for (const from of spots) {
      for (let fromIndex = 0; fromIndex < shown.stacksAt(from).length; fromIndex++) {
        for (const to of spots) {
          for (let toIndex = 0; toIndex < shown.stacksAt(to).length; toIndex++) {
            const held = shown.combinationAt(from, fromIndex, to, toIndex)?.held;
            if (held === undefined) continue;

            expect(
              idsAt(shown, from, fromIndex),
              `${String(from)}[${fromIndex}] → ${String(to)}[${toIndex}]`,
            ).toContain(held.instanceId);
          }
        }
      }
    }
  });

  it('同じ札へ重ねたときは、その札が見せている2つを組み合わせる', () => {
    const shown = screen({ hand: [stack('hand', 1, 2, 3)] }, new Map([[1, 'awaited']]));

    expect(shown.combinationAt('hand', 0, 'hand', 0)?.held.instanceId, '見せている2枚目').toBe(3);
  });

  it('1個しか見せていない札を自分へ重ねても、組み合わせは成立しない', () => {
    const shown = screen({ hand: [stack('hand', 1, 2)] }, new Map([[1, 'awaited']]));

    expect(shown.combinationAt('hand', 0, 'hand', 0)).toBeUndefined();
  });
});
