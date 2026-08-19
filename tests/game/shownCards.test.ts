import { describe, expect, it } from 'vitest';
import type { WorldObject } from '../../src/domain/runtime/WorldObject';
import type { CardSpot } from '../../src/game/view/ShownCards';
import { ShownCards } from '../../src/game/view/ShownCards';
import type { ObjectCardStack } from '../../src/game/view/PlayScreenView';
import type { CardCombination } from '../../src/game/view/cardOperations';
import type { CardPlace, CardPlacement, ScreenPlace } from '../../src/game/view/cardPlaces';
import { samePlace } from '../../src/game/view/cardPlaces';
import { planMotion } from '../../src/game/view/cardMotionPlan';

/**
 * 画面に出ている札の並びと、その上の操作の意味（ShownCards）の自動テスト。
 *
 * **ワールドの中身には依らない。** 見ているのは「持ち出されている札を引くと何が残るか」「操作が
 * どの個体を動かすか」だけなので、オブジェクトは番号だけを持つ個体で足りる。石が何と組み合わさるか
 * といった内容の話はここでは要らない。
 */

/** 番号だけを持つ個体。ShownCardsが読むのはinstanceIdだけ。 */
const object = (instanceId: number): WorldObject => ({ instanceId }) as WorldObject;

/**
 * 画面の区画が映している場所（PlayScreenView.places）。場所はワールドのスロット1つなので、
 * 区画ごとに持ち主を1つ立てれば足りる——ここで見るのは同じ場所かどうかだけ。
 */
const LANE_OWNERS: Record<ScreenPlace, WorldObject> = {
  fixtures: object(-1),
  items: object(-2),
  hand: object(-3),
};
const place = (screen: ScreenPlace): CardPlace => ({
  container: LANE_OWNERS[screen],
  slotGlobalId: 0,
});

/** 束が受けた操作の記録。どの操作がどの個体・場所で組まれたかをテストが確かめる。 */
interface Moved {
  readonly ids: readonly number[];
  readonly to: CardPlace;
  readonly at: CardPlacement | undefined;
}

/** その個体たちを1枚に束ねた札。moveTo・reorderは、実行されたら記録だけを残す。 */
function stack(
  place: CardPlace,
  ids: readonly number[],
  options: { readonly contents?: CardPlace; readonly accepted?: number; readonly moves?: Moved[] } = {},
): ObjectCardStack {
  return {
    icon: '📦',
    name: `#${ids.join('+')}`,
    identity: ids,
    count: ids.length,
    objects: ids.map(object),
    objectGlobalId: 0,
    actions: [],
    place,
    visibleSlots: [],
    contentsFor: () => options.contents,
    movedIds: (count: number) => ids.slice(0, count),
    moveTo: (to, at, count) => () => {
      options.moves?.push({ ids: ids.slice(0, count ?? 1), to, at });
    },
    reorder: (at) => () => {
      options.moves?.push({ ids, to: place, at });
    },
    acceptedCountAt: () => options.accepted ?? 1,
  } as ObjectCardStack;
}

/**
 * その並びを持つ画面。combinationOfは、掴んだ札が出している個体のどれか1つを`held`として返すだけの
 * 最小の実装（CardCombination.heldの契約そのもの）。何と何が組み合わさるかはここでは問わない。
 */
function screen(
  lanes: Partial<Record<'hand' | 'items' | 'fixtures', readonly (ObjectCardStack | undefined)[]>>,
  windowPlace?: CardPlace,
): ShownCards {
  return new ShownCards({
    stacksIn: (asked) => {
      const lane = (['hand', 'items', 'fixtures'] as const).find((name) => samePlace(asked, place(name)));
      return lane === undefined ? [] : (lanes[lane] ?? []);
    },
    // 本物は物の親スロットから場所を導く（PlayScreenView.placeOfObject）。ここでは、その個体を
    // 抱えているレーンを探すことで同じことをする。
    cardOfObjects: (objects) => {
      const lane = (['hand', 'items', 'fixtures'] as const).find((name) =>
        (lanes[name] ?? []).some((card) =>
          card?.objects.some((entry) => entry.instanceId === objects[0].instanceId),
        ),
      );
      return stack(
        place(lane ?? 'items'),
        objects.map((entry) => entry.instanceId),
      );
    },
    combinationOf: (dragged, target) => {
      const [first, second] = target.objects;
      const held = dragged === target ? second : dragged.objects[0];
      return held === undefined || first === undefined
        ? undefined
        : ({ name: '組み合わせ', minutes: 0, held, execute: () => {} } as CardCombination);
    },
    windowPlace: () => windowPlace,
    places: place,
  });
}

/** 束の先頭1個を子ウィンドウへ借りる（開くときの経路そのもの）。 */
function borrow(shown: ShownCards, borrowed: ObjectCardStack): ObjectCardStack {
  const first = shown.firstOf(borrowed);
  shown.borrow(first, first);
  return first;
}

/** その場所のi番目の札が名乗っている個体。 */
const idsAt = (shown: ShownCards, spot: CardSpot, index: number): readonly number[] =>
  (shown.stacksAt(spot)[index]?.objects ?? []).map((entry) => entry.instanceId);

/**
 * 今画面に見えている個体を、場所を跨いで全部数える（発見物は探索ウィンドウに見えている）。
 * **札が名乗っている個体（identity）がそのまま「そこに見えているもの」**——よそに出ているぶんは
 * 名乗らないので、引き算はここには要らない。
 */
function visibleIds(shown: ShownCards, spots: readonly CardSpot[]): readonly number[] {
  const visible: number[] = [];
  for (const spot of spots) {
    for (const entry of shown.stacksAt(spot)) visible.push(...(entry?.identity ?? []));
  }
  visible.push(...shown.found.flatMap((card) => card.identity ?? []));
  return visible;
}

describe('画面に出ている札', () => {
  it('持ち出されていなければ、ワールドの並びがそのまま出る', () => {
    const shown = screen({ hand: [stack(place('hand'), [1, 2]), undefined, stack(place('hand'), [3])] });

    expect(shown.stacksAt(place('hand')).map((entry) => entry?.name)).toEqual(['#1+2', undefined, '#3']);
  });

  it('子ウィンドウへ貸した1枚は、束から引かれる', () => {
    const shown = screen({ hand: [stack(place('hand'), [1, 2])] });
    borrow(shown, stack(place('hand'), [1, 2]));

    expect(idsAt(shown, place('hand'), 0), '手元に残っているのは貸していないほう').toEqual([2]);
    expect(shown.stacksAt(place('hand'))[0]?.identity, '名乗るのは手元に在るぶんだけ').toEqual([2]);
    expect(
      shown.stacksAt(place('hand'))[0]?.awaited,
      '貸した1個は枠が帰りを待つ——帰り着いたときに同じ札として繋がる',
    ).toEqual([1]);
  });

  it('丸ごと貸した束の枠には、帰ってくる場所を示す印だけが残る', () => {
    const shown = screen({ hand: [stack(place('hand'), [1])] });
    borrow(shown, stack(place('hand'), [1]));

    const mark = shown.stacksAt(place('hand'))[0];
    expect(shown.stacksAt(place('hand'))).toHaveLength(1);
    expect(idsAt(shown, place('hand'), 0), '個体は1つも出ていない').toEqual([]);
    expect(mark?.awaited, '待っているのは貸した1個').toEqual([1]);
    expect(
      [mark?.moveTo, mark?.reorder, mark?.acceptedCountAt],
      '印は操作を持たない——掴む相手にも重ねる相手にもならない',
    ).toEqual([undefined, undefined, undefined]);
  });

  it('探索が抱えている札は並びに入らず、後ろの札が繰り上がる', () => {
    // まだどの枠にも居たことがないので、帰る場所を空けておく理由が無い（Windows.md 5.1節）。
    const shown = screen({
      items: [stack(place('items'), [1]), stack(place('items'), [2]), stack(place('items'), [3])],
    });
    shown.takeFound([{ icon: '📦', name: '#2', identity: [2] }]);

    expect(shown.stacksAt(place('items')).map((entry) => entry?.name)).toEqual(['#1', '#3']);
  });

  it('借りた1枚の枠には、その1枚だけが出る', () => {
    const shown = screen({ hand: [stack(place('hand'), [1, 2])] });
    const borrowed = borrow(shown, stack(place('hand'), [1, 2]));

    expect(shown.stacksAt('windowCard')).toEqual([borrowed]);
    expect(
      borrowed.objects.map((entry) => entry.instanceId),
      'ウィンドウへ移るのは先頭の1枚だけ',
    ).toEqual([1]);
  });
});

describe('貸し借りの流れ（Windows.md 1.1節）', () => {
  it('借りて、手放せば、元の枠に戻る', () => {
    const shown = screen({ hand: [stack(place('hand'), [1, 2])] });
    borrow(shown, stack(place('hand'), [1, 2]));
    expect(idsAt(shown, place('hand'), 0), '貸している間は手元のぶんだけ').toEqual([2]);

    expect(shown.returnBorrowed(), '手放した1個を答える（帰りの出どころを決めるのに使う）').toEqual([1]);
    expect(shown.windowCard).toBeUndefined();
    expect(idsAt(shown, place('hand'), 0), '束が全部戻っている').toEqual([1, 2]);
    expect(shown.stacksAt(place('hand'))[0]?.awaited, '待つものはもう無い').toBeUndefined();
  });

  it('借りていなければ、手放すものは無い', () => {
    const shown = screen({ hand: [stack(place('hand'), [1])] });
    expect(shown.returnBorrowed()).toEqual([]);
  });

  it('借りている1枚は、ワールドが変わったら引き直す', () => {
    const stones = [stack(place('hand'), [1, 2])];
    const shown = screen({ hand: stones });
    borrow(shown, stones[0]);

    // ワールドが変わった（束の並びが組み直された）が、その個体は残っている。
    stones[0] = stack(place('hand'), [2, 1]);
    const card = shown.restackWindow();

    expect(
      card?.objects.map((entry) => entry.instanceId),
      '映し続けるのは同じ1個',
    ).toEqual([1]);
    expect(shown.stacksAt('windowCard')[0]).toBe(card);
  });

  it('借りている1枚が世界から消えていたら、引き直せない', () => {
    const stones = [stack(place('hand'), [1, 2])];
    const shown = screen({ hand: stones });
    borrow(shown, stones[0]);

    stones[0] = stack(place('hand'), [2]);
    expect(shown.restackWindow(), '映すものが無い＝ウィンドウを閉じる合図').toBeUndefined();
  });
});

describe('発見物の流れ（Windows.md 5.1節）', () => {
  it('抱えて、手放せば、次の差し替えから並びに戻る', () => {
    const shown = screen({ items: [stack(place('items'), [1, 2])] });

    shown.takeFound([{ icon: '📦', name: '#2', identity: [2] }]);
    expect(idsAt(shown, place('items'), 0), '見つかった分だけが抜ける').toEqual([1]);

    const returned = shown.returnFound();
    expect(returned.map((card) => card.identity)).toEqual([[2]]);
    expect(idsAt(shown, place('items'), 0)).toEqual([1, 2]);
    expect(shown.found).toEqual([]);
  });
});

describe('1つのオブジェクトに札は1つ（不変条件）', () => {
  const SPOTS: readonly CardSpot[] = [place('fixtures'), place('items'), place('hand'), 'windowCard'];

  it.each([
    ['貸していない', (shown: ShownCards) => shown],
    [
      '1枚貸している',
      (shown: ShownCards) => {
        borrow(shown, stack(place('hand'), [1, 2]));
        return shown;
      },
    ],
    [
      '丸ごと貸している',
      (shown: ShownCards) => {
        borrow(shown, stack(place('items'), [3]));
        return shown;
      },
    ],
    [
      '探索が抱えている',
      (shown: ShownCards) => {
        shown.takeFound([{ icon: '📦', name: '#4', identity: [4] }]);
        return shown;
      },
    ],
    [
      '貸しながら抱えている',
      (shown: ShownCards) => {
        borrow(shown, stack(place('hand'), [1, 2]));
        shown.takeFound([{ icon: '📦', name: '#4+5', identity: [4, 5] }]);
        return shown;
      },
    ],
  ])('%s', (_name, arrange) => {
    const world = [1, 2, 3, 4, 5, 6];
    const shown = arrange(
      screen({
        hand: [stack(place('hand'), [1, 2]), undefined],
        items: [stack(place('items'), [3]), stack(place('items'), [4, 5])],
        fixtures: [stack(place('fixtures'), [6])],
      }),
    );

    const visible = visibleIds(shown, SPOTS);
    expect(new Set(visible).size, '同じ個体が2箇所に見えてはいけない').toBe(visible.length);
    expect([...visible].sort(), '全個体がどこかに見えている').toEqual(world);
  });
});

describe('ドロップの意味', () => {
  it('借りた札の枠はワールドの場所ではないので、空き枠へは落とせない', () => {
    const shown = screen({ hand: [stack(place('hand'), [1, 2])] });
    borrow(shown, stack(place('hand'), [1, 2]));

    const drop = {
      from: place('hand'),
      fromIndex: 0,
      to: 'windowCard',
      target: { kind: 'cell', index: 0 },
      count: 1,
    } as const;
    expect(shown.dropAction(drop)).toBeUndefined();
    expect(shown.multiDropLimit(drop)).toBe(1);
  });

  it('帰りを待つ印へは重ねられない', () => {
    // 印は個体を1つも出していないので、組み合わせの相手にならない（相手が居ないのだから、
    // 何が成立するかを問うこともできない）。
    const shown = screen({ hand: [stack(place('hand'), [1])], items: [stack(place('items'), [2])] });
    borrow(shown, stack(place('hand'), [1]));

    expect(shown.combinationAt(place('items'), 0, place('hand'), 0)).toBeUndefined();
  });

  it('重ねて動くのは、掴んだ札が見せている個体', () => {
    // 手持ちの石2個のうち1個を子ウィンドウへ貸し、残りをその札へ重ねる。動くのは手元に残っている
    // ほうでなければならない——貸した1個は画面のあちら側に出ていて、掴めるものではない。
    const shown = screen({ hand: [stack(place('hand'), [1, 2])] });
    borrow(shown, stack(place('hand'), [1, 2]));

    const combination = shown.dropCombination({
      from: place('hand'),
      fromIndex: 0,
      to: 'windowCard',
      target: { kind: 'combine', index: 0 },
      count: 1,
    });

    expect(combination?.held.instanceId).toBe(2);
    expect(
      shown.movedBy({
        from: place('hand'),
        fromIndex: 0,
        to: 'windowCard',
        target: { kind: 'combine', index: 0 },
        count: 1,
      }),
    ).toEqual({ grabbed: 2, followers: [] });
  });

  it('どこから重ねても、動くのはその札が見せている個体のどれか', () => {
    // 上の1件の一般形。掴んだ札に出ていない個体が動くことは、どの組み合わせでも起きてはいけない。
    const shown = screen({
      hand: [stack(place('hand'), [1, 2]), stack(place('hand'), [4, 5])],
      items: [stack(place('items'), [3])],
    });
    borrow(shown, stack(place('hand'), [1, 2]));
    const spots: readonly CardSpot[] = [place('hand'), place('items'), 'windowCard'];

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
    const shown = screen({ hand: [stack(place('hand'), [1, 2, 3])] });
    borrow(shown, stack(place('hand'), [1, 2, 3]));

    expect(shown.combinationAt(place('hand'), 0, place('hand'), 0)?.held.instanceId, '見せている2枚目').toBe(
      3,
    );
  });

  it('1個しか見せていない札を自分へ重ねても、組み合わせは成立しない', () => {
    const shown = screen({ hand: [stack(place('hand'), [1, 2])] });
    borrow(shown, stack(place('hand'), [1, 2]));

    expect(shown.combinationAt(place('hand'), 0, place('hand'), 0)).toBeUndefined();
  });

  it('同じ場所の中は並び替え、場所をまたげば移動', () => {
    const moves: Moved[] = [];
    const shown = screen({
      hand: [stack(place('hand'), [1], { moves })],
      items: [stack(place('items'), [2])],
    });

    shown.dropAction({
      from: place('hand'),
      fromIndex: 0,
      to: place('hand'),
      target: { kind: 'gap', index: 1 },
      count: 1,
    })?.();
    expect(moves.at(-1), '並び替えは束ごと').toEqual({
      ids: [1],
      to: place('hand'),
      at: { kind: 'gap', index: 1 },
    });

    shown.dropAction({
      from: place('hand'),
      fromIndex: 0,
      to: place('items'),
      target: { kind: 'cell', index: 1 },
      count: 1,
    })?.();
    expect(moves.at(-1)).toEqual({ ids: [1], to: place('items'), at: { kind: 'cell', index: 1 } });
  });

  it('入れ物のカードへ重ねると、その中身の場所へ入る', () => {
    const moves: Moved[] = [];
    const box = object(9);
    const inside: CardPlace = { container: box, slotGlobalId: 0 };
    const shown = screen({
      hand: [stack(place('hand'), [1, 2], { moves, accepted: 2 })],
      items: [stack(place('items'), [9], { contents: inside })],
    });
    // 入れ物と中身の間に組み合わせは無い画面（重ねる＝入れる、だけが成立する）。
    const noCombination = new ShownCards({
      stacksIn: (asked) => shown.stacksAt(asked),
      cardOfObjects: (objects) =>
        stack(
          place('hand'),
          objects.map((entry) => entry.instanceId),
        ),
      combinationOf: () => undefined,
      windowPlace: () => undefined,
      places: place,
    });

    const drop = {
      from: place('hand'),
      fromIndex: 0,
      to: place('items'),
      target: { kind: 'combine', index: 0 },
      count: 2,
    } as const;
    noCombination.dropAction(drop)?.();

    expect(moves.at(-1), '2枚まとめて中へ').toEqual({ ids: [1, 2], to: inside, at: undefined });
    expect(noCombination.multiDropLimit(drop), '入る枚数は枠の宣言（acceptedCountAt）').toBe(2);
  });
});

describe('カードの端の行き先', () => {
  it('手持ちの上は、子ウィンドウを開いている間だけそちらを先に見る', () => {
    const inside: CardPlace = { container: object(9), slotGlobalId: 0 };
    expect(screen({}, inside).edgeTargets(place('hand'), 'up')).toEqual([inside, place('items')]);
    expect(screen({}).edgeTargets(place('hand'), 'up')).toEqual([place('items')]);
  });

  it('フィールドの上下関係はそのまま', () => {
    const shown = screen({});
    expect(shown.edgeTargets(place('items'), 'up')).toEqual([place('fixtures')]);
    expect(shown.edgeTargets(place('fixtures'), 'down')).toEqual([place('items')]);
    expect(shown.edgeTargets(place('items'), 'down')).toEqual([place('hand')]);
    expect(shown.edgeTargets(place('hand'), 'down')).toEqual([]);
    expect(shown.edgeTargets({ container: object(9), slotGlobalId: 0 }, 'down'), '中身の下は手持ち').toEqual([
      place('hand'),
    ]);
  });
});

describe('経過中のフレーム（ShownCards × planMotion）', () => {
  it('貸した1枚へ残りを重ねた瞬間、手持ちの枠は0枚になる', () => {
    // 石2個のうち1個を子ウィンドウへ貸し、残り1個を掴んでその札へ重ねた直後のフレーム。
    // 貸した1個も掴んだ1個も宙に在るので、枠は0枚の印になる——ここが1枚に見えたのが、
    // クラフト中に手持ちの石が復活する不具合（操作が「貸したほうの石」を掴んだことにしていた）。
    const shown = screen({ hand: [stack(place('hand'), [1, 2])] });
    borrow(shown, stack(place('hand'), [1, 2]));

    const held = shown.dropCombination({
      from: place('hand'),
      fromIndex: 0,
      to: 'windowCard',
      target: { kind: 'combine', index: 0 },
      count: 1,
    })?.held;
    expect(held).toBeDefined();

    // 枠が名乗るのは手元に在るぶんだけ（貸した1個はウィンドウの枠に出ている）。掴んで離した1枚は
    // CardTableが宙に在るものとして引く。
    const placed = { card: '石', ids: shown.stacksAt(place('hand'))[0]?.identity ?? [], rect: 0 };
    expect(placed.ids).toEqual([2]);

    const plan = planMotion({
      before: [placed],
      arriving: [],
      staying: [placed],
      left: [],
      aloft: [held!.instanceId],
    });

    expect(plan.shown).toEqual([{ card: '石', present: [], emptied: true }]);
  });
});
