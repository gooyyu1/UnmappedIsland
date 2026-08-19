import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { NewGameSession } from '../../src/domain/generation/NewGame';
import { start as startNewGame } from '../../src/domain/generation/NewGame';
import type { WorldObject } from '../../src/domain/WorldObject';
import { Path } from '../../src/domain/views/Path';
import type { PlayScreenView } from '../../src/game/view/PlayScreenView';
import { fromGameSession, withFrozenCards } from '../../src/game/view/PlayScreenView';
import type { CardPlace, ScreenPlace } from '../../src/game/view/cardPlaces';
import { cardPlacesOf, samePlace } from '../../src/game/view/cardPlaces';
import type { CardGauge } from '../../src/game/ui/Card';
import { inProgressObjectName } from '../../src/loader/inProgressObjects';
import { characterIcon } from '../../src/game/view/characterCard';
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
    expect(injury.moveToSlot(game.player.instance, codex.slotNames.getId('injuries'))).toBeUndefined();
    return injury;
  }

  /** その区画のレーンに並んでいる札（空き枠を除いたもの）。 */
  function lane(view: PlayScreenView, game: NewGameSession, screen: ScreenPlace) {
    return view.cardsIn(place(game, screen)).filter((card) => card !== undefined);
  }

  /** 手持ちの枠の並び。**空き枠はundefinedのまま**——枠の位置がそのまま意味を持つ。 */
  function handCells(view: PlayScreenView, game: NewGameSession) {
    return view.cardsIn(place(game, 'hand'));
  }

  /**
   * 画面の区画（3つのレーン）が今映している場所。テストは区画を名前で書きたいので、その都度ビューと
   * 同じ解決を通す（cardPlaces）。
   */
  function place(game: NewGameSession, screen: ScreenPlace): CardPlace {
    return cardPlacesOf(game.player, game.player.location ?? game.startLocation)(screen);
  }

  /** キャラクタが外から見せているスロット（装備・怪我）の場所。 */
  function characterSlot(game: NewGameSession, slotName: string): CardPlace {
    return { container: game.player.instance, slotGlobalId: codex.slotNames.getId(slotName) };
  }

  /**
   * そのカードが出しているバーのうち、鍵が一致する1本（無ければundefined）。
   * プロパティのゲージは名前が鍵で、入れ物と中身から出るバーは`@`で始まる（PlayScreenView）。
   */
  function gaugeOf(card: { readonly gauges?: readonly CardGauge[] } | undefined, key: string) {
    return card?.gauges?.find((gauge) => gauge.key === key);
  }

  /** 開始地点にサル（animals.yaml）を1匹置き、そのインスタンスを返す。 */
  function placeMonkey(game: NewGameSession) {
    const monkey = game.session.spawn(codex.objectNames.getId('monkey'));
    expect(monkey.moveToSlot(game.startLocation.instance, codex.slotNames.getId('items'))).toBeUndefined();
    return monkey;
  }

  /** 現在地に炎を上げている焚き火を据え、その火の中へ生肉を1切れ入れる。 */
  function placeCookingHearth(game: NewGameSession) {
    const hearth = game.session.spawn(codex.objectNames.getId('campfire'));
    expect(hearth.moveToSlot(game.startLocation.instance, codex.slotNames.getId('fixtures'))).toBeUndefined();
    hearth.setNumber(codex.propertyNames.getId('fuel'), 20, game.session);
    // 炎の段（20〜）。火の中の物のcooking_progressが3/tickで進む（FireSystem.md 2.3節）。
    hearth.setNumber(codex.propertyNames.getId('heat'), 30, game.session);

    const meat = game.session.spawn(codex.objectNames.getId('raw_meat'));
    expect(meat.moveToSlot(hearth, codex.slotNames.getId('fire'))).toBeUndefined();
    return { hearth, meat };
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

    expect(view.currentLocationCard.name, '現在地は命名処理が付けた漂着地の名前').toBe(
      locale.locationName(game.map.nameOfInstance(game.startLocation.instance.instanceId)!),
    );
    expect(lane(view, game, 'fixtures'), '未探索なので設置物も道も見つかっていない').toEqual([]);
    expect(lane(view, game, 'items'), '未探索なので土地には何も落ちていない').toEqual([]);
    expect(view.elapsedDays).toBe(0);
    expect(view.hour * 60 + view.minute, '時計はランダムに決まった開始時刻をそのまま映す').toBe(
      game.world.hour * 60 + game.world.minute,
    );
  });

  it('天気は、worldの今の天気の識別子をそのまま映す', () => {
    // 雨の演出（ScreenLayout.md 7.5.3節）がこの識別子を読むため、表示文字列ではなく識別子で持つ。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const weatherId = codex.propertyNames.getId('weather');

    expect(fromGameSession(game, codex, locale).weather).toBe('clear');

    game.world.instance.setNumber(weatherId, codex.symbolNames.getId('storm'), game.session);

    expect(fromGameSession(game, codex, locale).weather).toBe('storm');
  });

  it('手持ちは固定6枠ぶん並び、空きセルはundefinedになる', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const stone = game.session.spawn(codex.objectNames.getId('stone'));
    expect(stone.moveToSlot(game.player.instance, codex.slotNames.getId('hand'))).toBeUndefined();

    const view = fromGameSession(game, codex, locale);

    expect(handCells(view, game)).toHaveLength(6);
    expect(handCells(view, game)[0], 'カード名は対応表から引いた表示文字列').toMatchObject({
      icon: '📦',
      name: '石',
    });
    expect(handCells(view, game).slice(1), '残りの枠は空きセルとして残る').toEqual([
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

    expect(lane(view, game, 'items').map((card) => card.name)).toEqual(
      location.itemStacks.map((stack) => locale.object(stack[0].def.name).displayName),
    );
    expect(lane(view, game, 'items').length, '探索し切れば何かしら見つかっている').toBeGreaterThan(0);

    // 設置物のレーンには道も並ぶ。道のカードだけは、道そのものではなく行き先の土地名を映す。
    const pathTagId = codex.tagNames.getId('path');
    expect(lane(view, game, 'fixtures').map((card) => card.name)).toEqual(
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
    const pathCardNames = lane(view, game, 'fixtures')
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
      lane(view, game, 'fixtures').filter((card) => card.objects[0].def.tags.includes(pathTagId) === isPath),
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

  it('製作中オブジェクトのカードは、完成品の絵を映す', () => {
    // 製作中の型はレシピから自動生成される（RecipeSystem.md）ので、その型あての絵は用意できない。
    // 完成品の絵を映せば、絵文字の代用に落ちずに「何が出来つつあるのか」が見える。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const wip = game.session.spawn(codex.objectNames.getId(inProgressObjectName('woven_basket', 'woven')));
    expect(wip.moveToSlot(game.startLocation.instance, codex.slotNames.getId('items'))).toBeUndefined();

    const card = lane(fromGameSession(game, codex, locale), game, 'items')[0];

    expect(card.art).toBe('woven_basket');
    expect(card.inProgress, '完成品と同じ絵なので、作りかけであることは覆いだけが示す').toBe(true);
  });

  it('場所について訊きたいことは、1つのまとまりで揃う', () => {
    // 見出し・記憶の鍵・枠の数・落とせるか・敷く絵・製作の材料は、どれも同じスロットの宣言から出る。
    // ばらばらに訊くと、場所を映す先を足すたびに訊く手順も増える（Windows.md 1節）。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const wip = game.session.spawn(codex.objectNames.getId(inProgressObjectName('woven_basket', 'woven')));
    expect(wip.moveToSlot(game.startLocation.instance, codex.slotNames.getId('items'))).toBeUndefined();

    const view = fromGameSession(game, codex, locale);
    const hand = view.slotViewOf(place(game, 'hand'));
    const injuries = view.slotViewOf(characterSlot(game, 'injuries'));
    const materials = view.slotViewOf({
      container: wip,
      slotGlobalId: codex.slotNames.getId('materials'),
    });

    expect(hand.key, 'タブの記憶の鍵はスロット名').toBe('hand');
    expect(hand.cellCount, '手持ちは枠の数が決まっている').toBeGreaterThan(0);
    expect(hand.acceptsCards).toBe(true);
    expect(hand.background, 'レーンに敷く絵はスロットで引く').toEqual({
      owner: view.characterCard.art,
      slot: 'hand',
    });
    expect(hand.materials, '製作中でなければ材料の枠は無い').toBeUndefined();

    expect(injuries.acceptsCards, '怪我は落とせる場所ではない').toBe(false);
    expect(materials.materials?.length, '製作中オブジェクトの材料は要求ごとに枠を持つ').toBeGreaterThan(0);
  });

  it('探索率は現在地の進捗を0〜1で表し、100%を超えない', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));

    expect(
      fromGameSession(game, codex, locale).currentLocationWindow.explorationRatio,
      '開始直後は未探索',
    ).toBe(0);

    exploreToFull(game);
    expect(
      fromGameSession(game, codex, locale).currentLocationWindow.explorationRatio,
      '探索し切れば100%',
    ).toBe(1);

    // 100%到達後も探索は続けられる（ExplorationSystem.md 2節）が、探索率は100%のまま。
    expect(game.player.explore(game.session)).toBe(true);
    expect(fromGameSession(game, codex, locale).currentLocationWindow.explorationRatio).toBe(1);
  });

  it('アイテムのmoveで手持ちへ移り、手持ちのmoveでフィールドへ戻る', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);
    const picked = game.startLocation.items[0];

    lane(fromGameSession(game, codex, locale), game, 'items')[0].moveTo?.(place(game, 'hand'))?.();

    expect(game.player.hand[0], '押したアイテムが手持ちの先頭の枠に入る').toBe(picked);
    expect(game.startLocation.items, 'フィールドからは無くなる').not.toContain(picked);

    handCells(fromGameSession(game, codex, locale), game)[0]?.moveTo?.(place(game, 'items'))?.();

    expect(game.player.hand[0], '手持ちの枠は空く').toBeUndefined();
    expect(game.startLocation.items, 'フィールドへ戻る').toContain(picked);
  });

  it('設置物のカードは移せないが、同じレーンの中でなら並び替えられる', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const tree = game.session.spawn(codex.objectNames.getId('palm_tree'));
    expect(tree.moveToSlot(game.startLocation.instance, codex.slotNames.getId('fixtures'))).toBeUndefined();

    const view = fromGameSession(game, codex, locale);

    expect(lane(view, game, 'items'), '設置物はアイテムのレーンには出ない').toEqual([]);
    // 持ち歩けないのは「設置物レーンが読み取り専用だから」ではなく、ヤシの木がitemタグを持たず
    // 手持ちのacceptsに掛からないから。itemも兼ねる設置物（持ち運べるかご）を足せば移せるようになる。
    expect(lane(view, game, 'fixtures')[0].moveTo?.(place(game, 'hand')), '手には持てない').toBeUndefined();
    expect(
      lane(view, game, 'fixtures')[0].moveTo?.(place(game, 'items')),
      '地面へも下ろせない',
    ).toBeUndefined();
    expect(
      lane(view, game, 'fixtures')[0].reorder,
      '並び方はプレイヤーが決めるので並び替えはできる',
    ).toBeTypeOf('function');
  });

  it('itemとfixtureを兼ねる物は、設置物レーンとアイテムレーンを行き来できる', () => {
    // 端の▲▼が出るかは「そこへ移せるか」で決まる（PlayScene.cardEdges）ので、両方のタグを持つ
    // 編み籠は設置物レーンで▼、アイテムレーンで▲を出す。画面側に場所ごとの決まりは無い。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const basket = game.session.spawn(codex.objectNames.getId('woven_basket'));
    expect(basket.moveToSlot(game.startLocation.instance, codex.slotNames.getId('items'))).toBeUndefined();

    lane(fromGameSession(game, codex, locale), game, 'items')[0].moveTo?.(place(game, 'fixtures'))?.();

    const placed = fromGameSession(game, codex, locale);
    expect(
      lane(placed, game, 'fixtures').map((card) => card.name),
      '地面に据わる',
    ).toEqual([lane(placed, game, 'fixtures')[0].name]);
    expect(lane(placed, game, 'items'), 'アイテムレーンからは消える').toEqual([]);

    lane(placed, game, 'fixtures')[0].moveTo?.(place(game, 'items'))?.();

    const lifted = fromGameSession(game, codex, locale);
    expect(lane(lifted, game, 'fixtures'), '据えたものを拾い直せる').toEqual([]);
    expect(lane(lifted, game, 'items')).toHaveLength(1);
    expect(lane(lifted, game, 'items')[0].moveTo?.(place(game, 'hand')), 'そのまま手にも持てる').toBeTypeOf(
      'function',
    );
  });

  it('カードは、自分が今在るスロットを地の引き先として持つ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const tree = game.session.spawn(codex.objectNames.getId('palm_tree'));
    expect(tree.moveToSlot(game.startLocation.instance, codex.slotNames.getId('fixtures'))).toBeUndefined();
    const coconut = game.session.spawn(codex.objectNames.getId('coconut'));
    expect(coconut.moveToSlot(game.player.instance, game.player.handSlotId)).toBeUndefined();
    exploreToFull(game);

    const view = fromGameSession(game, codex, locale);
    const land = view.currentLocationCard.art;

    expect(
      lane(view, game, 'fixtures').map((card) => card.background),
      '道も含め、このレーンのカードはすべて土地のfixturesに在る',
    ).toEqual(lane(view, game, 'fixtures').map(() => ({ owner: land, slot: 'fixtures' })));
    expect(
      lane(view, game, 'items').map((card) => card.background),
      '同じ土地でもスロットが違えば別の地を引く（絵が在るかはファイル側の話）',
    ).toEqual(lane(view, game, 'items').map(() => ({ owner: land, slot: 'items' })));
    expect(handCells(view, game).find((card) => card !== undefined)?.background).toEqual({
      owner: view.characterCard.art,
      slot: 'hand',
    });
  });

  it('レーンが映しているスロットを答える', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const view = fromGameSession(game, codex, locale);

    expect(view.slotViewOf(place(game, 'fixtures')).background).toEqual({
      owner: view.currentLocationCard.art,
      slot: 'fixtures',
    });
    expect(view.slotViewOf(place(game, 'hand')).background).toEqual({
      owner: view.characterCard.art,
      slot: 'hand',
    });
  });

  it('現在地のカードは、その土地の絵を持つ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));

    const view = fromGameSession(game, codex, locale);

    expect(view.currentLocationCard.art, '土地そのものもobject_defなので、絵は識別子で引ける').toBe(
      game.startLocation.instance.def.name,
    );
  });

  it('gaugeタグの付いたプロパティを持つカードだけが、その残りの割合を持つ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const handSlotId = codex.slotNames.getId('hand');
    const durabilityId = codex.propertyNames.getId('durability');
    const sharpStone = game.session.spawn(codex.objectNames.getId('sharp_stone'));
    const stone = game.session.spawn(codex.objectNames.getId('stone'));
    for (const item of [sharpStone, stone]) {
      expect(item.moveToSlot(game.player.instance, handSlotId)).toBeUndefined();
    }

    expect(
      gaugeOf(handCells(fromGameSession(game, codex, locale), game)[0], 'durability'),
      '作りたては満タン',
    ).toEqual({
      key: 'durability',
      ratio: 1,
      atMin: 'bad',
      atMax: 'good',
      worsensUpward: false,
    });
    expect(
      gaugeOf(handCells(fromGameSession(game, codex, locale), game)[1], 'durability'),
      '石は耐久度を持たない',
    ).toBeUndefined();

    sharpStone.addNumber(durabilityId, -sharpStone.getNumber(durabilityId) / 4, game.session);

    expect(
      gaugeOf(handCells(fromGameSession(game, codex, locale), game)[0], 'durability')?.ratio,
      '減った分だけ割合が下がる',
    ).toBe(0.75);
  });

  it('竈は残っている薪の割合を値バーとして持つ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const fuelId = codex.propertyNames.getId('fuel');
    const campfire = game.session.spawn(codex.objectNames.getId('campfire'));
    expect(
      campfire.moveToSlot(game.startLocation.instance, codex.slotNames.getId('fixtures')),
    ).toBeUndefined();

    expect(
      gaugeOf(lane(fromGameSession(game, codex, locale), game, 'fixtures')[0], 'fuel')?.ratio,
      '薪が無ければ0',
    ).toBe(0);

    campfire.setNumber(fuelId, campfire.getNumber(fuelId) + 15, game.session);

    expect(
      gaugeOf(lane(fromGameSession(game, codex, locale), game, 'fixtures')[0], 'fuel')?.ratio,
      'くべた分だけ割合が上がる',
    ).toBeCloseTo(0.5, 2);
  });

  it('怪我のカードのゲージは、耐久度とは両端が逆になる（減るほど良い）', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const injury = injure(game);

    expect(
      gaugeOf(fromGameSession(game, codex, locale).cardsIn(characterSlot(game, 'injuries'))[0]!, 'severity'),
    ).toEqual({
      key: 'severity',
      ratio: 1,
      // 残っている傷は増えるほど悪いので、耐久度（min: bad）と両端が入れ替わる。
      atMin: 'good',
      atMax: 'bad',
      worsensUpward: true,
    });

    const severityId = codex.propertyNames.getId('severity');
    injury.addNumber(severityId, -injury.getNumber(severityId) / 2, game.session);

    const healing = gaugeOf(
      fromGameSession(game, codex, locale).cardsIn(characterSlot(game, 'injuries'))[0]!,
      'severity',
    );
    // 傷の下限は0ではなく1（injuries.yaml）なので、割合はぴったり半分にはならない。
    expect(healing?.ratio, '半分治れば半分まで縮む').toBeCloseTo(0.5, 2);
  });

  it('動物のカードは、今の意識をゲージとして持つ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const monkey = placeMonkey(game);
    const consciousnessId = codex.propertyNames.getId('consciousness');

    const fresh = gaugeOf(
      fromGameSession(game, codex, locale).cardsIn(place(game, 'items'))[0]!,
      'consciousness',
    );
    expect(fresh, '起きていれば意識は満タン').toEqual({
      key: 'consciousness',
      ratio: 1,
      atMin: 'bad',
      atMax: 'good',
      worsensUpward: false,
    });

    monkey.setNumber(consciousnessId, 10, game.session);

    const reduced = gaugeOf(
      fromGameSession(game, codex, locale).cardsIn(place(game, 'items'))[0]!,
      'consciousness',
    );
    expect(reduced?.ratio, '削られた分だけ割合が下がる').toBe(0.1);
  });

  it('動物のカードは、アイテムではなく動物として枠の色が決まる', () => {
    // 動物はitemも兼ねるので、種別を決める順序が効いている（CardView.md 2節 枠の色は種別で変える）。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    placeMonkey(game);

    expect(fromGameSession(game, codex, locale).cardsIn(place(game, 'items'))[0]!.kind).toBe('animal');
  });

  it('警戒している動物のカードだけが、輪郭を明滅させる域を持つ', () => {
    // 安全域を外れている間だけ明滅する（CardView.md 3節 警戒している動物は輪郭を明滅させる）。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const monkey = placeMonkey(game);
    const warinessId = codex.propertyNames.getId('wariness');

    expect(
      fromGameSession(game, codex, locale).cardsIn(place(game, 'items'))[0]!.alert,
      '現れた時点で警戒している',
    ).toBe('caution');

    monkey.setNumber(warinessId, 0, game.session);

    expect(
      fromGameSession(game, codex, locale).cardsIn(place(game, 'items'))[0]!.alert,
      '落ち着けば明滅しない',
    ).toBe('safe');
  });

  it('警戒を持たないカードは、明滅させる域を持たない', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const stone = game.session.spawn(codex.objectNames.getId('stone'));
    expect(stone.moveToSlot(game.startLocation.instance, codex.slotNames.getId('items'))).toBeUndefined();

    expect(fromGameSession(game, codex, locale).cardsIn(place(game, 'items'))[0]!.alert).toBeUndefined();
  });

  it('治療具を当てた怪我のカードだけが、手当て済みの印を持つ', () => {
    // 手当ての有無で絵は差し替えない（CardView.md 9節 カードの印）。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const injury = injure(game);

    expect(
      fromGameSession(game, codex, locale).cardsIn(characterSlot(game, 'injuries'))[0]!.mark,
    ).toBeUndefined();

    const bandage = game.session.spawn(codex.objectNames.getId('bandage'));
    expect(bandage.moveToSlot(injury, codex.slotNames.getId('treatment'))).toBeUndefined();

    expect(fromGameSession(game, codex, locale).cardsIn(characterSlot(game, 'injuries'))[0]!.mark).toBe('🩹');
  });

  it('血が流れている傷は、手当て済みより先に出血の印を出す', () => {
    // 当ててあってもまだ流れているなら、伝えるべきは「当ててある」ではなく「止まっていない」
    // （VitalsSystem.md 9節）。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const wound = game.session.spawn(codex.objectNames.getId('laceration'));
    expect(wound.moveToSlot(game.player.instance, codex.slotNames.getId('injuries'))).toBeUndefined();
    const bandage = game.session.spawn(codex.objectNames.getId('bandage'));
    expect(bandage.moveToSlot(wound, codex.slotNames.getId('treatment'))).toBeUndefined();

    expect(fromGameSession(game, codex, locale).cardsIn(characterSlot(game, 'injuries'))[0]!.mark).toBe('🩸');

    wound.setNumber(codex.propertyNames.getId('bleeding'), 0, game.session);

    expect(
      fromGameSession(game, codex, locale).cardsIn(characterSlot(game, 'injuries'))[0]!.mark,
      '固まれば手当て済みの印へ戻る',
    ).toBe('🩹');
  });

  it('出血の印は、負っている本人のポートレイトにも出る', () => {
    // 傷のカードは開かないと見えないので、そこだけに出していると流し見のあいだに失血が進む
    // （VitalsSystem.md 9節）。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    expect(fromGameSession(game, codex, locale).characterCard.mark, '無傷なら何も出ない').toBeUndefined();

    const wound = game.session.spawn(codex.objectNames.getId('laceration'));
    expect(wound.moveToSlot(game.player.instance, codex.slotNames.getId('injuries'))).toBeUndefined();

    expect(fromGameSession(game, codex, locale).characterCard.mark).toBe('🩸');

    wound.setNumber(codex.propertyNames.getId('bleeding'), 0, game.session);

    expect(fromGameSession(game, codex, locale).characterCard.mark, '止まれば消える').toBeUndefined();
  });

  it('血が流れている傷を負った動物は、そのカードに出血の印を出す', () => {
    // 傷は動物のinjuriesスロットの中なので、レーンに並ぶ1枚を見ているだけでは分からない。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const monkey = placeMonkey(game);
    expect(
      fromGameSession(game, codex, locale).cardsIn(place(game, 'items'))[0]!.mark,
      '無傷なら何も出ない',
    ).toBeUndefined();

    const wound = game.session.spawn(codex.objectNames.getId('laceration'));
    expect(wound.moveToSlot(monkey, codex.slotNames.getId('injuries'))).toBeUndefined();

    expect(fromGameSession(game, codex, locale).cardsIn(place(game, 'items'))[0]!.mark).toBe('🩸');
  });

  it('火にかけた物のカードは、変わるまでの残り時間と進み具合を出す', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const { hearth } = placeCookingHearth(game);

    // 24 ÷ 3 = 8tickでmaxちょうどに乗り、溢れる（`> max`）のはその次のtick → 9tick × 15分。
    expect(
      fromGameSession(game, codex, locale).cardsIn({
        container: hearth,
        slotGlobalId: codex.slotNames.getId('fire'),
      })[0]!.cooking,
    ).toEqual({
      ratio: 0,
      minutes: 135,
    });
  });

  it('火から出した物のカードには、加熱の覆いが出ない', () => {
    // 出すかどうかは場所ではなく「今その値が進んでいるか」で決まる（CardView.md 15節）。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const { meat } = placeCookingHearth(game);
    expect(meat.moveToSlot(game.startLocation.instance, codex.slotNames.getId('items'))).toBeUndefined();

    expect(lane(fromGameSession(game, codex, locale), game, 'items')[0].cooking).toBeUndefined();
  });

  it('火が消えれば、火にかけたままの物からも覆いが消える', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const { hearth } = placeCookingHearth(game);

    hearth.setNumber(codex.propertyNames.getId('heat'), 0, game.session);

    expect(
      fromGameSession(game, codex, locale).cardsIn({
        container: hearth,
        slotGlobalId: codex.slotNames.getId('fire'),
      })[0]!.cooking,
    ).toBeUndefined();
  });

  it('炉のカードは、中で一番早く変わるものの残り時間を上げる', () => {
    // 火にかけた物は炉を開くまで見えないので、開かずに焦げへ気付けるようにする（CardView.md 15節）。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const { hearth } = placeCookingHearth(game);
    const rat = game.session.spawn(codex.objectNames.getId('rat_carcass'));
    expect(rat.moveToSlot(hearth, codex.slotNames.getId('fire'))).toBeUndefined();

    const card = lane(fromGameSession(game, codex, locale), game, 'fixtures').find(
      (c) => c.objects[0] === hearth,
    );

    // ネズミは6 ÷ 3 = 2tick＋1で45分。生肉の135分より先に変わるので、こちらが上がる。
    expect(card?.cooking?.minutes).toBe(45);
  });

  it('手当て済みの印は、負っている本人までは上がらない', () => {
    // 上げるのは出血だけ。手当て済みは「もう手を打った」を言うもので、急がせる必要がない。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const injury = injure(game);
    const bandage = game.session.spawn(codex.objectNames.getId('bandage'));
    expect(bandage.moveToSlot(injury, codex.slotNames.getId('treatment'))).toBeUndefined();

    expect(fromGameSession(game, codex, locale).characterCard.mark).toBeUndefined();
  });

  it('中身を持つカードは、それを映す場所と、空けておく枠の数の元になる容量を持つ', () => {
    // 中身を見せるかはタグではなくスロットで決める（Windows.md 1節 子ウィンドウ）。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const injury = injure(game);
    const handSlot = codex.slotNames.getId('hand');
    const basket = game.session.spawn(codex.objectNames.getId('woven_basket'));
    const bandage = game.session.spawn(codex.objectNames.getId('bandage'));
    expect(basket.moveToSlot(game.player.instance, handSlot)).toBeUndefined();
    expect(bandage.moveToSlot(game.player.instance, handSlot)).toBeUndefined();

    const view = fromGameSession(game, codex, locale);
    const injuryCard = view.cardsIn(characterSlot(game, 'injuries'))[0]!;
    const basketCard = handCells(view, game).find((card) => card?.objects[0] === basket)!;
    const bandageCard = handCells(view, game).find((card) => card?.objects[0] === bandage)!;

    const treatment = { container: injury, slotGlobalId: codex.slotNames.getId('treatment') };
    expect(injuryCard.visibleSlots, '治療具のタブが出る').toEqual([treatment]);
    expect(view.slotViewOf(treatment).cellCount, '治療具の枠は1つだけ').toBe(1);
    // 行き先は重ねる物で変わる。怪我が受け取るのは治療具だけで、かごは受け取らない。
    expect(injuryCard.contentsFor(bandageCard), '包帯は治療具のスロットへ入る').toEqual(treatment);
    expect(injuryCard.contentsFor(basketCard), 'かごは怪我に入らない').toBeUndefined();

    const contents = { container: basket, slotGlobalId: codex.slotNames.getId('contents') };
    expect(basketCard.visibleSlots, '中身のタブが出る').toEqual([contents]);
    expect(view.slotViewOf(contents).cellCount, 'かごは10枠（Containers.md 1節）').toBe(10);
    expect(basketCard.contentsFor(bandageCard), 'かごは持ち物を受け取る').toEqual(contents);
  });

  it('キャラクタと土地の札も、他の札と同じ道で作る', () => {
    // どちらもWorldObjectで、種別は物の型が名乗るタグ（character / location、core.yaml）から決まる。
    // 札の作り方を対象ごとに分けると、印・バー・個体の識別子といった規約がそこにだけ届かなくなる。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const view = fromGameSession(game, codex, locale);

    expect(view.characterCard.kind).toBe('character');
    expect(view.characterCard.icon, 'キャラクタは型ごとの代役アイコンを持つ').toBe(
      characterIcon(SAMPLE_CHARACTER),
    );
    expect(view.characterCard.identity, '貸し出した札が帰る先の鍵').toEqual([
      game.player.instance.instanceId,
    ]);

    expect(view.currentLocationCard.kind).toBe('location');
    expect(view.currentLocationCard.identity).toEqual([game.startLocation.instance.instanceId]);
    expect(view.currentLocationCard.name, '個体に付いた名前は型の名前より優先される').toBe(
      locale.locationName(game.map.nameOfInstance(game.startLocation.instance.instanceId)!),
    );
  });

  it('子ウィンドウは、映す対象のオブジェクト1つから作る', () => {
    // 窓が映すのは1個ぶんなので、束かどうかもどの枠に居るかも要らない。キャラクタ・現在地は
    // 画面から名前で開く入口で、答えは同じ経路（windowOf）から来る。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const stone = game.session.spawn(codex.objectNames.getId('stone'));
    expect(stone.moveToSlot(game.player.instance, codex.slotNames.getId('hand'))).toBeUndefined();

    const view = fromGameSession(game, codex, locale);

    expect(view.characterWindow.card, 'ポートレイトと同じ1枚').toBe(view.characterCard);
    expect(view.currentLocationWindow.card).toBe(view.currentLocationCard);
    expect(view.windowOf(game.startLocation.instance).explorationRatio, '土地は探索できる').toBe(0);
    expect(view.windowOf(stone).explorationRatio, '石は探索できない').toBeUndefined();
    expect(view.windowOf(stone).card.name, '押した札が映す物の姿を出す').toBe(handCells(view, game)[0]?.name);
  });

  it('プロパティの詳細は、その値を持つ物から読む', () => {
    // 同じ名前のプロパティを複数の型が持つことはある。詳細に出る影響の出入りは、プロパティの名前では
    // なく持ち主で決まる（Windows.md 6節）。
    const loader = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR);
    loader.load(
      'test.yaml',
      [
        'object_defs:',
        '  test_charm:',
        '    tags: [item]',
        '    props:',
        '      weight: {value: 10}',
        '      volume: {value: 10}',
        '      satiety:',
        '        tags: [status]',
        '        value: 10',
        '        range: {min: 0, max: 100}',
        '',
      ].join('\n'),
    );
    const withCharm = loader.build();
    const game = startNewGame(withCharm, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const charm = game.session.spawn(withCharm.objectNames.getId('test_charm'));
    expect(charm.moveToSlot(game.player.instance, withCharm.slotNames.getId('hand'))).toBeUndefined();

    const view = fromGameSession(game, withCharm, locale);
    const card = handCells(view, game).find((held) => held?.objects[0] === charm);
    const charmSatiety = view
      .windowOf(card!.objects[0])
      .properties.flatMap((tab) => tab.entries)
      .find((entry) => entry.key === 'satiety');
    const characterSatiety = view.characterWindow.properties
      .flatMap((tab) => tab.entries)
      .find((entry) => entry.key === 'satiety');

    expect(charmSatiety?.value, 'お守り自身の値が出る').toBe(10);
    expect(charmSatiety?.detail?.received, 'お守りは何の影響も受けていない').toEqual([]);
    expect(characterSatiety?.detail?.received.length, 'キャラクタの満腹度は影響を受けている').toBeGreaterThan(
      0,
    );
  });

  it('子ウィンドウに要るものは、対象ごとに1つのまとまりで答える', () => {
    // 呼び出し側（PlayScene）がばらばらのメンバーから組み立てると、窓を足すたびに組み立ての手順も
    // 増える。1つの窓に要るものは1つの問い合わせで揃う（Windows.md 1節）。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const basket = game.session.spawn(codex.objectNames.getId('woven_basket'));
    expect(basket.moveToSlot(game.player.instance, codex.slotNames.getId('hand'))).toBeUndefined();

    const view = fromGameSession(game, codex, locale);
    const basketWindow = view.windowOf(basket);

    expect(basketWindow.card.name, 'その札そのものを出す').toBe(handCells(view, game)[0]?.name);
    expect(basketWindow.slots, 'かごは中身のタブを持つ').toHaveLength(1);
    expect(basketWindow.properties, 'タグの付いたプロパティを持たないのでタブが出ない').toEqual([]);
    expect(basketWindow.explorationRatio, '探索できるのは場所だけ').toBeUndefined();

    expect(view.characterWindow.properties.length, 'キャラクタはプロパティのタブを持つ').toBeGreaterThan(0);
    expect(
      view.characterWindow.slots.map((slot) => view.slotViewOf(slot).key),
      '外から見えるのは装備と怪我だけ（手持ちはレーンに出ている）',
    ).toEqual(['equipment', 'injuries']);
    expect(view.currentLocationWindow.explorationRatio, '土地は探索のタブを持つ').toBe(0);
    expect(view.currentLocationWindow.actions.map((action) => action.key)).toContain('explore');
  });

  it('液体の容器は中身を開かない（水を単独で取り出させない）', () => {
    // 見せるスロットはワールド側が名乗る（show_contents、GameElementDefinition.md 7.8節）。
    // 液体の容器のcontentは名乗っていないので、押しても説明とアクションだけが出る。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const bowl = game.session.spawn(codex.objectNames.getId('coconut_bowl'));
    const water = game.session.spawn(codex.objectNames.getId('water_liquid'));
    expect(bowl.moveToSlot(game.player.instance, codex.slotNames.getId('hand'))).toBeUndefined();
    expect(water.moveToSlot(bowl, codex.slotNames.getId('content'))).toBeUndefined();

    const card = handCells(fromGameSession(game, codex, locale), game).find(
      (held) => held?.objects[0] === bowl,
    )!;

    expect(card.visibleSlots, '中身の並びは開かない').toEqual([]);
    expect(gaugeOf(card, '@fill')?.ratio, '入っていることはバーで見せる').toBeGreaterThan(0);
  });

  it('液体容器のカードは、中身が入っている間だけ、その割合と液体の色を持つ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const bowl = game.session.spawn(codex.objectNames.getId('coconut_bowl'));
    expect(bowl.moveToSlot(game.player.instance, codex.slotNames.getId('hand'))).toBeUndefined();

    expect(
      gaugeOf(handCells(fromGameSession(game, codex, locale), game)[0], '@fill'),
      '空の容器は映す中身がいないのでバーを出さない',
    ).toBeUndefined();

    // ヤシの器の容量は250mL（liquid_containers.yaml）なので、100mLで4割。
    const water = game.session.spawn(codex.objectNames.getId('water_liquid'));
    water.setNumber(codex.wellKnown.volumeId, 100, game.session);
    expect(water.moveToSlot(bowl, codex.slotNames.getId('content'))).toBeUndefined();

    expect(
      gaugeOf(handCells(fromGameSession(game, codex, locale), game)[0], '@fill'),
      '色は中身の液体が宣言したもの',
    ).toEqual({
      key: '@fill',
      ratio: 0.4,
      color: water.getNumber(codex.propertyNames.getId('color')),
      // 良し悪しではなく中身そのものの色を映すバーなので、両端は色を決めない。
      atMin: 'neutral',
      atMax: 'neutral',
      worsensUpward: false,
    });

    water.destroy();

    expect(
      gaugeOf(handCells(fromGameSession(game, codex, locale), game)[0], '@fill'),
      '飲み干して空へ戻ればバーも消える',
    ).toBeUndefined();
  });

  it('液体を入れられないカードは、中身のバーを持たない', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const basket = game.session.spawn(codex.objectNames.getId('woven_basket'));
    expect(basket.moveToSlot(game.player.instance, codex.slotNames.getId('hand'))).toBeUndefined();

    const [card] = handCells(fromGameSession(game, codex, locale), game);
    expect(card?.visibleSlots, '固形物の入れ物なので中身は子ウィンドウで見せる').toHaveLength(1);
    expect(gaugeOf(card, '@fill'), '量で満たされるものではないのでバーは出さない').toBeUndefined();
  });

  it('上限を持つ入れ物のカードだけが、容量の詰まり具合を持つ', () => {
    // 割合が上限（capacity）とかさ（volume）から出ていることは、tests/domain/containerCapacity.test.ts
    // が受け持つ。ここで見るのは「どのカードがそれを出すか」だけ。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const handSlotId = codex.slotNames.getId('hand');
    const basket = game.session.spawn(codex.objectNames.getId('woven_basket'));
    const stone = game.session.spawn(codex.objectNames.getId('stone'));
    expect(basket.moveToSlot(game.player.instance, handSlotId)).toBeUndefined();
    expect(stone.moveToSlot(game.player.instance, handSlotId)).toBeUndefined();

    const view = fromGameSession(game, codex, locale);

    expect(
      gaugeOf(
        handCells(view, game).find((card) => card?.objects[0] === basket),
        '@capacity',
      ),
      '編み籠のcontentsは容量を宣言している（containers.yaml）',
    ).toEqual({
      key: '@capacity',
      ratio: 0,
      // 満杯へ近づくほど物が入らなくなるので、空いている側がgood。
      atMin: 'good',
      atMax: 'bad',
      worsensUpward: true,
    });
    expect(
      gaugeOf(
        handCells(view, game).find((card) => card?.objects[0] === stone),
        '@capacity',
      ),
      '中身を持たない物に詰まり具合は無い',
    ).toBeUndefined();
  });

  it('液体の容器は、詰まり具合ではなく中身のバーを出す', () => {
    // 上限は同じcapacityでも、量を持つのは中身の液体自身なので、映すのは中身の色のバー1本だけ。
    // 2本出ると同じ位置に重なる。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const bowl = game.session.spawn(codex.objectNames.getId('coconut_bowl'));
    const water = game.session.spawn(codex.objectNames.getId('water_liquid'));
    expect(bowl.moveToSlot(game.player.instance, codex.slotNames.getId('hand'))).toBeUndefined();
    expect(water.moveToSlot(bowl, codex.slotNames.getId('content'))).toBeUndefined();

    const [card] = handCells(fromGameSession(game, codex, locale), game);

    expect(gaugeOf(card, '@capacity')).toBeUndefined();
    expect(gaugeOf(card, '@fill')?.ratio, '入っていることは中身のバーが見せる').toBeGreaterThan(0);
  });

  it('手持ちが6枠とも埋まっていると、アイテムのmoveは何も起こさない', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    // 同種はスタックにまとまり1枠しか使わないため、別種のアイテムで6枠を埋める。
    const handSlotId = codex.slotNames.getId('hand');
    for (const name of ['stone', 'twig', 'thick_branch', 'coconut', 'taro', 'water_spinach']) {
      const item = game.session.spawn(codex.objectNames.getId(name));
      expect(item.moveToSlot(game.player.instance, handSlotId)).toBeUndefined();
    }
    exploreToFull(game);
    const items = [...game.startLocation.items];

    // 手持ちに同種が居るアイテムは、枠が埋まっていても既存のスタックへ合流できてしまう
    // （枠を数える単位は種類、SlotSystem.md 4節）。埋まっていることを確かめたいので、
    // 手持ちに無い種類のカードで試す。
    const held = new Set(game.player.hand.map((item) => item?.def.name));
    const view = fromGameSession(game, codex, locale);
    const newKind = lane(view, game, 'items').find((card) => !held.has(card.objects[0].def.name));
    expect(newKind, '手持ちに無い種類のアイテムが落ちている土地で確かめる').toBeDefined();

    newKind?.moveTo?.(place(game, 'hand'))?.();

    expect(game.startLocation.items, 'フィールドの中身は変わらない').toEqual(items);
  });

  it('カードの識別子は、そのカードが映しているインスタンスのID一式になる', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const handSlotId = codex.slotNames.getId('hand');
    const stones = [0, 1].map(() => game.session.spawn(codex.objectNames.getId('stone')));
    for (const stone of stones) {
      expect(stone.moveToSlot(game.player.instance, handSlotId)).toBeUndefined();
    }
    exploreToFull(game);

    const view = fromGameSession(game, codex, locale);

    expect(handCells(view, game)[0]?.identity, '同種2個は1枚のカードなので、両方のIDを持つ').toEqual(
      stones.map((stone) => stone.instanceId),
    );
    expect(handCells(view, game)[0]?.count, 'スタック数はそのままインスタンスの個数').toBe(2);
    expect(
      lane(view, game, 'items').map((card) => card.identity),
      'フィールドも同種はスタックにまとまって1枚',
    ).toEqual(game.startLocation.itemStacks.map((stack) => stack.map((item) => item.instanceId)));
  });

  it('手持ちのカードは装備へ移せる（装備固有の経路ではなく、場所を指すだけ）', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const stone = game.session.spawn(codex.objectNames.getId('stone'));
    expect(stone.moveToSlot(game.player.instance, codex.slotNames.getId('hand'))).toBeUndefined();

    handCells(fromGameSession(game, codex, locale), game)[0]?.moveTo?.(characterSlot(game, 'equipment'))?.();

    expect(game.player.hand[0], '手持ちからは無くなる').toBeUndefined();
    expect(
      game.player.equipmentStacks.map((stack) => stack[0]),
      '装備スロットへ入る',
    ).toEqual([stone]);

    const view = fromGameSession(game, codex, locale);
    expect(
      samePlace(view.cardsIn(characterSlot(game, 'equipment'))[0]!.place, characterSlot(game, 'equipment')),
    ).toBe(true);

    view.cardsIn(characterSlot(game, 'equipment'))[0]!.moveTo?.(place(game, 'hand'))?.();
    expect(game.player.hand[0], '手持ちへ戻せる').toBe(stone);
  });

  it('withFrozenCardsは、控えた時点の中身を返し続ける', () => {
    // 時間経過の再現（PlayScene）では、控えておいたviewをあとから表示する。cardsInだけは呼んだ時点の
    // 生きたワールドを読むため、固定しないとその部分に限って「今」の状態が出てしまう。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const stone = game.session.spawn(codex.objectNames.getId('stone'));
    const equipment = codex.slotNames.getId('equipment');
    expect(stone.moveToSlot(game.player.instance, equipment)).toBeUndefined();

    const live = fromGameSession(game, codex, locale);
    const frozen = withFrozenCards(live, characterSlot(game, 'equipment'));

    // 控えたあとでワールドが変わる（装備が外れる）。
    expect(stone.moveToSlot(game.player.instance, codex.slotNames.getId('hand'))).toBeUndefined();

    expect(
      frozen.cardsIn(characterSlot(game, 'equipment')).map((card) => card?.objects[0]),
      '固定した場所は控えた時点のまま',
    ).toEqual([stone]);
    expect(live.cardsIn(characterSlot(game, 'equipment')), '固定していないviewは今のワールドを読む').toEqual(
      [],
    );
    expect(frozen.cardsIn(characterSlot(game, 'injuries')), '固定していない場所は今のワールドを読む').toEqual(
      [],
    );
    expect(frozen.characterCard, 'cardsIn以外は元のviewのまま').toBe(live.characterCard);
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

    expect(view.cardsIn(characterSlot(game, 'injuries'))).toHaveLength(1);
    expect(
      view.cardsIn(characterSlot(game, 'injuries'))[0]!.moveTo?.(place(game, 'hand')),
      '取り出せない',
    ).toBeUndefined();
    expect(
      view.cardsIn(characterSlot(game, 'injuries'))[0]!.moveTo?.(place(game, 'items')),
      '捨てることもできない',
    ).toBeUndefined();
    expect(
      handCells(view, game)[0]?.moveTo?.(characterSlot(game, 'injuries')),
      '怪我は移動の宛先にならない',
    ).toBeUndefined();
    expect(view.slotViewOf(characterSlot(game, 'injuries')).acceptsCards, '受け皿の空枠も出さない').toBe(
      false,
    );
    expect(
      view.slotViewOf(characterSlot(game, 'equipment')).acceptsCards,
      '装備は落とせる場所なので空枠を出す',
    ).toBe(true);
  });

  it('枠数の決まったスロットは、抜けた枠を詰めずに答える', () => {
    // 世界は枠の位置を保つ（SlotSystem.md 3節）ので、画面もそこを動かさない。詰めて答えると、
    // 落とした枠と札が出る枠が食い違う（空き枠へ落とすと moveToSlotAtCell が枠の番号で入れる）。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const basket = game.session.spawn(codex.objectNames.getId('woven_basket'));
    expect(basket.moveToSlot(game.player.instance, codex.slotNames.getId('hand'))).toBeUndefined();
    const contents = { container: basket, slotGlobalId: codex.slotNames.getId('contents') };
    const stone = game.session.spawn(codex.objectNames.getId('stone'));
    expect(stone.moveToSlotAtCell(basket, contents.slotGlobalId, 3)).toBeUndefined();

    const cells = fromGameSession(game, codex, locale).cardsIn(contents);

    expect(cells.length, 'かごは10枠（Containers.md 1節）').toBe(10);
    expect(cells[3]?.objects, '入れた枠にそのまま出る').toEqual([stone]);
    expect(cells.filter((card) => card !== undefined).length, '他の枠は空いたまま').toBe(1);
  });

  it('かごは束ねられないので、2つ持てば2枚のカードとして並ぶ', () => {
    // 束ねると代表の中身しか開けない（SlotSystem.md 4節）。かごはstackable: falseを名乗る。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const handSlotId = codex.slotNames.getId('hand');
    const baskets = [0, 1].map(() => game.session.spawn(codex.objectNames.getId('woven_basket')));
    for (const basket of baskets) expect(basket.moveToSlot(game.player.instance, handSlotId)).toBeUndefined();
    const stone = game.session.spawn(codex.objectNames.getId('stone'));
    expect(stone.moveToSlot(baskets[0], codex.slotNames.getId('contents'))).toBeUndefined();

    const view = fromGameSession(game, codex, locale);
    const cards = handCells(view, game).filter((card) => card !== undefined);

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
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const handSlotId = codex.slotNames.getId('hand');
    const basket = game.session.spawn(codex.objectNames.getId('woven_basket'));
    const stone = game.session.spawn(codex.objectNames.getId('stone'));
    for (const item of [basket, stone]) {
      expect(item.moveToSlot(game.player.instance, handSlotId)).toBeUndefined();
    }

    const stoneCard = handCells(fromGameSession(game, codex, locale), game)[1]!;
    const opened = handCells(fromGameSession(game, codex, locale), game)[0]?.contentsFor(stoneCard);
    expect(opened, 'コンテナのカードは中身の場所を持つ').toBeDefined();
    expect(stoneCard.contentsFor(stoneCard), '石は何も受け取らない').toBeUndefined();

    // 手持ちの石を、開いた籠の中へ入れる。
    handCells(fromGameSession(game, codex, locale), game)[1]?.moveTo?.(opened!)?.();

    const view = fromGameSession(game, codex, locale);
    expect(view.cardsIn(opened!).flatMap((card) => card?.objects ?? [])).toEqual([stone]);
    // タブのラベルはスロットの名前だけ（持ち主は見出しが言う）。この対応表は未登録なので識別子のまま。
    expect(view.slotViewOf(opened!).label).toBe(locale.slot('contents').displayName);
    expect(view.slotViewOf(opened!).key, 'タブの記憶の鍵はスロット名').toBe('contents');
    expect(view.slotViewOf(opened!).acceptsCards).toBe(true);
    expect(handCells(view, game)[1], '石は手持ちから無くなる').toBeUndefined();

    // 中身のカードは手持ちへ戻せる。
    view.cardsIn(opened!)[0]!.moveTo?.(place(game, 'hand'))?.();
    expect(game.player.hand[1]).toBe(stone);
  });

  it('コンテナを自分自身の中へは入れられない', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const basket = game.session.spawn(codex.objectNames.getId('woven_basket'));
    expect(basket.moveToSlot(game.player.instance, codex.slotNames.getId('hand'))).toBe(undefined);

    const card = handCells(fromGameSession(game, codex, locale), game)[0];

    expect(card?.moveTo?.(card.contentsFor(card)!), '籠を籠自身の中へは入れられない').toBeUndefined();
  });

  it('combinationOfは、withタグが合うカード同士にだけ実行手段を返す', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const view = fromGameSession(game, codex, locale);
    // water_liquidはwith: water_liquidのpour_inを持つ（liquid_containers.yaml）。
    const cardOf = (name: string) => {
      const objects = [game.session.spawn(codex.objectNames.getId(name))];
      return {
        icon: '',
        name,
        place: place(game, 'items'),
        objects,
        objectGlobalId: objects[0].def.globalId,
        movedIds: () => objects.map((object) => object.instanceId),
        actions: [],
        visibleSlots: [],
        contentsFor: () => undefined,
      };
    };
    const water = cardOf('water_liquid');

    expect(view.combinationOf(water, cardOf('water_liquid'))?.execute).toBeTypeOf('function');
    expect(
      view.combinationOf(water, cardOf('stone')),
      'どちらにもマッチする組み合わせが無い',
    ).toBeUndefined();
  });

  it('combinationOfは、落とされた側に組み合わせが無ければ掴んだ側の組み合わせを返す', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    // アバカはwith: cutting_toolのfellを持ち、sharp_stoneは何も持たない（fiber.yaml・tools.yaml）。
    const abaca = game.session.spawn(codex.objectNames.getId('abaca'));
    expect(abaca.moveToSlot(game.startLocation.instance, codex.slotNames.getId('fixtures'))).toBeUndefined();
    const knife = game.session.spawn(codex.objectNames.getId('sharp_stone'));
    expect(knife.moveToSlot(game.player.instance, codex.slotNames.getId('hand'))).toBeUndefined();

    const view = fromGameSession(game, codex, locale);
    const abacaCard = lane(view, game, 'fixtures').find((card) => card.objects[0] === abaca)!;
    const knifeCard = handCells(view, game).find((card) => card?.objects[0] === knife)!;

    const dropped = view.combinationOf(knifeCard, abacaCard);
    const reversed = view.combinationOf(abacaCard, knifeCard);

    expect(dropped?.execute, '刃物をアバカへ重ねる').toBeTypeOf('function');
    expect(reversed?.execute, 'アバカを刃物へ重ねても同じ組み合わせが成立する').toBeTypeOf('function');
    expect(reversed?.name, '実行するのはアバカが宣言しているfell').toBe(dropped?.name);
    // 掴んでいたのはアバカのほうなので、手を離した場所から動き出すのもアバカ（CardCombination.held）。
    expect(reversed?.held).toBe(abaca);
    expect(dropped?.held).toBe(knife);

    reversed?.execute();
    expect(abaca.parent, '逆向きでも切り倒される').toBeUndefined();
  });

  it('空の器を水入りの器へ重ねると、注ぎ移しが逆向きに成立する', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const handId = codex.slotNames.getId('hand');
    const contentId = codex.slotNames.getId('content');
    const bowlId = codex.objectNames.getId('coconut_bowl');
    const filled = game.session.spawn(bowlId);
    expect(filled.moveToSlot(game.player.instance, handId)).toBeUndefined();
    const water = game.session.spawn(codex.objectNames.getId('water_liquid'));
    expect(water.moveToSlot(filled, contentId)).toBeUndefined();
    const empty = game.session.spawn(bowlId);
    expect(empty.moveToSlot(game.player.instance, handId)).toBeUndefined();

    const view = fromGameSession(game, codex, locale);
    const cardOf = (bowl: WorldObject) => handCells(view, game).find((card) => card?.objects[0] === bowl)!;

    // 空の器はliquid_containerとしてpour_inを宣言し、水入りの器は代表（中身の水）がliquidタグを持つ。
    view.combinationOf(cardOf(empty), cardOf(filled))?.execute();

    const contentNames = (bowl: WorldObject) =>
      bowl.tryGetSlot(contentId)?.contents.map((content) => content.def.name);
    expect(contentNames(empty), '掴んだ空の器のほうへ注がれる').toEqual(['water_liquid']);
    expect(contentNames(filled), '注ぎ元は空になる').toEqual([]);
  });

  it('同じカードへ重ねたときは、スタックの中の2つを組み合わせる', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const itemsSlotId = codex.slotNames.getId('items');
    for (const name of ['stone', 'stone', 'thick_branch']) {
      const item = game.session.spawn(codex.objectNames.getId(name));
      expect(item.moveToSlot(game.startLocation.instance, itemsSlotId)).toBeUndefined();
    }

    const view = fromGameSession(game, codex, locale);
    const cardOf = (name: string) =>
      lane(view, game, 'items').find((card) => card?.objects[0].def.name === name)!;
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

  it('viewを作った後にワールドの束が空になっても、カードの操作の試し打ちは壊れない', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const itemsSlotId = codex.slotNames.getId('items');
    const stone = game.session.spawn(codex.objectNames.getId('stone'));
    expect(stone.moveToSlot(game.startLocation.instance, itemsSlotId)).toBeUndefined();

    const view = fromGameSession(game, codex, locale);
    const card = lane(view, game, 'items').find((c) => c?.objects[0] === stone)!;

    // 経過の途中経過（RecordedView）を再生する頃には、ワールド側の束は空になり得る。
    // カードは作った時点の中身を写し取っているので、端の表示の試し打ち（moveTo）は壊れない。
    expect(stone.moveToSlot(game.player.instance, codex.slotNames.getId('hand'))).toBeUndefined();
    expect(() => card.moveTo?.(place(game, 'hand'))).not.toThrow();
    expect(() => card.acceptedCountAt?.(place(game, 'hand'))).not.toThrow();
    expect(card.movedIds(1)).toEqual([stone.instanceId]);
  });

  it('combinationOfは、ドラッグ中に見せる表示名と説明も返す', () => {
    // 吹き出しに出す文字列はlocale側から来る（Localization.md）。ここでは専用の対応表で確かめる。
    const texts = parseLocale(
      'ja.yaml',
      `object_texts:
  stone:
    display_name: 石
    interactions:
      knap:
        display_name: 打ち割る
        description: 石を打ち合わせて割る。
`,
    );
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const itemsSlotId = codex.slotNames.getId('items');
    for (const name of ['stone', 'stone']) {
      const stone = game.session.spawn(codex.objectNames.getId(name));
      expect(stone.moveToSlot(game.startLocation.instance, itemsSlotId)).toBeUndefined();
    }

    const view = fromGameSession(game, codex, texts);
    const stones = lane(view, game, 'items').find((card) => card.objects[0].def.name === 'stone')!;

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
    interactions:
      eat:
        display_name: 食べる
        description: そのまま口へ運ぶ。
`,
    );
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const meat = game.session.spawn(codex.objectNames.getId('coconut_meat'));
    expect(meat.moveToSlot(game.player.instance, codex.slotNames.getId('hand'))).toBeUndefined();
    // 満腹度は初期値が上限なので、食べた分が乗る余地を空けておく。
    const satietyId = codex.propertyNames.getId('satiety');
    game.player.instance.setNumber(satietyId, 0, game.session);

    const card = handCells(fromGameSession(game, codex, texts), game)[0];

    expect(card?.description).toBe('殻から掻き出した白い果肉。');
    expect(card?.actions).toMatchObject([{ name: '食べる', description: 'そのまま口へ運ぶ。' }]);

    card?.actions[0].execute();

    expect(game.player.instance.getNumber(satietyId), '食べたかさだけ腹が満ちる').toBeGreaterThan(0);
    expect(game.player.hand[0], '食べた果肉は無くなる').toBeUndefined();
  });

  it('アクションを持たないオブジェクトのカードは、アクションが空になる', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const thickBranch = game.session.spawn(codex.objectNames.getId('thick_branch'));
    expect(thickBranch.moveToSlot(game.player.instance, codex.slotNames.getId('hand'))).toBeUndefined();

    const card = handCells(fromGameSession(game, codex, locale), game)[0];

    expect(card?.actions).toEqual([]);
    expect(card?.description, 'localeに説明文が無ければundefined').toBeUndefined();
  });

  it('中身が代表するカード（液体容器）には、中身のアクションが並ぶ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const canteen = game.session.spawn(codex.objectNames.getId('canteen'));
    const water = game.session.spawn(codex.objectNames.getId('water_liquid'));
    water.setNumber(codex.propertyNames.getId('volume'), 1000, game.session);
    expect(water.moveToSlot(canteen, codex.slotNames.getId('content'))).toBeUndefined();
    // 液体容器にはまだitemタグが無く手持ちのaccepts制約に掛かるため、強制的に入れて手持ちのカードにする。
    expect(canteen.moveToSlot(game.player.instance, codex.slotNames.getId('hand'), true)).toBeUndefined();
    const hydrationId = codex.propertyNames.getId('hydration');
    game.player.instance.setNumber(hydrationId, 0, game.session);

    // 水筒のカードだが、操作の対象は代表（represented_by）である中身の水になる（ActionSystem.md 1節）。
    const card = handCells(fromGameSession(game, codex, locale), game)[0];

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
    expect(canteen.moveToSlot(game.player.instance, handId, true)).toBeUndefined();

    expect(handCells(fromGameSession(game, codex, texts), game)[0]?.name, '空なら入れ物の名前だけ').toBe(
      '水筒',
    );

    const water = game.session.spawn(codex.objectNames.getId('water_liquid'));
    water.setNumber(codex.propertyNames.getId('volume'), 1000, game.session);
    expect(water.moveToSlot(canteen, codex.slotNames.getId('content'))).toBeUndefined();

    expect(handCells(fromGameSession(game, codex, texts), game)[0]?.name).toBe('水入りの水筒');
  });

  it('アクションはかかる時間を持つ（durationを持たなければ0）', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);
    const path = pathsIn(game.startLocation, codex)[0];
    // 食べるのに15分かかる肉（duration: 15）と、雨を受けるだけで時間のかからない器
    // （coconut_bowlのcollect_rainはdurationを宣言していない）を並べて持たせる。
    for (const name of ['coconut_meat', 'coconut_bowl']) {
      const item = game.session.spawn(codex.objectNames.getId(name));
      expect(item.moveToSlot(game.player.instance, codex.slotNames.getId('hand'))).toBeUndefined();
    }

    const view = fromGameSession(game, codex, locale);

    // 道のtravelのdurationは、その道のtravel_minutesを引く（locations.yaml）。
    const travel = lane(view, game, 'fixtures').find((card) => card.objects[0] === path)!.actions[0];
    expect(travel.minutes).toBe(new Path(path, codex.propertyNames).travelMinutes);
    expect(travel.minutes, '移動には時間がかかる').toBeGreaterThan(0);
    expect(handCells(view, game)[0]?.actions[0].minutes, 'eatはdurationを持つ').toBe(15);
    expect(handCells(view, game)[1]?.actions[0].minutes, 'collect_rainはdurationを持たない').toBe(0);
  });

  it('combinationもかかる時間を持つ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const itemsSlotId = codex.slotNames.getId('items');
    for (const name of ['stone', 'stone']) {
      const stone = game.session.spawn(codex.objectNames.getId(name));
      expect(stone.moveToSlot(game.startLocation.instance, itemsSlotId)).toBeUndefined();
    }

    const view = fromGameSession(game, codex, locale);
    const stones = lane(view, game, 'items').find((card) => card.objects[0].def.name === 'stone')!;

    // 石を打ち割るknapのdurationは60分（locations.yaml）。
    expect(view.combinationOf(stones, stones)?.minutes).toBe(60);
  });

  it('道のカードのアクションで、現在地が行き先へ移る', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);
    const path = new Path(pathsIn(game.startLocation, codex)[0], codex.propertyNames);

    const view = fromGameSession(game, codex, locale);
    const card = lane(view, game, 'fixtures').find((fixture) => fixture.objects[0] === path.instance)!;
    card.actions.find((action) => action.name === 'travel')!.execute();

    expect(fromGameSession(game, codex, locale).currentLocationCard.name).toBe(
      locale.locationName(game.map.nameOfInstance(path.destinationInstanceId)!),
    );
  });

  it('ステータスエリアには、statusタグが付いたプロパティだけが実際の値で並ぶ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const statusTagId = codex.propertyTagNames.getId('status');
    const tagged = game.player.instance.propertiesWithTag(statusTagId);

    const view = fromGameSession(game, codex, locale);

    expect(view.statuses).toHaveLength(tagged.length);
    // 水分は開始直後からバーに出るよう安全域のやや下（75%）、満腹感は胃と腸の初期値から決まる55%、
    // 荷重と痛みは0、残りは満タンで始まる（characters/・Characters.md 域の区分節）。
    const startRatios: Record<string, number> = { satiety: 0.2, hydration: 0.75, load: 0, pain: 0 };
    expect(view.statuses.map((status) => status.ratio)).toEqual(
      tagged.map((property) => startRatios[property.name] ?? 1),
    );
    const startAlerts: Record<string, string> = { satiety: 'watch', hydration: 'watch' };
    expect(view.statuses.map((status) => status.alert)).toEqual(
      tagged.map((property) => startAlerts[property.name] ?? 'safe'),
    );
    expect(view.statuses.map((status) => status.key)).toEqual(tagged.map((property) => property.name));
    // localeに登録の無いcharacterでは識別子がそのまま出る（Localization.md）。
    expect(view.statuses.map((status) => status.name)).toEqual(tagged.map((property) => property.name));
  });

  it('ステータスの行には、対応表が宣言したアイコンが付く', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    // propsのdefaultエントリは全オブジェクト共通（Localization.md）。
    const withIcon = parseLocale(
      'ja.yaml',
      'object_texts:\n  default:\n    props:\n      hydration:\n        display_name: 水分\n        icon: 💧\n',
    );

    const { statuses } = fromGameSession(game, codex, withIcon);

    expect(statuses.find((status) => status.key === 'hydration')?.icon).toBe('💧');
    expect(
      statuses.find((status) => status.key === 'load')?.icon,
      '宣言が無ければ絵は無い（行は表示名で代用する）',
    ).toBeUndefined();
  });

  it('ステータスの詳細には、意味・今いる段・影響の出入りが揃う', () => {
    // ステータス詳細ウィンドウ（Windows.md 8節）。UIはどのステータスが何に効くかを知らず、
    // 持続効果の宣言（characters/）から導いたものをそのまま並べる。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));

    const view = fromGameSession(game, codex, locale);
    const bodyFat = view.propertyCategories
      .flatMap((tab) => tab.entries)
      .find((entry) => entry.key === 'body_fat')?.detail;

    expect(bodyFat?.stage?.name, '開始直後は標準の段（characters/）').toBe('nourished');
    // 段はrangeの中の区間で、上端は次の段のmin（nourished 480〜stout 2880、medic）。
    expect(bodyFat?.stage?.span?.start).toBeCloseTo(480 / 5760);
    expect(bodyFat?.stage?.span?.end).toBeCloseTo(2880 / 5760);
    // 目盛りは全部の段の境目（starved 0 は下限なので含まない。gaunt 96・nourished 480・stout 2880・obese 4320）。
    expect(bodyFat?.stage?.boundaries).toEqual([96, 480, 2880, 4320].map((value) => value / 5760));
    expect(
      bodyFat?.received.map((influence) => `${influence.name}${influence.increases ? '+' : '-'}`),
      '3大栄養素が流れ込み、自分の段の基礎代謝が削る',
    ).toEqual(['carbohydrate+', 'protein+', 'lipid+', 'body_fat-']);
    expect(
      bodyFat?.received.every((influence) => !influence.reversible),
      'transferもaddも不可逆なので、記号は＋−になる',
    ).toBe(true);
  });

  it('痛みの詳細には、負っている怪我が影響元として並ぶ', () => {
    // 痛みはステータスからは一切影響を受けない（injuries.yamlのmodifyだけが押し上げる）。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    injure(game);

    const view = fromGameSession(game, codex, locale);
    const pain = view.statuses.find((status) => status.key === 'pain')?.detail;

    expect(pain?.received).toHaveLength(1);
    expect(pain?.received[0]?.name, '相手はステータスではなく怪我そのもの').toBe('sprained_ankle');
    expect(pain?.received[0]?.art, '怪我のカードと同じ絵を出す').toBe('sprained_ankle');
    expect(pain?.received[0]?.reversible, 'modifyなので三角').toBe(true);
    expect(pain?.received[0]?.increases).toBe(true);
    expect(pain?.received[0]?.worsens, '痛みは増えると悪い').toBe(true);
    expect(pain?.received[0]?.active, '負っている間は効いている').toBe(true);
  });

  it('荷が重すぎると移動のアクションが押せなくなり、理由の文言が付く', () => {
    // ContainerSystem.md 5節: 危険域（too_heavy）に入ると道のtravelのconditionsが落ちる。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);
    const localeWithReason = parseLocale('ja.yaml', 'reason_texts:\n  too_heavy: 荷が重すぎて歩けない。\n');
    const pathTagId = codex.tagNames.getId('path');
    const travelOf = (view: ReturnType<typeof fromGameSession>) =>
      lane(view, game, 'fixtures').find((card) => card.objects[0].def.tags.includes(pathTagId))!.actions[0];

    expect(travelOf(fromGameSession(game, codex, localeWithReason)).enabled, '空身なら歩ける').toBe(true);

    // 装備スロットへ石（1kgずつ）を積んで、どのキャラクタでも危険域へ届く重さにする。
    const equipmentId = codex.slotNames.getId('equipment');
    for (let i = 0; i < 40; i++)
      game.session.spawn(codex.objectNames.getId('stone')).moveToSlot(game.player.instance, equipmentId);
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
    // 残り24 tick分（6時間）未満で致命的域（characters/）。
    game.player.instance.setNumber(hydration, 20, game.session);

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
      (name) => game.player.instance.propertiesWithTag(codex.propertyTagNames.getId(name)).length > 0,
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

    expect(view.mapLands.map((land) => land.card.name)).toEqual([view.currentLocationCard.name]);
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

    expect(view.currentLocationCard.name).toBe(
      locale.locationName(game.map.nameOfInstance(path.destinationInstanceId)!),
    );
  });
});
