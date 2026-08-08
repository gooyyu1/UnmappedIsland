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
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * プレイ中の画面の表示内容が、ワールドの実際の状態（現在地・そのスロットの中身・手持ち）から
 * 作られていることの自動テスト。
 */
describe('PlayScreenView(ゲーム状態から画面の表示内容を作る)', () => {
  let codex: WorldCodex;
  let locale: Localization;

  /** プレイヤーに怪我（injuries.yaml）を1つ負わせ、そのインスタンスを返す。 */
  function injure(game: NewGameSession) {
    const injury = game.session.spawn(codex.objectNames.getId('sprained_ankle'));
    expect(
      injury.moveToSlot(game.player.instance, codex.slotNames.getId('injuries'), codex.wellKnown),
    ).toBeUndefined();
    return injury;
  }

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
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));

    const view = fromGameSession(game, codex, locale);

    expect(view.currentLocation.name, '現在地は命名処理が付けた漂着地の名前').toBe(
      locale.locationName(game.map.nameOfInstance(game.startLocation.instance.instanceId)!),
    );
    expect(view.fixtures, '未探索なので設置物も道も見つかっていない').toEqual([]);
    expect(view.items, '未探索なので土地には何も落ちていない').toEqual([]);
    expect(view.elapsedDays).toBe(0);
    expect(view.hour * 60 + view.minute, '時計はランダムに決まった開始時刻をそのまま映す').toBe(
      game.world.hour * 60 + game.world.minute,
    );
  });

  it('天気は、worldの今の天気の識別子をそのまま映す', () => {
    // 雨の演出（ScreenLayout.md）がこの識別子を読むため、表示文字列ではなく識別子で持つ。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const weatherId = codex.propertyNames.getId('weather');

    expect(fromGameSession(game, codex, locale).weather).toBe('clear');

    game.world.instance.setNumber(weatherId, codex.symbolNames.getId('storm'), game.session);

    expect(fromGameSession(game, codex, locale).weather).toBe('storm');
  });

  it('手持ちは固定6枠ぶん並び、空きセルはundefinedになる', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
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
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
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
          ? locale.locationName(
              game.map.nameOfInstance(new Path(stack[0], codex.propertyNames).destinationInstanceId)!,
            )
          : locale.object(stack[0].def.name).displayName,
      ),
    );
    expect(pathsIn(location, codex).length, '探索し切れば全ての道が見つかっている').toBeGreaterThan(0);
  });

  it('行き先の違う道は、1枚のカードにまとまらない', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);
    const paths = pathsIn(game.startLocation, codex);
    const destinations = new Set(
      paths.map((path) => new Path(path, codex.propertyNames).destinationInstanceId),
    );
    expect(destinations.size, '行き先の違う道が2本以上ある土地で確かめる').toBeGreaterThan(1);

    const view = fromGameSession(game, codex, locale);

    // 設置物のレーンには探索で見つかった木や茂みも並ぶので、道のカードだけを数える。
    const pathTagId = codex.tagNames.getId('path');
    const pathCardNames = view.fixtures
      .filter((card) => card.objects[0].def.tags.includes(pathTagId))
      .map((card) => card.name);

    expect(new Set(pathCardNames).size, '道のカードは行き先ごとに分かれる').toBe(destinations.size);
  });

  it('道のカードは行き先の土地の絵を出し、他の設置物は自分の絵を出す', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);

    const view = fromGameSession(game, codex, locale);

    const pathTagId = codex.tagNames.getId('path');
    const [paths, others] = [true, false].map((isPath) =>
      view.fixtures.filter((card) => card.objects[0].def.tags.includes(pathTagId) === isPath),
    );
    expect(paths.length, '道と道以外が並ぶ土地で確かめる').toBeGreaterThan(0);
    expect(others.length).toBeGreaterThan(0);

    expect(paths.map((card) => card.art)).toEqual(
      paths.map((card) => new Path(card.objects[0], codex.propertyNames).destination?.def.name),
    );
    expect(
      paths.some((card) => card.art !== game.startLocation.instance.def.name),
      '行き先は今いる土地とは限らない',
    ).toBe(true);
    expect(others.every((card) => card.art === card.objects[0].def.name)).toBe(true);
  });

  it('探索率は現在地の進捗を0〜1で表し、100%を超えない', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));

    expect(fromGameSession(game, codex, locale).explorationRatio, '開始直後は未探索').toBe(0);

    exploreToFull(game);
    expect(fromGameSession(game, codex, locale).explorationRatio, '探索し切れば100%').toBe(1);

    // 100%到達後も探索は続けられる（ExplorationSystem.md 2節）が、探索率は100%のまま。
    expect(game.player.explore(game.session)).toBe(true);
    expect(fromGameSession(game, codex, locale).explorationRatio).toBe(1);
  });

  it('アイテムのmoveで手持ちへ移り、手持ちのmoveでフィールドへ戻る', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
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
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const tree = game.session.spawn(codex.objectNames.getId('palm_tree'));
    expect(
      tree.moveToSlot(game.startLocation.instance, codex.slotNames.getId('fixtures'), codex.wellKnown),
    ).toBeUndefined();

    const view = fromGameSession(game, codex, locale);

    expect(view.items, '設置物はアイテムのレーンには出ない').toEqual([]);
    // 持ち歩けないのは「設置物レーンが読み取り専用だから」ではなく、ヤシの木がitemタグを持たず
    // 手持ちのacceptsに掛からないから。itemも兼ねる設置物（持ち運べるかご）を足せば移せるようになる。
    expect(view.fixtures[0].moveTo?.('hand'), '手には持てない').toBeUndefined();
    expect(view.fixtures[0].moveTo?.('items'), '地面へも下ろせない').toBeUndefined();
    expect(view.fixtures[0].reorder, '並び方はプレイヤーが決めるので並び替えはできる').toBeTypeOf('function');
  });

  it('itemとfixtureを兼ねる物は、設置物レーンとアイテムレーンを行き来できる', () => {
    // 端の▲▼が出るかは「そこへ移せるか」で決まる（PlayScene.cardEdges）ので、両方のタグを持つ
    // 編み籠は設置物レーンで▼、アイテムレーンで▲を出す。画面側に場所ごとの決まりは無い。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const basket = game.session.spawn(codex.objectNames.getId('woven_basket'));
    expect(
      basket.moveToSlot(game.startLocation.instance, codex.slotNames.getId('items'), codex.wellKnown),
    ).toBeUndefined();

    fromGameSession(game, codex, locale).items[0].moveTo?.('fixtures')?.();

    const placed = fromGameSession(game, codex, locale);
    expect(
      placed.fixtures.map((card) => card.name),
      '地面に据わる',
    ).toEqual([placed.fixtures[0].name]);
    expect(placed.items, 'アイテムレーンからは消える').toEqual([]);

    placed.fixtures[0].moveTo?.('items')?.();

    const lifted = fromGameSession(game, codex, locale);
    expect(lifted.fixtures, '据えたものを拾い直せる').toEqual([]);
    expect(lifted.items).toHaveLength(1);
    expect(lifted.items[0].moveTo?.('hand'), 'そのまま手にも持てる').toBeTypeOf('function');
  });

  it('設置物レーンのカードだけが、今いる土地を背景として持つ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const tree = game.session.spawn(codex.objectNames.getId('palm_tree'));
    expect(
      tree.moveToSlot(game.startLocation.instance, codex.slotNames.getId('fixtures'), codex.wellKnown),
    ).toBeUndefined();
    exploreToFull(game);

    const view = fromGameSession(game, codex, locale);

    expect(
      view.fixtures.map((card) => card.background),
      '道も含め、このレーンのカードはすべて土地の識別子を持つ',
    ).toEqual(view.fixtures.map(() => view.locationArt));
    expect(
      view.items.every((card) => card.background === undefined),
      '同じ土地に在っても、アイテムのレーンのカードは背景を持たない',
    ).toBe(true);
  });

  it('現在地のカードは、その土地の絵を持つ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));

    const view = fromGameSession(game, codex, locale);

    expect(view.currentLocation.art, '土地そのものもobject_defなので、絵は識別子で引ける').toBe(
      game.startLocation.instance.def.name,
    );
  });

  it('耐久度を持つカードだけが、その残りの割合を持つ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const handSlotId = codex.slotNames.getId('hand');
    const durabilityId = codex.propertyNames.getId('durability');
    const sharpStone = game.session.spawn(codex.objectNames.getId('sharp_stone'));
    const stone = game.session.spawn(codex.objectNames.getId('stone'));
    for (const item of [sharpStone, stone]) {
      expect(item.moveToSlot(game.player.instance, handSlotId, codex.wellKnown)).toBeUndefined();
    }

    expect(fromGameSession(game, codex, locale).hand[0]?.durability, '作りたては満タン').toBe(1);
    expect(fromGameSession(game, codex, locale).hand[1]?.durability, '石は耐久度を持たない').toBeUndefined();

    sharpStone.addNumber(durabilityId, -sharpStone.getNumber(durabilityId) / 4, game.session);

    expect(fromGameSession(game, codex, locale).hand[0]?.durability, '減った分だけ割合が下がる').toBe(0.75);
  });

  it('怪我のカードは耐久度ではなく、残っている傷とその域を持つ', () => {
    // 耐久度バーは道具の控えめな細線で、あとどれだけで治るかはそれとは別の見せ方をする
    // （ScreenLayout.md カードの状態バー節）。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const injury = injure(game);

    expect(fromGameSession(game, codex, locale).cardsIn('injuries')[0].durability).toBeUndefined();
    expect(fromGameSession(game, codex, locale).cardsIn('injuries')[0].severity).toEqual({
      ratio: 1,
      alert: 'caution',
    });

    const severityId = codex.propertyNames.getId('severity');
    injury.addNumber(severityId, -injury.getNumber(severityId) / 2, game.session);

    const healing = fromGameSession(game, codex, locale).cardsIn('injuries')[0].severity;
    expect(healing?.ratio, '半分治れば半分まで縮む').toBeCloseTo(0.5, 3);
    expect(healing?.alert, '治るほど軽い域へ移る').toBe('watch');
  });

  it('治療具を当てた怪我のカードだけが、手当て済みの印を持つ', () => {
    // 手当ての有無で絵は差し替えない（ScreenLayout.md カードの印 節）。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const injury = injure(game);

    expect(fromGameSession(game, codex, locale).cardsIn('injuries')[0].mark).toBeUndefined();

    const bandage = game.session.spawn(codex.objectNames.getId('bandage'));
    expect(bandage.moveToSlot(injury, codex.slotNames.getId('treatment'), codex.wellKnown)).toBeUndefined();

    expect(fromGameSession(game, codex, locale).cardsIn('injuries')[0].mark).toBe('🩹');
  });

  it('中身を持つカードは、それを映す場所と、空けておく枠の数の元になる容量を持つ', () => {
    // 中身を見せるかはタグではなくスロットで決める（ScreenLayout.md 子ウィンドウ節）。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const injury = injure(game);
    const basket = game.session.spawn(codex.objectNames.getId('woven_basket'));
    expect(
      basket.moveToSlot(game.player.instance, codex.slotNames.getId('hand'), codex.wellKnown),
    ).toBeUndefined();

    const view = fromGameSession(game, codex, locale);
    const injuryCard = view.cardsIn('injuries')[0];
    const basketCard = view.hand.find((card) => card?.objects[0] === basket)!;

    expect(injuryCard.contents, '怪我は治療具のスロットを開く').toEqual({ container: injury });
    expect(view.unitCapacityOf(injuryCard.contents!), '治療具の枠は1つだけ').toBe(1);

    expect(basketCard.contents, 'コンテナは中身のスロットを開く').toEqual({ container: basket });
    expect(view.unitCapacityOf(basketCard.contents!), 'かごの枠数は決まっていない').toBeUndefined();
  });

  it('液体の容器は中身を開かない（水を単独で取り出させない）', () => {
    // 見せるスロットはワールド側が名乗る（show_contents、GameElementDefinition.md 7.8節）。
    // 液体の容器のcontentは名乗っていないので、押しても説明とアクションだけが出る。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const bowl = game.session.spawn(codex.objectNames.getId('coconut_bowl'));
    const water = game.session.spawn(codex.objectNames.getId('water_liquid'));
    expect(
      bowl.moveToSlot(game.player.instance, codex.slotNames.getId('hand'), codex.wellKnown),
    ).toBeUndefined();
    expect(water.moveToSlot(bowl, codex.slotNames.getId('content'), codex.wellKnown)).toBeUndefined();

    const card = fromGameSession(game, codex, locale).hand.find((held) => held?.objects[0] === bowl)!;

    expect(card.contents, '中身の並びは開かない').toBeUndefined();
    expect(card.fill?.ratio, '入っていることはバーで見せる').toBeGreaterThan(0);
  });

  it('液体容器のカードは、中身が入っている間だけ、その割合と液体の色を持つ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const bowl = game.session.spawn(codex.objectNames.getId('coconut_bowl'));
    expect(
      bowl.moveToSlot(game.player.instance, codex.slotNames.getId('hand'), codex.wellKnown),
    ).toBeUndefined();

    expect(
      fromGameSession(game, codex, locale).hand[0]?.fill,
      '空の容器は映す中身がいないのでバーを出さない',
    ).toBeUndefined();

    // ヤシの器の容量は250mL（liquid_containers.yaml）なので、100mLで4割。
    const water = game.session.spawn(codex.objectNames.getId('water_liquid'));
    water.setNumber(codex.wellKnown.sizeId, 100, game.session);
    expect(water.moveToSlot(bowl, codex.slotNames.getId('content'), codex.wellKnown)).toBeUndefined();

    expect(fromGameSession(game, codex, locale).hand[0]?.fill, '色は中身の液体が宣言したもの').toEqual({
      ratio: 0.4,
      color: water.getNumber(codex.propertyNames.getId('color')),
    });

    water.destroy(codex.wellKnown);

    expect(
      fromGameSession(game, codex, locale).hand[0]?.fill,
      '飲み干して空へ戻ればバーも消える',
    ).toBeUndefined();
  });

  it('液体を入れられないカードは、中身のバーを持たない', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const basket = game.session.spawn(codex.objectNames.getId('woven_basket'));
    expect(
      basket.moveToSlot(game.player.instance, codex.slotNames.getId('hand'), codex.wellKnown),
    ).toBeUndefined();

    const [card] = fromGameSession(game, codex, locale).hand;
    expect(card?.contents, '固形物の入れ物なので中身は子ウィンドウで見せる').toBeDefined();
    expect(card?.fill, '量で満たされるものではないのでバーは出さない').toBeUndefined();
  });

  it('手持ちが6枠とも埋まっていると、アイテムのmoveは何も起こさない', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    // 同種はスタックにまとまり1枠しか使わないため、別種のアイテムで6枠を埋める。
    const handSlotId = codex.slotNames.getId('hand');
    for (const name of ['stone', 'branch', 'thick_branch', 'coconut', 'taro', 'water_spinach']) {
      const item = game.session.spawn(codex.objectNames.getId(name));
      expect(item.moveToSlot(game.player.instance, handSlotId, codex.wellKnown)).toBeUndefined();
    }
    exploreToFull(game);
    const items = [...game.startLocation.items];

    // 手持ちに同種が居るアイテムは、枠が埋まっていても既存のスタックへ合流できてしまう
    // （枠を数える単位は種類、SlotSystem.md 4節）。埋まっていることを確かめたいので、
    // 手持ちに無い種類のカードで試す。
    const held = new Set(game.player.hand.map((item) => item?.def.name));
    const view = fromGameSession(game, codex, locale);
    const newKind = view.items.find((card) => !held.has(card.objects[0].def.name));
    expect(newKind, '手持ちに無い種類のアイテムが落ちている土地で確かめる').toBeDefined();

    newKind?.moveTo?.('hand')?.();

    expect(game.startLocation.items, 'フィールドの中身は変わらない').toEqual(items);
  });

  it('カードの識別子は、そのカードが映しているインスタンスのID一式になる', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
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
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
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
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
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
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const view = fromGameSession(game, codex, locale);

    expect(withFrozenCards(view, undefined)).toBe(view);
  });

  it('怪我は取り出せず、何も入れられない', () => {
    // どちらもbound_to_owner（7.9節）の帰結——捻挫は身体から剥がせず、剥がせない以上プレイヤーが
    // 怪我を手に持つこともない。画面側は場所ごとの読み取り専用フラグを持たない。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    injure(game);

    const view = fromGameSession(game, codex, locale);

    expect(view.cardsIn('injuries')).toHaveLength(1);
    expect(view.cardsIn('injuries')[0].moveTo?.('hand'), '取り出せない').toBeUndefined();
    expect(view.cardsIn('injuries')[0].moveTo?.('items'), '捨てることもできない').toBeUndefined();
    expect(view.hand[0]?.moveTo?.('injuries'), '怪我は移動の宛先にならない').toBeUndefined();
    expect(view.acceptsCards('injuries'), '受け皿の空枠も出さない').toBe(false);
    expect(view.acceptsCards('equipment'), '装備は落とせる場所なので空枠を出す').toBe(true);
  });

  it('コンテナのカードは中身を映す場所を持ち、そこへ出し入れできる', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
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
    // 見出しはスロットの名前を持ち主込みで言ったもの。この対応表はどちらも未登録なので識別子のまま。
    expect(view.nameOf(opened!)).toBe(locale.slot('contents').displayNameWithOwner('woven_basket'));
    expect(view.acceptsCards(opened!)).toBe(true);
    expect(view.hand[1], '石は手持ちから無くなる').toBeUndefined();

    // 中身のカードは手持ちへ戻せる。
    view.cardsIn(opened!)[0].moveTo?.('hand')?.();
    expect(game.player.hand[1]).toBe(stone);
  });

  it('コンテナを自分自身の中へは入れられない', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const basket = game.session.spawn(codex.objectNames.getId('woven_basket'));
    expect(basket.moveToSlot(game.player.instance, codex.slotNames.getId('hand'), codex.wellKnown)).toBe(
      undefined,
    );

    const card = fromGameSession(game, codex, locale).hand[0];

    expect(card?.moveTo?.(card.contents!), '籠を籠自身の中へは入れられない').toBeUndefined();
  });

  it('combinationOfは、withタグが合うカード同士にだけ実行手段を返す', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
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
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
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
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
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
  coconut_meat:
    display_name: ヤシの果肉
    description: 殻から掻き出した白い果肉。
    actions:
      eat:
        display_name: 食べる
        description: そのまま口へ運ぶ。
`,
    );
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const meat = game.session.spawn(codex.objectNames.getId('coconut_meat'));
    expect(
      meat.moveToSlot(game.player.instance, codex.slotNames.getId('hand'), codex.wellKnown),
    ).toBeUndefined();
    // 満腹度は初期値が上限なので、食べた分が乗る余地を空けておく。
    const satietyId = codex.propertyNames.getId('satiety');
    game.player.instance.setNumber(satietyId, 0, game.session);

    const card = fromGameSession(game, codex, texts).hand[0];

    expect(card?.description).toBe('殻から掻き出した白い果肉。');
    expect(card?.actions).toMatchObject([{ name: '食べる', description: 'そのまま口へ運ぶ。' }]);

    card?.actions[0].execute();

    expect(game.player.instance.getNumber(satietyId), '食べた分だけ満腹度が上がる').toBeGreaterThan(0);
    expect(game.player.hand[0], '食べた果肉は無くなる').toBeUndefined();
  });

  it('アクションを持たないオブジェクトのカードは、アクションが空になる', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const thickBranch = game.session.spawn(codex.objectNames.getId('thick_branch'));
    expect(
      thickBranch.moveToSlot(game.player.instance, codex.slotNames.getId('hand'), codex.wellKnown),
    ).toBeUndefined();

    const card = fromGameSession(game, codex, locale).hand[0];

    expect(card?.actions).toEqual([]);
    expect(card?.description, 'localeに説明文が無ければundefined').toBeUndefined();
  });

  it('中身が代表するカード（液体容器）には、中身のアクションが並ぶ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
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

  it('中身が代表するカードの名前は、中身の名前を差し込んだものになる', () => {
    const texts = parseLocale(
      'ja.yaml',
      `object_texts:
  default:
    display_name_with_content: '{content}入りの{container}'
  canteen:
    display_name: 水筒
  water_liquid:
    display_name: 水
`,
    );
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const canteen = game.session.spawn(codex.objectNames.getId('canteen'));
    const handId = codex.slotNames.getId('hand');
    expect(canteen.moveToSlot(game.player.instance, handId, codex.wellKnown, true)).toBeUndefined();

    expect(fromGameSession(game, codex, texts).hand[0]?.name, '空なら入れ物の名前だけ').toBe('水筒');

    const water = game.session.spawn(codex.objectNames.getId('water_liquid'));
    water.setNumber(codex.propertyNames.getId('size'), 1000, game.session);
    expect(water.moveToSlot(canteen, codex.slotNames.getId('content'), codex.wellKnown)).toBeUndefined();

    expect(fromGameSession(game, codex, texts).hand[0]?.name).toBe('水入りの水筒');
  });

  it('アクションはかかる時間を持つ（durationを持たなければ0）', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);
    const path = pathsIn(game.startLocation, codex)[0];
    const meat = game.session.spawn(codex.objectNames.getId('coconut_meat'));
    expect(
      meat.moveToSlot(game.player.instance, codex.slotNames.getId('hand'), codex.wellKnown),
    ).toBeUndefined();

    const view = fromGameSession(game, codex, locale);

    // 道のtravelのdurationは、その道のtravel_minutesを引く（locations.yaml）。
    const travel = view.fixtures.find((card) => card.objects[0] === path)!.actions[0];
    expect(travel.minutes).toBe(new Path(path, codex.propertyNames).travelMinutes);
    expect(travel.minutes, '移動には時間がかかる').toBeGreaterThan(0);
    expect(view.hand[0]?.actions[0].minutes, 'eatはdurationを持たない').toBe(0);
  });

  it('combinationもかかる時間を持つ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
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
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);
    const path = new Path(pathsIn(game.startLocation, codex)[0], codex.propertyNames);

    const view = fromGameSession(game, codex, locale);
    const card = view.fixtures.find((fixture) => fixture.objects[0] === path.instance)!;
    card.actions.find((action) => action.name === 'travel')!.execute();

    expect(fromGameSession(game, codex, locale).currentLocation.name).toBe(
      locale.locationName(game.map.nameOfInstance(path.destinationInstanceId)!),
    );
  });

  it('ステータスエリアには、statusタグが付いたプロパティだけが実際の値で並ぶ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const statusTagId = codex.propertyTagNames.getId('status');
    const tagged = game.player.instance.readPropertiesWithTag(statusTagId);

    const view = fromGameSession(game, codex, locale);

    expect(view.statuses).toHaveLength(tagged.length);
    // 満腹度と水分は開始直後からバーに出るよう安全域のやや下（75%）、荷重と痛みは0、残りは満タンで始まる
    // （characters/・Characters.md 域の区分節）。
    const startRatios: Record<string, number> = { satiety: 0.75, hydration: 0.75, load: 0, pain: 0 };
    expect(view.statuses.map((status) => status.ratio)).toEqual(
      tagged.map((reading) => startRatios[reading.name] ?? 1),
    );
    const startAlerts: Record<string, string> = { satiety: 'watch', hydration: 'watch' };
    expect(view.statuses.map((status) => status.alert)).toEqual(
      tagged.map((reading) => startAlerts[reading.name] ?? 'safe'),
    );
    expect(view.statuses.map((status) => status.key)).toEqual(tagged.map((reading) => reading.name));
    // localeに登録の無いcharacterでは識別子がそのまま出る（Localization.md）。
    expect(view.statuses.map((status) => status.name)).toEqual(tagged.map((reading) => reading.name));
  });

  it('荷が重すぎると移動のアクションが押せなくなり、理由の文言が付く', () => {
    // ContainerSystem.md 5節: 危険域（too_heavy）に入ると道のtravelのconditionsが落ちる。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);
    const localeWithReason = parseLocale('ja.yaml', 'reason_texts:\n  too_heavy: 荷が重すぎて歩けない。\n');
    const pathTagId = codex.tagNames.getId('path');
    const travelOf = (view: ReturnType<typeof fromGameSession>) =>
      view.fixtures.find((card) => card.objects[0].def.tags.includes(pathTagId))!.actions[0];

    expect(travelOf(fromGameSession(game, codex, localeWithReason)).enabled, '空身なら歩ける').toBe(true);

    // 装備スロットへ石（1kgずつ）を積んで、どのキャラクタでも危険域へ届く重さにする。
    const equipmentId = codex.slotNames.getId('equipment');
    for (let i = 0; i < 40; i++)
      game.session
        .spawn(codex.objectNames.getId('stone'))
        .moveToSlot(game.player.instance, equipmentId, codex.wellKnown);
    expect(
      game.player.instance.getEffectiveValue(codex.propertyNames.getId('load')),
      '装備の重さがそのまま負荷になる',
    ).toBeGreaterThan(0);

    const travel = travelOf(fromGameSession(game, codex, localeWithReason));
    expect(travel.enabled).toBe(false);
    expect(travel.reason).toBe('荷が重すぎて歩けない。');

    travel.execute();
    expect(game.player.location?.instance.instanceId, '押しても移動しない').toBe(
      game.startLocation.instance.instanceId,
    );
  });

  it('ステータスの域は、値が減るとその区分に従って上がる', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const hydration = codex.propertyNames.getId('hydration');
    // 残り6時間未満（600mL未満）で致命的域（characters/）。
    game.player.instance.setNumber(hydration, 500, game.session);

    const view = fromGameSession(game, codex, locale);

    expect(view.statuses.find((status) => status.key === 'hydration')?.alert).toBe('fatal');
  });

  it('プロパティウィンドウのタブはproperty_tagsの宣言順で、中身のないタグは出ない', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
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
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));

    const view = fromGameSession(game, codex, locale);

    const shown = new Set(view.propertyCategories.flatMap((c) => c.entries.map((e) => e.name)));
    const inStatusArea = new Set(view.statuses.map((status) => status.name));
    // body_fatはnutritionタグだけを持つ（characters/）ため、ウィンドウにだけ現れる。
    expect(shown.has('body_fat')).toBe(true);
    expect(inStatusArea.has('body_fat')).toBe(false);
  });

  it('開始直後の地図は、現在地の土地だけを知っていて道は無い', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));

    const view = fromGameSession(game, codex, locale);

    expect(view.mapLands.map((land) => land.card.name)).toEqual([view.currentLocation.name]);
    expect(view.mapLands[0].site, 'サイトindexは現在地の土地を指す').toBe(
      game.map.siteInstanceIds.indexOf(game.startLocation.instance.instanceId),
    );
    expect(view.mapLands[0].current, '現在地のカードは強調表示の対象').toBe(true);
    expect(view.mapRoads).toEqual([]);
  });

  it('探索で道が見つかると、地図はその道と行き先の土地を知る', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);

    const view = fromGameSession(game, codex, locale);

    const currentSite = game.map.siteInstanceIds.indexOf(game.startLocation.instance.instanceId);
    const destinations = pathsIn(game.startLocation, codex).map((path) =>
      game.map.siteInstanceIds.indexOf(new Path(path, codex.propertyNames).destinationInstanceId),
    );
    expect(destinations.length, '道が見つかる土地で確かめる').toBeGreaterThan(0);

    expect(new Set(view.mapLands.map((land) => land.site)), '現在地と、見つかった道の行き先').toEqual(
      new Set([currentSite, ...destinations]),
    );
    expect(new Set(view.mapRoads.map((road) => `${road.a}/${road.b}`)), '道は両端で1本にまとまる').toEqual(
      new Set(
        destinations.map((site) =>
          site < currentSite ? `${site}/${currentSite}` : `${currentSite}/${site}`,
        ),
      ),
    );
    for (const road of view.mapRoads) {
      expect(
        view.mapLands.some((land) => land.site === road.a) &&
          view.mapLands.some((land) => land.site === road.b),
        '道の両端は必ず既知の土地',
      ).toBe(true);
    }
  });

  it('地図の土地カードは、その土地の名前と絵を持つ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);

    const view = fromGameSession(game, codex, locale);

    const root = game.startLocation.instance.findRoot();
    for (const land of view.mapLands) {
      const instanceId = game.map.siteInstanceIds[land.site];
      expect(land.card.name).toBe(locale.locationName(game.map.nameOfInstance(instanceId)!));
      expect(land.card.art, '絵は土地のobject_defの識別子で引く').toBe(
        root.findDescendantByInstanceId(instanceId)?.def.name,
      );
      expect(land.card.art).toBeDefined();
    }
  });

  it('移動しても、それまでに知った土地と道は地図に残る', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);
    const before = fromGameSession(game, codex, locale);
    const path = new Path(pathsIn(game.startLocation, codex)[0], codex.propertyNames);
    expect(path.travel(game.player.instance, game.session)).toBe(true);

    const view = fromGameSession(game, codex, locale);

    expect(new Set(view.mapLands.map((land) => land.site))).toEqual(
      new Set(before.mapLands.map((land) => land.site)),
    );
    expect(new Set(view.mapRoads.map((road) => `${road.a}/${road.b}`))).toEqual(
      new Set(before.mapRoads.map((road) => `${road.a}/${road.b}`)),
    );

    // 強調表示（current）は1枚だけで、移動に追従する。
    const currentSites = view.mapLands.filter((land) => land.current).map((land) => land.site);
    expect(currentSites).toEqual([game.map.siteInstanceIds.indexOf(path.destinationInstanceId)]);
  });

  it('現在地は移動に追従する', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);
    const path = new Path(pathsIn(game.startLocation, codex)[0], codex.propertyNames);
    expect(path.travel(game.player.instance, game.session)).toBe(true);

    const view = fromGameSession(game, codex, locale);

    expect(view.currentLocation.name).toBe(
      locale.locationName(game.map.nameOfInstance(path.destinationInstanceId)!),
    );
  });
});
