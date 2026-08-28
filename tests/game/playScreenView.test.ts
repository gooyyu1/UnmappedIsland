import { describe, expect, it } from 'vitest';
import type { WorldObject } from '../../src/domain/WorldObject';
import type { ObjectCardStack, PlayScreenView } from '../../src/game/view/PlayScreenView';
import { fromGameSession, withFrozenCards } from '../../src/game/view/PlayScreenView';
import type { CardPlace, ScreenPlace } from '../../src/game/view/cardPlaces';
import { cardPlacesOf } from '../../src/game/view/cardPlaces';
import { inProgressObjectName } from '../../src/loader/inProgressObjects';
import { parseLocale } from '../../src/locale/Localization';
import type { MiniGame } from '../support/miniGame';
import { miniGame } from '../support/miniGame';

/**
 * プレイ中の画面の表示内容が、ワールドの実際の状態（現在地・そのスロットの中身・手持ち）から
 * 作られていることの自動テスト。
 *
 * **同梱の定義は読まない**。ここで見るのは「どのレーンが何を映し、札をどこへ動かせるか」で、
 * どの物がどんな性質を持つかは、確かめたい形をその場で宣言すれば足りる。
 */
describe('PlayScreenView(ゲーム状態から画面の表示内容を作る)', () => {
  const locale = parseLocale(
    'ja.yaml',
    `object_texts:
  stone:
    display_name: 石
`,
  );

  const WORLD = `
in_progress_tags: [item]
object_defs:
  stone:
    tags: [item]
    props:
      volume: {value: 100}

  # 手持ちを埋めるための、石とは別の種類。同種は1枠へ束ねられるので、枠を数える試験に要る。
  twig: {tags: [item]}
  leaf: {tags: [item]}
  shell: {tags: [item]}
  bone: {tags: [item]}
  feather: {tags: [item]}
  branch: {tags: [item]}

  # 持ち歩けない設置物。itemタグを持たないので手持ちのacceptsに掛からない。
  tree:
    tags: [fixture]

  # itemとfixtureを兼ねる入れ物。束ねると代表の中身しか開けないのでstackableを下ろす。
  basket:
    tags: [item, fixture]
    stackable: false
    storage: true
    visible_slots: [contents]
    props:
      volume: {value: 500}
    slots:
      contents:
        cell_count: 10
        cell: {accept: {tag: item}}
        capacity: 20000
    recipes:
      woven:
        steps:
          - requires: [{object: leaf, count: 6, consume: true}]
            duration: 120

  # 単独では在れない（bound_to_owner）ので、怪我のスロットは落とせる場所にならない。
  sprain:
    tags: [injury]
    bound_to_owner: true

  # 設置物でありながら場所でもあるもの（筏・住居）。中にプレイヤーが入るので土地と同じ枠を持ち、
  # 土地の設置物スロットに置かれる——つまり現在地がさらに別の場所の中にある形になる。
  vessel:
    tags: [fixture]
    stackable: false
    props:
      exploration_progress: {value: 0, range: {min: 0, max: 4}}
    slots:
      items: {cell: {accept: {tag: item}}}
      fixtures: {cell: {accept: {tag: fixture}}}
      characters: {cell_count: 1, cell: {accept: {tag: character}}}
    interactions:
      explore:
        trigger: menu
        duration: 15
        add: {self: {exploration_progress: 1}}
`;

  const setUp = (): MiniGame => miniGame(WORLD);

  const viewOf = (mini: MiniGame): PlayScreenView => fromGameSession(mini.game, mini.codex, locale);

  /**
   * 画面の区画（3つのレーン）が今映している場所。テストは区画を名前で書きたいので、その都度ビューと
   * 同じ解決を通す（cardPlaces）。
   */
  const place = (mini: MiniGame, screen: ScreenPlace): CardPlace =>
    cardPlacesOf(mini.game.player, mini.game.player.location ?? mini.game.startLocation)(screen);

  /** その区画のレーンに並んでいる札（空き枠を除いたもの）。 */
  const lane = (view: PlayScreenView, mini: MiniGame, screen: ScreenPlace) =>
    view.cardsIn(place(mini, screen)).filter((card) => card !== undefined);

  /** 手持ちの枠の並び。**空き枠はundefinedのまま**——枠の位置がそのまま意味を持つ。 */
  const handCells = (view: PlayScreenView, mini: MiniGame) => view.cardsIn(place(mini, 'hand'));

  /** そのオブジェクトを映している札。 */
  const cardOf = (view: PlayScreenView, object: WorldObject): ObjectCardStack =>
    view.cardsIn(object.parentSlot!).find((card) => card?.objects[0] === object)!;

  /** 手持ちの6枠を、すべて違う種類で埋める。 */
  const fillHand = (mini: MiniGame): void => {
    for (const name of ['stone', 'twig', 'leaf', 'shell', 'bone', 'feather'])
      mini.createObject(name, mini.slot('hand'));
  };

  it('天気は、worldの今の天気の識別子をそのまま映す', () => {
    // 雨の演出（ScreenLayout.md 7.5.3節）がこの識別子を読むため、表示文字列ではなく識別子で持つ。
    const mini = setUp();

    expect(viewOf(mini).weather).toBe('clear');

    mini.game.world.instance
      .tryGetProperty(mini.codex.propertyNames.getId('weather'))
      ?.setNumber(mini.codex.symbolNames.getId('storm'));

    expect(viewOf(mini).weather).toBe('storm');
  });

  it('手持ちは固定6枠ぶん並び、空きセルはundefinedになる', () => {
    const mini = setUp();
    mini.createObject('stone', mini.slot('hand'));

    const view = viewOf(mini);

    expect(handCells(view, mini)).toHaveLength(6);
    expect(handCells(view, mini)[0], 'カード名は対応表から引いた表示文字列').toMatchObject({
      icon: '📦',
      name: '石',
    });
    expect(handCells(view, mini).slice(1), '残りの枠は空きセルとして残る').toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('製作中オブジェクトのカードは、完成品の絵を映す', () => {
    // 製作中の型はレシピから自動生成される（RecipeSystem.md）ので、その型あての絵は用意できない。
    // 完成品の絵を映せば、絵文字の代用に落ちずに「何が出来つつあるのか」が見える。
    const mini = setUp();
    mini.createObject(inProgressObjectName('basket', 'woven'), mini.slot('items', mini.land));

    const card = lane(viewOf(mini), mini, 'items')[0];

    expect(card.art).toBe('basket');
    expect(card.inProgress, '完成品と同じ絵なので、作りかけであることは覆いだけが示す').toBe(true);
  });

  it('場所について訊きたいことは、1つのまとまりで揃う', () => {
    // 見出し・記憶の鍵・枠の数・落とせるか・敷く絵・製作の材料は、どれも同じスロットの宣言から出る。
    // ばらばらに訊くと、場所を映す先を足すたびに訊く手順も増える（Windows.md 1節）。
    const mini = setUp();
    const wip = mini.createObject(inProgressObjectName('basket', 'woven'), mini.slot('items', mini.land));

    const view = viewOf(mini);
    const hand = view.slotViewOf(place(mini, 'hand'));
    const injuries = view.slotViewOf(mini.slot('injuries'));
    const materials = view.slotViewOf(mini.slot('materials', wip));

    expect(hand.key, 'タブの記憶の鍵はスロット名').toBe('hand');
    expect(hand.cells, '手持ちは枠の数が決まっている').toBe(6);
    expect(hand.acceptsCards).toBe(true);
    expect(hand.background, 'レーンに敷く絵はスロットで引く').toEqual({
      owner: view.characterCard.art,
      slot: 'hand',
    });
    expect(hand.materials, '製作中でなければ材料の枠は無い').toBeUndefined();

    const fixtures = view.slotViewOf(place(mini, 'fixtures'));
    expect(fixtures.cells, '設置物は落とすたびに枠が増えるスロット').toBe('grows');
    expect(
      fixtures.acceptsCards,
      '据えられる物（itemとfixtureを兼ねる編み籠）があるので、末尾に受け皿の空枠が付く',
    ).toBe(true);

    expect(injuries.acceptsCards, '怪我は落とせる場所ではない').toBe(false);
    expect(materials.materials?.length, '製作中オブジェクトの材料は要求ごとに枠を持つ').toBeGreaterThan(0);
  });

  it('アイテムのmoveで手持ちへ移り、手持ちのmoveでフィールドへ戻る', () => {
    const mini = setUp();
    const picked = mini.createObject('stone', mini.slot('items', mini.land));

    lane(viewOf(mini), mini, 'items')[0].dropInto?.(place(mini, 'hand'))?.execute();

    expect(mini.game.player.hand[0], '押したアイテムが手持ちの先頭の枠に入る').toBe(picked);
    expect(mini.game.startLocation.items, 'フィールドからは無くなる').not.toContain(picked);

    handCells(viewOf(mini), mini)[0]?.dropInto?.(place(mini, 'items'))?.execute();

    expect(mini.game.player.hand[0], '手持ちの枠は空く').toBeUndefined();
    expect(mini.game.startLocation.items, 'フィールドへ戻る').toContain(picked);
  });

  it('設置物のカードは移せないが、同じレーンの中でなら並び替えられる', () => {
    const mini = setUp();
    mini.createObject('tree', mini.slot('fixtures', mini.land));

    const view = viewOf(mini);

    expect(lane(view, mini, 'items'), '設置物はアイテムのレーンには出ない').toEqual([]);
    // 持ち歩けないのは「設置物レーンが読み取り専用だから」ではなく、木がitemタグを持たず手持ちの
    // acceptsに掛からないから。itemも兼ねる設置物（持ち運べる籠）を足せば移せるようになる。
    expect(lane(view, mini, 'fixtures')[0].dropInto?.(place(mini, 'hand')), '手には持てない').toBeUndefined();
    expect(
      lane(view, mini, 'fixtures')[0].dropInto?.(place(mini, 'items')),
      '地面へも下ろせない',
    ).toBeUndefined();
    expect(
      lane(view, mini, 'fixtures')[0].reorderActionAt,
      '並び方はプレイヤーが決めるので並び替えはできる',
    ).toBeTypeOf('function');
  });

  it('itemとfixtureを兼ねる物は、設置物レーンとアイテムレーンを行き来できる', () => {
    // 端の▲▼が出るかは「そこへ移せるか」で決まる（PlayScene.cardEdges）ので、両方のタグを持つ
    // 籠は設置物レーンで▼、アイテムレーンで▲を出す。画面側に場所ごとの決まりは無い。
    const mini = setUp();
    mini.createObject('basket', mini.slot('items', mini.land));

    lane(viewOf(mini), mini, 'items')[0].dropInto?.(place(mini, 'fixtures'))?.execute();

    const placed = viewOf(mini);
    expect(lane(placed, mini, 'fixtures'), '地面に据わる').toHaveLength(1);
    expect(lane(placed, mini, 'items'), 'アイテムレーンからは消える').toEqual([]);

    lane(placed, mini, 'fixtures')[0].dropInto?.(place(mini, 'items'))?.execute();

    const lifted = viewOf(mini);
    expect(lane(lifted, mini, 'fixtures'), '据えたものを拾い直せる').toEqual([]);
    expect(lane(lifted, mini, 'items')).toHaveLength(1);
    expect(
      lane(lifted, mini, 'items')[0].dropInto?.(place(mini, 'hand')),
      'そのまま手にも持てる',
    ).toBeDefined();
  });

  it('カードは、自分が今在るスロットを地の引き先として持つ', () => {
    const mini = setUp();
    mini.createObject('tree', mini.slot('fixtures', mini.land));
    mini.createObject('twig', mini.slot('items', mini.land));
    mini.createObject('stone', mini.slot('hand'));

    const view = viewOf(mini);
    const land = view.currentLocationCard.art;

    expect(
      lane(view, mini, 'fixtures').map((card) => card.backgroundSlot),
      'このレーンのカードはすべて土地のfixturesに在る',
    ).toEqual([{ owner: land, slot: 'fixtures' }]);
    expect(
      lane(view, mini, 'items').map((card) => card.backgroundSlot),
      '同じ土地でもスロットが違えば別の地を引く（絵が在るかはファイル側の話）',
    ).toEqual([{ owner: land, slot: 'items' }]);
    expect(handCells(view, mini).find((card) => card !== undefined)?.backgroundSlot).toEqual({
      owner: view.characterCard.art,
      slot: 'hand',
    });
  });

  it('レーンが映しているスロットを答える', () => {
    const mini = setUp();
    const view = viewOf(mini);

    expect(view.slotViewOf(place(mini, 'fixtures')).background).toEqual({
      owner: view.currentLocationCard.art,
      slot: 'fixtures',
    });
    expect(view.slotViewOf(place(mini, 'hand')).background).toEqual({
      owner: view.characterCard.art,
      slot: 'hand',
    });
  });

  it('現在地のカードは、その土地の絵を持つ', () => {
    const mini = setUp();

    expect(
      viewOf(mini).currentLocationCard.art,
      '土地そのものもobject_defなので、その型が名乗る絵の名前で引ける',
    ).toBe(mini.land.def.artName);
  });

  it('手持ちが6枠とも埋まっていると、アイテムのmoveは何も起こさない', () => {
    const mini = setUp();
    // 同種はスタックにまとまり1枠しか使わないため、別種のアイテムで6枠を埋める。
    fillHand(mini);
    // 手持ちに同種が居るアイテムは、枠が埋まっていても既存のスタックへ合流できてしまう
    // （枠を数える単位は種類、SlotSystem.md 4節）。埋まっていることを確かめたいので、
    // 手持ちに無い種類のカードで試す。
    const dropped = mini.createObject('branch', mini.slot('items', mini.land));

    const view = viewOf(mini);
    expect(
      handCells(view, mini).every((cell) => cell !== undefined),
      '手はすべて塞がっている',
    ).toBe(true);

    cardOf(view, dropped).dropInto?.(place(mini, 'hand'))?.execute();

    expect(mini.game.startLocation.items, 'フィールドの中身は変わらない').toEqual([dropped]);
  });

  it('カードの識別子は、そのカードが映しているインスタンスのID一式になる', () => {
    const mini = setUp();
    const stones = [0, 1].map(() => mini.createObject('stone', mini.slot('hand')));
    mini.createObject('twig', mini.slot('items', mini.land));

    const view = viewOf(mini);

    expect(handCells(view, mini)[0]?.identity, '同種2個は1枚のカードなので、両方のIDを持つ').toEqual(
      stones.map((stone) => stone.instanceId),
    );
    expect(handCells(view, mini)[0]?.count, 'スタック数はそのままインスタンスの個数').toBe(2);
    expect(
      lane(view, mini, 'items').map((card) => card.identity),
      'フィールドも同種はスタックにまとまって1枚',
    ).toEqual(mini.game.startLocation.itemStacks.map((stack) => stack.map((item) => item.instanceId)));
  });

  it('手持ちのカードは装備へ移せる（装備固有の経路ではなく、場所を指すだけ）', () => {
    const mini = setUp();
    const stone = mini.createObject('stone', mini.slot('hand'));
    const equipment = mini.slot('equipment');

    handCells(viewOf(mini), mini)[0]?.dropInto?.(equipment)?.execute();

    expect(mini.game.player.hand[0], '手持ちからは無くなる').toBeUndefined();
    expect(
      mini.game.player.equipmentStacks.map((stack) => stack[0]),
      '装備スロットへ入る',
    ).toEqual([stone]);

    const view = viewOf(mini);
    expect(view.cardsIn(equipment)[0]!.place).toBe(equipment);

    view.cardsIn(equipment)[0]!.dropInto?.(place(mini, 'hand'))?.execute();
    expect(mini.game.player.hand[0], '手持ちへ戻せる').toBe(stone);
  });

  it('withFrozenCardsは、控えた時点の中身を返し続ける', () => {
    // 時間経過の再現（PlayScene）では、控えておいたviewをあとから表示する。cardsInだけは呼んだ時点の
    // 生きたワールドを読むため、固定しないとその部分に限って「今」の状態が出てしまう。
    const mini = setUp();
    const equipment = mini.slot('equipment');
    const stone = mini.createObject('stone', equipment);

    const live = viewOf(mini);
    const frozen = withFrozenCards(live, [equipment]);

    // 控えたあとでワールドが変わる（装備が外れる）。
    expect(stone.moveToSlotOrRejection(mini.slot('hand'))).toBeUndefined();

    expect(
      frozen.cardsIn(equipment).map((card) => card?.objects[0]),
      '固定した場所は控えた時点のまま',
    ).toEqual([stone]);
    expect(live.cardsIn(equipment), '固定していないviewは今のワールドを読む').toEqual([]);
    expect(frozen.cardsIn(mini.slot('injuries')), '固定していない場所は今のワールドを読む').toEqual([]);
    expect(frozen.characterCard, 'cardsIn以外は元のviewのまま').toBe(live.characterCard);
  });

  it('withFrozenCardsは、常に見えているレーンを渡されなくても焼き付ける', () => {
    // 3つのレーンは必ず画面に出ているので、数え上げは呼び出し側に持たせない（withFrozenCards）。
    const mini = setUp();
    const stone = mini.createObject('stone', mini.slot('items', mini.land));

    const frozen = withFrozenCards(viewOf(mini), []);
    expect(stone.moveToSlotOrRejection(mini.slot('hand'))).toBeUndefined();

    expect(
      frozen.cardsIn(place(mini, 'items')).map((card) => card?.objects[0]),
      '渡していないアイテムレーンも控えた時点のまま',
    ).toEqual([stone]);
  });

  it('怪我は取り出せず、何も入れられない', () => {
    // どちらもbound_to_owner（7.9節）の帰結——捻挫は身体から剥がせず、剥がせない以上プレイヤーが
    // 怪我を手に持つこともない。画面側は場所ごとの読み取り専用フラグを持たない。
    const mini = setUp();
    const injuries = mini.slot('injuries');
    mini.createObject('sprain', injuries);
    mini.createObject('stone', mini.slot('hand'));

    const view = viewOf(mini);

    expect(view.cardsIn(injuries)).toHaveLength(1);
    expect(view.cardsIn(injuries)[0]!.dropInto?.(place(mini, 'hand')), '取り出せない').toBeUndefined();
    expect(
      view.cardsIn(injuries)[0]!.dropInto?.(place(mini, 'items')),
      '捨てることもできない',
    ).toBeUndefined();
    expect(handCells(view, mini)[0]?.dropInto?.(injuries), '怪我は移動の宛先にならない').toBeUndefined();
    expect(view.slotViewOf(injuries).acceptsCards, '受け皿の空枠も出さない').toBe(false);
    expect(view.slotViewOf(mini.slot('equipment')).acceptsCards, '装備は落とせる場所なので空枠を出す').toBe(
      true,
    );
  });

  it('枠数の決まったスロットは、抜けた枠を詰めずに答える', () => {
    // 世界は枠の位置を保つ（SlotSystem.md 3節）ので、画面もそこを動かさない。詰めて答えると、
    // 落とした枠と札が出る枠が食い違う（空き枠へ落とすと moveToSlotAtCell が枠の番号で入れる）。
    const mini = setUp();
    const basket = mini.createObject('basket', mini.slot('hand'));
    const contents = mini.slot('contents', basket);
    const stone = mini.createObject('stone');
    expect(stone.moveToSlotOrRejection(contents, { kind: 'cell', index: 3 })).toBeUndefined();

    const cells = viewOf(mini).cardsIn(contents);

    expect(cells.length, '宣言した枠数がそのまま出る').toBe(10);
    expect(cells[3]?.objects, '入れた枠にそのまま出る').toEqual([stone]);
    expect(cells.filter((card) => card !== undefined).length, '他の枠は空いたまま').toBe(1);
  });

  it('束ねられない物は、2つ持てば2枚のカードとして並ぶ', () => {
    // 束ねると代表の中身しか開けない（SlotSystem.md 4節）ので、籠はstackable: falseを名乗る。
    const mini = setUp();
    const baskets = [0, 1].map(() => mini.createObject('basket', mini.slot('hand')));
    const stone = mini.createObject('stone', mini.slot('contents', baskets[0]));

    const view = viewOf(mini);
    const cards = handCells(view, mini).filter((card) => card !== undefined);

    expect(
      cards.map((card) => card.objects),
      '1つずつ別のカードになる',
    ).toEqual([[baskets[0]], [baskets[1]]]);
    expect(
      view.cardsIn(cards[0].visibleSlots[0]).flatMap((card) => card?.objects ?? []),
      '石を入れた方を開けば石が見える',
    ).toEqual([stone]);
    expect(
      view.cardsIn(cards[1].visibleSlots[0]).every((card) => card === undefined),
      'もう一方は空き枠だけ',
    ).toBe(true);
  });

  it('コンテナのカードは中身を映す場所を持ち、そこへ出し入れできる', () => {
    const mini = setUp();
    const basket = mini.createObject('basket', mini.slot('hand'));
    const stone = mini.createObject('stone', mini.slot('hand'));

    const first = viewOf(mini);
    const opened = cardOf(first, basket).contentsFor(cardOf(first, stone));
    expect(opened, 'コンテナのカードは中身の場所を持つ').toBeDefined();
    expect(cardOf(first, stone).contentsFor(cardOf(first, stone)), '石は何も受け取らない').toBeUndefined();
    // 行き先を探すのは落とされた側だけ。籠を石へ重ねても、石が籠へ入ることはない（combinationsと違い、
    // 枠へ入れる操作は逆向きに成立しない）。
    expect(
      cardOf(first, stone).contentsFor(cardOf(first, basket)),
      '籠を石へ重ねても何も起きない',
    ).toBeUndefined();

    // 手持ちの石を、開いた籠の中へ入れる。
    cardOf(viewOf(mini), stone).dropInto?.(opened!)?.execute();

    const view = viewOf(mini);
    expect(view.cardsIn(opened!).flatMap((card) => card?.objects ?? [])).toEqual([stone]);
    // タブのラベルはスロットの名前だけ（持ち主は見出しが言う）。この対応表は未登録なので識別子のまま。
    expect(view.slotViewOf(opened!).label).toBe(locale.slot('contents').displayName);
    expect(view.slotViewOf(opened!).key, 'タブの記憶の鍵はスロット名').toBe('contents');
    expect(view.slotViewOf(opened!).acceptsCards).toBe(true);
    expect(handCells(view, mini)[1], '石は手持ちから無くなる').toBeUndefined();

    // 中身のカードは手持ちへ戻せる。
    view.cardsIn(opened!)[0]!.dropInto?.(place(mini, 'hand'))?.execute();
    expect(mini.game.player.hand[1]).toBe(stone);
  });

  it('重ねる先の枠は、型が合うだけでなく今その物が入るかで選ぶ', () => {
    const mini = setUp();
    fillHand(mini);
    const branch = mini.createObject('branch', mini.slot('items', mini.land));

    const view = viewOf(mini);
    expect(
      handCells(view, mini).every((cell) => cell !== undefined),
      '手はすべて塞がっている',
    ).toBe(true);

    // handはequipmentより先に宣言されているが、塞がっているので次に受け取れる枠が行き先になる。
    const into = view.cardOfObjects([mini.player]).contentsFor(view.cardOfObjects([branch]));
    expect(into).toBe(mini.slot('equipment'));
  });

  it('コンテナを自分自身の中へは入れられない', () => {
    const mini = setUp();
    const basket = mini.createObject('basket', mini.slot('hand'));

    const card = cardOf(viewOf(mini), basket);

    expect(card.contentsFor(card), '籠を籠自身の中へは入れられない').toBeUndefined();
  });

  it('viewを作った後にワールドの束が空になっても、カードの操作の試し打ちは壊れない', () => {
    const mini = setUp();
    const stone = mini.createObject('stone', mini.slot('items', mini.land));

    const view = viewOf(mini);
    const card = cardOf(view, stone);

    // 経過の途中経過（RecordedView）を再生する頃には、ワールド側の束は空になり得る。
    // カードは作った時点の中身を写し取っているので、端の表示の試し打ち（moveTo）は壊れない。
    expect(stone.moveToSlotOrRejection(mini.slot('hand'))).toBeUndefined();
    expect(() => card.dropInto?.(place(mini, 'hand'))).not.toThrow();
    expect(card.movedIds(1)).toEqual([stone.instanceId]);
  });

  describe('入れ子になった場所（ScreenLayout.md 7.1.1節）', () => {
    /** 土地の上に入れ物としての場所を置き、その中へプレイヤーを移す（筏に乗り込んだ形）。 */
    const boardVessel = (mini: MiniGame): WorldObject => {
      const vessel = mini.createObject('vessel', mini.slot('fixtures', mini.land));
      expect(mini.player.moveToSlotOrRejection(mini.slot('characters', vessel))).toBeUndefined();
      return vessel;
    };

    it('外側の場所を持たない土地では、映せる場所は現在地だけ', () => {
      const mini = setUp();

      const nested = viewOf(mini).nestedLocations;

      expect(nested, '陸に居る間は切り替える先が無い').toHaveLength(1);
      expect(nested[0].fixtures, '今までどおり現在地の設置物スロットを引く').toBe(place(mini, 'fixtures'));
    });

    it('現在地がさらに別の場所の中にあると、外側の設置物スロットも引ける', () => {
      const mini = setUp();
      const vessel = boardVessel(mini);
      const tree = mini.createObject('tree', mini.slot('fixtures', mini.land));

      const view = viewOf(mini);
      const nested = view.nestedLocations;

      expect(nested, '現在地と、それを含む場所の2件').toHaveLength(2);
      expect(nested[0].fixtures, '先頭は現在地（入れ物の中）').toBe(
        vessel.getSlot(mini.codex.slotNames.getId('fixtures')),
      );
      expect(
        view.cardsIn(nested[1].fixtures).map((card) => card?.objects[0]),
        '外側の設置物が引ける（乗っている入れ物自身も外側から見れば設置物）',
      ).toEqual([vessel, tree]);
    });

    it('切り替える先があっても、アイテムと手持ちが映す場所は現在地とプレイヤーのまま', () => {
      // 切り替わるのは設置物レーンだけ（ScreenLayout.md 7.1.1節）。
      const mini = setUp();
      const vessel = boardVessel(mini);

      const view = viewOf(mini);

      expect(view.places('items')).toBe(vessel.getSlot(mini.codex.slotNames.getId('items')));
      expect(view.places('hand')).toBe(mini.slot('hand'));
      expect(view.currentLocationCard.identity, '現在地の札は入れ物のまま').toEqual([vessel.instanceId]);
    });

    it('探索は、その場所ごとに別々に効く', () => {
      const mini = setUp();
      const vessel = boardVessel(mini);

      const nested = viewOf(mini).nestedLocations;

      expect(nested[1].explore(), '外側の土地は探索を宣言していない').toBe(false);
      expect(nested[0].explore(), '現在地（入れ物）は探索できる').toBe(true);
      expect(
        vessel.getProperty(mini.codex.propertyNames.getId('exploration_progress')).getEffectiveValue(),
        '進んだのは探索した側だけ',
      ).toBe(1);
    });

    it('withFrozenCardsは、外側の場所の設置物も焼き付ける', () => {
      // 経過を見せている間に外側を映していても、そこだけが未来を映すことがないように。
      const mini = setUp();
      const vessel = boardVessel(mini);
      const tree = mini.createObject('tree', mini.slot('fixtures', mini.land));

      const frozen = withFrozenCards(viewOf(mini), []);
      // 控えたあとでワールドが変わる（外側に在った木が、入れ物の中へ移る）。
      expect(tree.moveToSlotOrRejection(mini.slot('fixtures', vessel))).toBeUndefined();

      expect(
        frozen.cardsIn(frozen.nestedLocations[1].fixtures).map((card) => card?.objects[0]),
        '外側の設置物レーンも控えた時点のまま',
      ).toEqual([vessel, tree]);
    });
  });
});
