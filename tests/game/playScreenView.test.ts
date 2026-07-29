import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import type { NewGameSession } from '../../src/domain/generation/NewGame';
import { start as startNewGame } from '../../src/domain/generation/NewGame';
import { Path } from '../../src/domain/runtime/views/Path';
import { fromGameSession } from '../../src/game/PlayScreenView';
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
    for (const name of ['stone', 'branch', 'driftwood', 'coconut', 'taro', 'water_spinach']) {
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
    });
    const water = cardOf('water_liquid');

    expect(view.combinationOf(water, cardOf('water_liquid'))?.execute).toBeTypeOf('function');
    expect(view.combinationOf(water, cardOf('stone')), '受け側にマッチする組み合わせが無い').toBeUndefined();
  });

  it('同じカードへ重ねたときは、スタックの中の2つを組み合わせる', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const itemsSlotId = codex.slotNames.getId('items');
    for (const name of ['stone', 'stone', 'driftwood']) {
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
    const driftwood = cardOf('driftwood');
    expect(
      view.combinationOf(driftwood, driftwood),
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

  it('ステータスエリアには、statusタグが付いたプロパティだけが実際の値で並ぶ', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const statusTagId = codex.propertyTagNames.getId('status');
    const tagged = game.player.instance.readPropertiesWithTag(statusTagId);

    const view = fromGameSession(game, codex, locale);

    expect(view.statuses).toHaveLength(tagged.length);
    // 初期値はどれもmax（characters.yaml）なので、バーは満タンになる。
    expect(view.statuses.map((status) => status.ratio)).toEqual(tagged.map(() => 1));
    // localeに登録の無いcharacterでは識別子がそのまま出る（Localization.md）。
    expect(view.statuses.map((status) => status.name)).toEqual(tagged.map((reading) => reading.name));
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
