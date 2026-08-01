import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import type { NewGameSession } from '../../src/domain/generation/NewGame';
import { start as startNewGame } from '../../src/domain/generation/NewGame';
import { Path } from '../../src/domain/runtime/views/Path';
import { fromGameSession, withFrozenCards } from '../../src/game/PlayScreenView';
import type { Localization } from '../../src/locale/Localization';
import { parseLocale } from '../../src/locale/Localization';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { SeededRng } from '../support/SeededRng';
import { pathsIn } from '../support/paths';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * プレイ中の画面の表示内容が、ワールドの実際の状態（現在地・そのスロットの中身・手持ち）から
 * 作られていることの自動テスト。
 */
describe('PlayScreenView(ゲーム状態から画面の表示内容を作る)', () => {
  let codex: WorldCodex;
  let locale: Localization;

  /** 現在地を探索率100%まで探索する。100%到達後も探索は続けられるため、回数で止める。 */
  function exploreToFull(game: NewGameSession): void {
    const location = game.player.location ?? game.startLocation;
    for (let i = 0; i < location.explorationProgressMax; i++) game.player.explore(game.session);
  }

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    locale = parseLocale('ja.yaml', 'object_texts:\n  stone:\n    display_name: 石\n');
  });

  it('開始直後は漂着地だけが出て、設置物・アイテムのレーンは空になる', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));

    const view = fromGameSession(game, codex, locale);

    expect(view.currentLocation.name, '現在地は命名処理が付けた漂着地の名前').toBe(
      game.map.nameOfInstance(game.startLocation.instance.instanceId),
    );
    expect(view.fixtures, '未探索なので設置物も道も見つかっていない').toEqual([]);
    expect(view.items, '未探索なので土地には何も落ちていない').toEqual([]);
    expect(view.elapsedDays).toBe(0);
    expect(view.hour).toBe(0);
    expect(view.minute).toBe(0);
  });

  it('手持ちは固定6枠ぶん並び、空きセルはundefinedになる', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const stone = game.session.spawn(codex.objectNames.getId('stone'));
    expect(
      stone.moveToSlot(game.player.instance, codex.slotNames.getId('hand'), codex.wellKnown),
    ).toBeUndefined();

    const view = fromGameSession(game, codex, locale);

    expect(view.hand).toHaveLength(6);
    expect(view.hand[0], 'カード名は対応表から引いた表示文字列').toMatchObject({
      icon: '📦',
      name: '石',
    });
    expect(view.hand.slice(1), '残りの枠は空きセルとして残る').toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('探索で見つかった発見物と道が、それぞれのレーンの内容になる', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const location = game.startLocation;
    exploreToFull(game);

    const view = fromGameSession(game, codex, locale);

    expect(view.items.map((card) => card.name)).toEqual(
      location.itemStacks.map((stack) => locale.object(stack[0].def.name).displayName),
    );
    expect(view.items.length, '探索し切れば何かしら見つかっている').toBeGreaterThan(0);

    // 設置物のレーンには道も並ぶ。道のカードだけは、道そのものではなく行き先の土地名を映す。
    const pathTagId = codex.tagNames.getId('path');
    expect(view.fixtures.map((card) => card.name)).toEqual(
      location.fixtureStacks.map((stack) =>
        stack[0].def.tags.includes(pathTagId)
          ? game.map.nameOfInstance(new Path(stack[0], codex.propertyNames).destinationInstanceId)
          : locale.object(stack[0].def.name).displayName,
      ),
    );
    expect(pathsIn(location, codex).length, '探索し切れば全ての道が見つかっている').toBeGreaterThan(0);
  });

  it('行き先の違う道は、1枚のカードにまとまらない', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    exploreToFull(game);
    const paths = pathsIn(game.startLocation, codex);
    const destinations = new Set(
      paths.map((path) => new Path(path, codex.propertyNames).destinationInstanceId),
    );
    expect(destinations.size, '行き先の違う道が2本以上ある土地で確かめる').toBeGreaterThan(1);

    const view = fromGameSession(game, codex, locale);

    expect(new Set(view.fixtures.map((card) => card.name)).size, '道のカードは行き先ごとに分かれる').toBe(
      destinations.size,
    );
  });

  it('探索率は現在地の進捗を0〜1で表し、100%を超えない', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));

    expect(fromGameSession(game, codex, locale).explorationRatio, '開始直後は未探索').toBe(0);

    exploreToFull(game);
    expect(fromGameSession(game, codex, locale).explorationRatio, '探索し切れば100%').toBe(1);

    // 100%到達後も探索は続けられる（ExplorationSystem.md 2節）が、探索率は100%のまま。
    expect(game.player.explore(game.session)).toBe(true);
    expect(fromGameSession(game, codex, locale).explorationRatio).toBe(1);
  });

  it('アイテムのmoveで手持ちへ移り、手持ちのmoveでフィールドへ戻る', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    exploreToFull(game);
    const picked = game.startLocation.items[0];

    fromGameSession(game, codex, locale).items[0].moveTo?.('hand')?.();

    expect(game.player.hand[0], '押したアイテムが手持ちの先頭の枠に入る').toBe(picked);
    expect(game.startLocation.items, 'フィールドからは無くなる').not.toContain(picked);

    fromGameSession(game, codex, locale).hand[0]?.moveTo?.('items')?.();

    expect(game.player.hand[0], '手持ちの枠は空く').toBeUndefined();
    expect(game.startLocation.items, 'フィールドへ戻る').toContain(picked);
  });

  it('設置物のカードは移せないが、同じレーンの中でなら並び替えられる', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const tree = game.session.spawn(codex.objectNames.getId('palm_tree'));
    expect(
      tree.moveToSlot(game.startLocation.instance, codex.slotNames.getId('fixtures'), codex.wellKnown),
    ).toBeUndefined();

    const view = fromGameSession(game, codex, locale);

    expect(view.items, '設置物はアイテムのレーンには出ない').toEqual([]);
    expect(
      view.fixtures.map((card) => card.moveTo),
      '持ち歩けないので移動の宛先を持たない',
    ).toEqual([undefined]);
    expect(view.fixtures[0].reorder, '並び方はプレイヤーが決めるので並び替えはできる').toBeTypeOf('function');
  });

  it('手持ちが6枠とも埋まっていると、アイテムのmoveは何も起こさない', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    // 同種はスタックにまとまり1枠しか使わないため、別種のアイテムで6枠を埋める。
    const handSlotId = codex.slotNames.getId('hand');
    for (const name of ['stone', 'branch', 'thick_branch', 'coconut', 'taro', 'water_spinach']) {
      const item = game.session.spawn(codex.objectNames.getId(name));
      expect(item.moveToSlot(game.player.instance, handSlotId, codex.wellKnown)).toBeUndefined();
    }
    exploreToFull(game);
    const items = [...game.startLocation.items];

    fromGameSession(game, codex, locale).items[0].moveTo?.('hand')?.();

    expect(game.startLocation.items, 'フィールドの中身は変わらない').toEqual(items);
  });

  it('カードの識別子は、そのカードが映しているインスタンスのID一式になる', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const handSlotId = codex.slotNames.getId('hand');
    const stones = [0, 1].map(() => game.session.spawn(codex.objectNames.getId('stone')));
    for (const stone of stones) {
      expect(stone.moveToSlot(game.player.instance, handSlotId, codex.wellKnown)).toBeUndefined();
    }
    exploreToFull(game);

    const view = fromGameSession(game, codex, locale);

    expect(view.hand[0]?.identity, '同種2個は1枚のカードなので、両方のIDを持つ').toEqual(
      stones.map((stone) => stone.instanceId),
    );
    expect(view.hand[0]?.count, 'スタック数はそのままインスタンスの個数').toBe(2);
    expect(
      view.items.map((card) => card.identity),
      'フィールドも同種はスタックにまとまって1枚',
    ).toEqual(game.startLocation.itemStacks.map((stack) => stack.map((item) => item.instanceId)));
  });

  it('手持ちのカードは装備へ移せる（装備固有の経路ではなく、場所を指すだけ）', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const stone = game.session.spawn(codex.objectNames.getId('stone'));
    expect(
      stone.moveToSlot(game.player.instance, codex.slotNames.getId('hand'), codex.wellKnown),
    ).toBeUndefined();

    fromGameSession(game, codex, locale).hand[0]?.moveTo?.('equipment')?.();

    expect(game.player.hand[0], '手持ちからは無くなる').toBeUndefined();
    expect(
      game.player.equipmentStacks.map((stack) => stack[0]),
      '装備スロットへ入る',
    ).toEqual([stone]);

    const view = fromGameSession(game, codex, locale);
    expect(view.cardsIn('equipment')[0].place).toBe('equipment');

    view.cardsIn('equipment')[0].moveTo?.('hand')?.();
    expect(game.player.hand[0], '手持ちへ戻せる').toBe(stone);
  });

  it('withFrozenCardsは、控えた時点の中身を返し続ける', () => {
    // 時間経過の再現（PlayScene）では、控えておいたviewをあとから表示する。cardsInだけは呼んだ時点の
    // 生きたワールドを読むため、固定しないとその部分に限って「今」の状態が出てしまう。
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const stone = game.session.spawn(codex.objectNames.getId('stone'));
    const equipment = codex.slotNames.getId('equipment');
    expect(stone.moveToSlot(game.player.instance, equipment, codex.wellKnown)).toBeUndefined();

    const live = fromGameSession(game, codex, locale);
    const frozen = withFrozenCards(live, 'equipment');

    // 控えたあとでワールドが変わる（装備が外れる）。
    expect(
      stone.moveToSlot(game.player.instance, codex.slotNames.getId('hand'), codex.wellKnown),
    ).toBeUndefined();

    expect(
      frozen.cardsIn('equipment').map((card) => card.objects[0]),
      '固定した場所は控えた時点のまま',
    ).toEqual([stone]);
    expect(live.cardsIn('equipment'), '固定していないviewは今のワールドを読む').toEqual([]);
    expect(frozen.cardsIn('injuries'), '固定していない場所は今のワールドを読む').toEqual([]);
    expect(frozen.items, 'cardsIn以外は元のviewのまま').toBe(live.items);
  });

  it('withFrozenCardsは、開いている場所が無ければviewをそのまま返す', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const view = fromGameSession(game, codex, locale);

    expect(withFrozenCards(view, undefined)).toBe(view);
  });

  it('怪我は移動も並び替えもできない', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const stone = game.session.spawn(codex.objectNames.getId('stone'));
    // 怪我のobject_defはまだ無いため、怪我スロットの中身としてitemを強制的に入れて代用する。
    expect(
      stone.moveToSlot(game.player.instance, codex.slotNames.getId('injuries'), codex.wellKnown, true),
    ).toBeUndefined();

    const view = fromGameSession(game, codex, locale);

    expect(view.cardsIn('injuries')).toHaveLength(1);
    expect(view.cardsIn('injuries')[0].moveTo, '取り出せない').toBeUndefined();
    expect(view.cardsIn('injuries')[0].reorder, '並び替えもできない').toBeUndefined();
    expect(view.hand[0]?.moveTo?.('injuries'), '怪我は移動の宛先にならない').toBeUndefined();
  });

  it('コンテナのカードは中身を映す場所を持ち、そこへ出し入れできる', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const handSlotId = codex.slotNames.getId('hand');
    const basket = game.session.spawn(codex.objectNames.getId('woven_basket'));
    const stone = game.session.spawn(codex.objectNames.getId('stone'));
    for (const item of [basket, stone]) {
      expect(item.moveToSlot(game.player.instance, handSlotId, codex.wellKnown)).toBeUndefined();
    }

    const opened = fromGameSession(game, codex, locale).hand[0]?.contents;
    expect(opened, 'コンテナのカードは中身の場所を持つ').toBeDefined();
    expect(fromGameSession(game, codex, locale).hand[1]?.contents, '石はコンテナではない').toBeUndefined();

    // 手持ちの石を、開いた籠の中へ入れる。
    fromGameSession(game, codex, locale).hand[1]?.moveTo?.(opened!)?.();

    const view = fromGameSession(game, codex, locale);
    expect(view.cardsIn(opened!).flatMap((card) => card.objects)).toEqual([stone]);
    expect(view.nameOf(opened!), 'タイトルはコンテナ自身の表示名').toBe(
      locale.object('woven_basket').displayName,
    );
    expect(view.acceptsCards(opened!)).toBe(true);
    expect(view.hand[1], '石は手持ちから無くなる').toBeUndefined();

    // 中身のカードは手持ちへ戻せる。
    view.cardsIn(opened!)[0].moveTo?.('hand')?.();
    expect(game.player.hand[1]).toBe(stone);
  });

  it('コンテナを自分自身の中へは入れられない', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const basket = game.session.spawn(codex.objectNames.getId('woven_basket'));
    expect(basket.moveToSlot(game.player.instance, codex.slotNames.getId('hand'), codex.wellKnown)).toBe(
      undefined,
    );

    const card = fromGameSession(game, codex, locale).hand[0];

    expect(card?.moveTo?.(card.contents!), '籠を籠自身の中へは入れられない').toBeUndefined();
  });

  it('combinationOfは、withタグが合うカード同士にだけ実行手段を返す', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const view = fromGameSession(game, codex, locale);
    // water_liquidはwith: water_liquidのpour_inを持つ（liquid_containers.yaml）。
    const cardOf = (name: string) => ({
      icon: '',
      name,
      place: 'items' as const,
      objects: [game.session.spawn(codex.objectNames.getId(name))],
      actions: [],
    });
    const water = cardOf('water_liquid');

    expect(view.combinationOf(water, cardOf('water_liquid'))?.execute).toBeTypeOf('function');
    expect(view.combinationOf(water, cardOf('stone')), '受け側にマッチする組み合わせが無い').toBeUndefined();
  });

  it('同じカードへ重ねたときは、スタックの中の2つを組み合わせる', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const itemsSlotId = codex.slotNames.getId('items');
    for (const name of ['stone', 'stone', 'thick_branch']) {
      const item = game.session.spawn(codex.objectNames.getId(name));
      expect(item.moveToSlot(game.startLocation.instance, itemsSlotId, codex.wellKnown)).toBeUndefined();
    }

    const view = fromGameSession(game, codex, locale);
    const cardOf = (name: string) => view.items.find((card) => card?.objects[0].def.name === name)!;
    const stones = cardOf('stone');
    expect(stones.count, '2個の石は1枚のカードにまとまる').toBe(2);

    // 石と石はsharp_stoneになる（tools.yaml）。1個しか無いカードには相手が居ない。
    expect(view.combinationOf(stones, stones)?.execute, 'スタックの中の2つで実行できる').toBeTypeOf(
      'function',
    );
    const thickBranch = cardOf('thick_branch');
    expect(
      view.combinationOf(thickBranch, thickBranch),
      '1個しか無いカードは自分自身とは組み合わせられない',
    ).toBeUndefined();
  });

  it('combinationOfは、ドラッグ中に見せる表示名と説明も返す', () => {
    // 吹き出しに出す文字列はlocale側から来る（Localization.md）。ここでは専用の対応表で確かめる。
    const texts = parseLocale(
      'ja.yaml',
      `object_texts:
  stone:
    display_name: 石
    combinations:
      knap:
        display_name: 打ち割る
        description: 石を打ち合わせて割る。
`,
    );
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const itemsSlotId = codex.slotNames.getId('items');
    for (const name of ['stone', 'stone']) {
      const stone = game.session.spawn(codex.objectNames.getId(name));
      expect(stone.moveToSlot(game.startLocation.instance, itemsSlotId, codex.wellKnown)).toBeUndefined();
    }

    const view = fromGameSession(game, codex, texts);
    const stones = view.items.find((card) => card.objects[0].def.name === 'stone')!;

    expect(view.combinationOf(stones, stones)).toMatchObject({
      name: '打ち割る',
      description: '石を打ち合わせて割る。',
    });
  });

  it('カードは、そのオブジェクトの説明文とアクションを持つ', () => {
    const texts = parseLocale(
      'ja.yaml',
      `object_texts:
  coconut:
    display_name: ヤシの実
    description: 硬い殻に覆われた実。
    actions:
      eat:
        display_name: 食べる
        description: 殻を割って中身を食べる。
`,
    );
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const coconut = game.session.spawn(codex.objectNames.getId('coconut'));
    expect(
      coconut.moveToSlot(game.player.instance, codex.slotNames.getId('hand'), codex.wellKnown),
    ).toBeUndefined();
    // 満腹度は初期値が上限なので、食べた分が乗る余地を空けておく。
    const satietyId = codex.propertyNames.getId('satiety');
    game.player.instance.setNumber(satietyId, 0, game.session);

    const card = fromGameSession(game, codex, texts).hand[0];

    expect(card?.description).toBe('硬い殻に覆われた実。');
    expect(card?.actions).toMatchObject([{ name: '食べる', description: '殻を割って中身を食べる。' }]);

    card?.actions[0].execute();

    expect(game.player.instance.getNumber(satietyId), '食べた分だけ満腹度が上がる').toBeGreaterThan(0);
    expect(game.player.hand[0], '食べたヤシの実は無くなる').toBeUndefined();
  });

  it('アクションを持たないオブジェクトのカードは、アクションが空になる', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const thickBranch = game.session.spawn(codex.objectNames.getId('thick_branch'));
    expect(
      thickBranch.moveToSlot(game.player.instance, codex.slotNames.getId('hand'), codex.wellKnown),
    ).toBeUndefined();

    const card = fromGameSession(game, codex, locale).hand[0];

    expect(card?.actions).toEqual([]);
    expect(card?.description, 'localeに説明文が無ければundefined').toBeUndefined();
  });

  it('中身が代表するカード（液体容器）には、中身のアクションが並ぶ', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const canteen = game.session.spawn(codex.objectNames.getId('canteen'));
    const water = game.session.spawn(codex.objectNames.getId('water_liquid'));
    water.setNumber(codex.propertyNames.getId('size'), 1000, game.session);
    expect(water.moveToSlot(canteen, codex.slotNames.getId('content'), codex.wellKnown)).toBeUndefined();
    // 液体容器にはまだitemタグが無く手持ちのaccepts制約に掛かるため、強制的に入れて手持ちのカードにする。
    expect(
      canteen.moveToSlot(game.player.instance, codex.slotNames.getId('hand'), codex.wellKnown, true),
    ).toBeUndefined();
    const hydrationId = codex.propertyNames.getId('hydration');
    game.player.instance.setNumber(hydrationId, 0, game.session);

    // 水筒のカードだが、操作の対象は代表（represented_by）である中身の水になる（ActionSystem.md 1節）。
    const card = fromGameSession(game, codex, locale).hand[0];

    expect(card?.actions.map((action) => action.name)).toEqual(['drink']);

    card?.actions[0].execute();

    expect(game.player.instance.getNumber(hydrationId), '飲んだ分だけ水分が増える').toBeGreaterThan(0);
  });

  it('アクションはかかる時間を持つ（durationを持たなければ0）', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    exploreToFull(game);
    const path = pathsIn(game.startLocation, codex)[0];
    const coconut = game.session.spawn(codex.objectNames.getId('coconut'));
    expect(
      coconut.moveToSlot(game.player.instance, codex.slotNames.getId('hand'), codex.wellKnown),
    ).toBeUndefined();

    const view = fromGameSession(game, codex, locale);

    // 道のtravelのdurationは、その道のtravel_minutesを引く（locations.yaml）。
    const travel = view.fixtures.find((card) => card.objects[0] === path)!.actions[0];
    expect(travel.minutes).toBe(new Path(path, codex.propertyNames).travelMinutes);
    expect(travel.minutes, '移動には時間がかかる').toBeGreaterThan(0);
    expect(view.hand[0]?.actions[0].minutes, 'eatはdurationを持たない').toBe(0);
  });

  it('combinationもかかる時間を持つ', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const itemsSlotId = codex.slotNames.getId('items');
    for (const name of ['stone', 'stone']) {
      const stone = game.session.spawn(codex.objectNames.getId(name));
      expect(stone.moveToSlot(game.startLocation.instance, itemsSlotId, codex.wellKnown)).toBeUndefined();
    }

    const view = fromGameSession(game, codex, locale);
    const stones = view.items.find((card) => card.objects[0].def.name === 'stone')!;

    // 石を打ち割るknapのdurationは60分（locations.yaml）。
    expect(view.combinationOf(stones, stones)?.minutes).toBe(60);
  });

  it('道のカードのアクションで、現在地が行き先へ移る', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    exploreToFull(game);
    const path = new Path(pathsIn(game.startLocation, codex)[0], codex.propertyNames);

    const view = fromGameSession(game, codex, locale);
    const card = view.fixtures.find((fixture) => fixture.objects[0] === path.instance)!;
    card.actions.find((action) => action.name === 'travel')!.execute();

    expect(fromGameSession(game, codex, locale).currentLocation.name).toBe(
      game.map.nameOfInstance(path.destinationInstanceId),
    );
  });

  it('ステータスエリアには、statusタグが付いたプロパティだけが実際の値で並ぶ', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const statusTagId = codex.propertyTagNames.getId('status');
    const tagged = game.player.instance.readPropertiesWithTag(statusTagId);

    const view = fromGameSession(game, codex, locale);

    expect(view.statuses).toHaveLength(tagged.length);
    // 初期値はどれもmax（characters.yaml）なので、バーは満タンで、どれも安全域に入る。
    expect(view.statuses.map((status) => status.ratio)).toEqual(tagged.map(() => 1));
    expect(view.statuses.map((status) => status.alert)).toEqual(tagged.map(() => 'safe'));
    expect(view.statuses.map((status) => status.key)).toEqual(tagged.map((reading) => reading.name));
    // localeに登録の無いcharacterでは識別子がそのまま出る（Localization.md）。
    expect(view.statuses.map((status) => status.name)).toEqual(tagged.map((reading) => reading.name));
  });

  it('ステータスの域は、値が減るとその区分に従って上がる', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const hydration = codex.propertyNames.getId('hydration');
    // 残り6時間未満（600mL未満）で致命的域（characters.yaml）。
    game.player.instance.setNumber(hydration, 500, game.session);

    const view = fromGameSession(game, codex, locale);

    expect(view.statuses.find((status) => status.key === 'hydration')?.alert).toBe('fatal');
  });

  it('プロパティウィンドウのタブはproperty_tagsの宣言順で、中身のないタグは出ない', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const declared = [...Array(codex.propertyTagNames.count).keys()].map((id) =>
      codex.propertyTagNames.getName(id),
    );

    const view = fromGameSession(game, codex, locale);

    const shown = declared.filter(
      (name) => game.player.instance.readPropertiesWithTag(codex.propertyTagNames.getId(name)).length > 0,
    );
    expect(view.propertyCategories.map((category) => category.name)).toEqual(shown);
    for (const category of view.propertyCategories) expect(category.entries.length).toBeGreaterThan(0);
  });

  it('プロパティウィンドウには、ステータスエリアに出ないプロパティも出る', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));

    const view = fromGameSession(game, codex, locale);

    const shown = new Set(view.propertyCategories.flatMap((c) => c.entries.map((e) => e.name)));
    const inStatusArea = new Set(view.statuses.map((status) => status.name));
    // body_fatはnutritionタグだけを持つ（characters.yaml）ため、ウィンドウにだけ現れる。
    expect(shown.has('body_fat')).toBe(true);
    expect(inStatusArea.has('body_fat')).toBe(false);
  });

  it('現在地は移動に追従する', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    exploreToFull(game);
    const path = new Path(pathsIn(game.startLocation, codex)[0], codex.propertyNames);
    expect(path.travel(game.player.instance, game.session)).toBe(true);

    const view = fromGameSession(game, codex, locale);

    expect(view.currentLocation.name).toBe(game.map.nameOfInstance(path.destinationInstanceId));
  });
});
