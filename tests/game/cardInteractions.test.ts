import { describe, expect, it } from 'vitest';
import type { WorldObject } from '../../src/domain/WorldObject';
import type { ObjectCardStack, PlayScreenView } from '../../src/game/view/PlayScreenView';
import { fromGameSession } from '../../src/game/view/PlayScreenView';
import { parseLocale } from '../../src/locale/Localization';
import type { MiniGame } from '../support/miniGame';
import { miniGame } from '../support/miniGame';

/**
 * 札の上で起こせること（CardInteraction.md）の自動テスト。重ねたときに何が成立するか、押せる操作は
 * 何か、かかる時間はいくらか。
 *
 * **起きることの中身は見ない**——それは世界側の宣言で、ここで見るのは「札から宣言へ辿り着けるか」
 * 「向きで答えが変わらないか」だけ。
 */
describe('札の上の操作', () => {
  const locale = parseLocale('ja.yaml', 'object_texts:\n  stone:\n    display_name: 石\n');

  const WORLD = `
traits:
  liquid_container:
    tags: [liquid_container]
  liquid:
    tags: [liquid]
    props:
      density: {value: 1}
  water_liquid:
    tags: [water]
    props:
      color: {value: 0x2f86d8}
    interactions:
      drink:
        trigger: menu
        duration: 5
        add: {actor: {hydration: 10}}
      # 宣言があるのは中身入りの側だけなので、どちらの札をどちらへ重ねてもselfは中身入りになる。
      pour_into_empty:
        trigger: {drag: {tag: liquid_container}}
        conditions: [{reason: not_empty, subject: dragged, prop: fill, eq: 0}]
        become: {subject: dragged, content: water_liquid}
        transfer: {amount: 999999, from: self, from_prop: fill, to: dragged, to_prop: fill}
      pour_into_filled:
        trigger: {drag: {tag: water}}
        transfer: {amount: 999999, from: dragged, from_prop: fill, to: self, to_prop: fill}

object_defs:
  # 食べ飲みの効き先を持つキャラクタ。
  eater:
    traits: [carrier]
    props:
      satiety: {value: 0, range: {min: 0, max: 100}}
      hydration: {value: 1, range: {min: 0, max: 100}}

  stone:
    tags: [item]
    interactions:
      knap:
        trigger: {drag: {object: stone}}
        duration: 60
        destroy: self
        spawn: {object: sharp_stone}

  sharp_stone:
    tags: [item, cutting_tool]

  # 刃物を重ねると切り倒せる。刃物の側は何も宣言していない。
  vine:
    tags: [fixture]
    interactions:
      cut_down:
        trigger: {drag: {tag: cutting_tool}}
        destroy: self

  branch:
    tags: [item]
    props:
      fuel: {value: 20}

  # 束ねた薪はまとめてくべられる（allow_multiple）。何本入るかはfuelのrangeの残りが決める。
  hearth:
    tags: [fixture]
    props:
      fuel: {value: 0, range: {min: 0, max: 30}}
    interactions:
      add_fuel:
        trigger: {drag: {object: branch}, allow_multiple: true}
        duration: 1
        transfer: {amount: 999, from: dragged, from_prop: fuel, to_prop: fuel}
        destroy: dragged

  fruit:
    tags: [item]
    interactions:
      eat:
        trigger: menu
        duration: 15
        destroy: self
        add: {actor: {satiety: 10}}

  bowl:
    tags: [item]
    traits: [liquid_container]
    props:
      weight: {value: 200}
      fill: {value: 0, range: {min: 0, max: 250}, on_min: {become: {content: none}}}
      volume: {value: 200}
    interactions:
      # durationを宣言していない操作。
      collect_rain:
        trigger: menu
        become: {content: water_liquid}
        set: {self: {fill: 1}}
    variation_axes:
      content: {of: {tag: liquid}}

  water_liquid:
    traits: [liquid, water_liquid]
`;

  const setUp = (): MiniGame => miniGame(WORLD, { player: 'eater' });

  const viewOf = (mini: MiniGame, texts = locale): PlayScreenView =>
    fromGameSession(mini.game, mini.codex, texts);

  /** そのオブジェクトを映している札。 */
  const cardOf = (view: PlayScreenView, object: WorldObject): ObjectCardStack =>
    view.cardsIn(object.parentSlot!).find((card) => card?.objects[0] === object)!;

  it('まとめて重ねると、宣言が許した個数ぶん実行される', () => {
    // fuelは0〜30で1本20なので、3本運んでも入るのは2本。
    const mini = setUp();
    const hearth = mini.spawn('hearth', mini.slot('fixtures', mini.land));
    const branches = [0, 1, 2].map(() => mini.spawn('branch', mini.slot('hand')));

    const view = viewOf(mini);
    const combination = view.combinationOf(cardOf(view, branches[0]), cardOf(view, hearth));

    expect(combination?.maxCount, '入るのは2本まで').toBe(2);

    view.combinationOf(cardOf(view, branches[0]), cardOf(view, hearth), 2)?.execute();

    expect(
      hearth.tryGetProperty(mini.codex.propertyNames.getId('fuel'))?.getEffectiveValue(),
      '2本ぶんで満ちる',
    ).toBe(30);
    expect(
      branches.filter((branch) => branch.parent !== undefined),
      '残るのは1本',
    ).toHaveLength(1);
  });

  it('炉を薪へ重ねてもくべられる（宣言は片側だけでよい）', () => {
    // 宣言しているのは炉だけだが、逆向きに運んでも同じ宣言が動く（CardInteraction.md 2節）。
    // **起きることは向きで変わらない**——selfは宣言している炉のまま。
    const mini = setUp();
    const hearth = mini.spawn('hearth', mini.slot('fixtures', mini.land));
    const branch = mini.spawn('branch', mini.slot('hand'));

    const view = viewOf(mini);
    const reversed = view.combinationOf(cardOf(view, hearth), cardOf(view, branch));

    expect(reversed?.name, '薪を炉へ運んだときと同じ組み合わせ').toBe(
      view.combinationOf(cardOf(view, branch), cardOf(view, hearth))?.name,
    );
    expect(reversed?.movedIds, '動くのは指が運んだ炉の札').toEqual([hearth.instanceId]);

    reversed?.execute();

    expect(hearth.tryGetProperty(mini.codex.propertyNames.getId('fuel'))?.getEffectiveValue()).toBe(20);
    expect(branch.parent, '薪は消える').toBeUndefined();
  });

  it('combinationOfは、withが合うカード同士にだけ実行手段を返す', () => {
    const mini = setUp();
    const view = viewOf(mini);
    // 札は場所に居なくてよい（combinationOfが見るのは映している物だけ）。
    const cardFor = (defName: string) => {
      const objects = [mini.spawn(defName)];
      return {
        icon: '',
        name: defName,
        place: mini.slot('items', mini.land),
        objects,
        objectGlobalId: objects[0].def.globalId,
        movedIds: () => objects.map((object) => object.instanceId),
        actions: [],
        visibleSlots: [],
        contentsFor: () => undefined,
      };
    };
    const filled = 'bowl__content_water_liquid';

    expect(view.combinationOf(cardFor(filled), cardFor(filled))?.execute).toBeTypeOf('function');
    expect(
      view.combinationOf(cardFor(filled), cardFor('branch')),
      'どちらにもマッチする組み合わせが無い',
    ).toBeUndefined();
  });

  it('combinationOfは、落とされた側に組み合わせが無ければ掴んだ側の組み合わせを返す', () => {
    const mini = setUp();
    const vine = mini.spawn('vine', mini.slot('fixtures', mini.land));
    const knife = mini.spawn('sharp_stone', mini.slot('hand'));

    const view = viewOf(mini);
    const dropped = view.combinationOf(cardOf(view, knife), cardOf(view, vine));
    const reversed = view.combinationOf(cardOf(view, vine), cardOf(view, knife));

    expect(dropped?.execute, '刃物を蔓へ重ねる').toBeTypeOf('function');
    expect(reversed?.execute, '蔓を刃物へ重ねても同じ組み合わせが成立する').toBeTypeOf('function');
    expect(reversed?.name, '実行するのは蔓が宣言しているcut_down').toBe(dropped?.name);
    // 掴んでいたのは蔓のほうなので、手を離した場所から動き出すのも蔓（CardDrop.movedIds）。
    expect(reversed?.movedIds).toEqual([vine.instanceId]);
    expect(dropped?.movedIds).toEqual([knife.instanceId]);

    reversed?.execute();
    expect(vine.parent, '逆向きでも切り倒される').toBeUndefined();
  });

  it('空の器を水入りの器へ重ねると、注ぎ移しが逆向きに成立する', () => {
    const mini = setUp();
    const filled = mini.spawn('bowl', mini.slot('hand'));
    filled.becomeAlong(new Map([['content', 'water_liquid']]));
    filled.tryGetProperty(mini.codex.propertyNames.getId('fill'))?.setNumber(100);
    const empty = mini.spawn('bowl', mini.slot('hand'));

    const view = viewOf(mini);
    view.combinationOf(cardOf(view, empty), cardOf(view, filled))?.execute();

    expect(empty.def.name, '掴んだ空の器のほうへ注がれる').toBe('bowl__content_water_liquid');
    expect(filled.def.name, '注ぎ切った側は空の容器へ戻る').toBe('bowl');
  });

  it('同じカードへ重ねたときは、スタックの中の2つを組み合わせる', () => {
    const mini = setUp();
    for (const name of ['stone', 'stone', 'branch']) mini.spawn(name, mini.slot('items', mini.land));

    const view = viewOf(mini);
    const laneCards = view.cardsIn(mini.slot('items', mini.land)).filter((card) => card !== undefined);
    const cardNamed = (name: string) => laneCards.find((card) => card.objects[0].def.name === name)!;
    const stones = cardNamed('stone');

    expect(stones.count, '2個の石は1枚のカードにまとまる').toBe(2);
    expect(view.combinationOf(stones, stones)?.execute, 'スタックの中の2つで実行できる').toBeTypeOf(
      'function',
    );
    expect(
      view.combinationOf(cardNamed('branch'), cardNamed('branch')),
      '1個しか無いカードは自分自身とは組み合わせられない',
    ).toBeUndefined();
  });

  it('combinationOfは、ドラッグ中に見せる表示名と説明も返す', () => {
    // 吹き出しに出す文字列はlocale側から来る（Localization.md）。
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
    const mini = setUp();
    for (let i = 0; i < 2; i++) mini.spawn('stone', mini.slot('items', mini.land));

    const view = viewOf(mini, texts);
    const stones = view
      .cardsIn(mini.slot('items', mini.land))
      .find((card) => card?.objects[0].def.name === 'stone')!;

    expect(view.combinationOf(stones, stones)).toMatchObject({
      name: '打ち割る',
      description: '石を打ち合わせて割る。',
    });
  });

  it('combinationもかかる時間を持つ', () => {
    const mini = setUp();
    for (let i = 0; i < 2; i++) mini.spawn('stone', mini.slot('items', mini.land));

    const view = viewOf(mini);
    const stones = view
      .cardsIn(mini.slot('items', mini.land))
      .find((card) => card?.objects[0].def.name === 'stone')!;

    expect(view.combinationOf(stones, stones)?.minutes).toBe(60);
  });

  it('カードは、そのオブジェクトの説明文とアクションを持つ', () => {
    const texts = parseLocale(
      'ja.yaml',
      `object_texts:
  fruit:
    display_name: 果実
    description: 枝から捥いだ実。
    interactions:
      eat:
        display_name: 食べる
        description: そのまま口へ運ぶ。
`,
    );
    const mini = setUp();
    const fruit = mini.spawn('fruit', mini.slot('hand'));
    const satietyId = mini.codex.propertyNames.getId('satiety');

    const card = cardOf(viewOf(mini, texts), fruit);

    expect(card.description).toBe('枝から捥いだ実。');
    expect(card.actions).toMatchObject([{ name: '食べる', description: 'そのまま口へ運ぶ。' }]);

    card.actions[0].execute();

    expect(mini.player.tryGetProperty(satietyId)?.number ?? 0, '食べたかさだけ腹が満ちる').toBeGreaterThan(0);
    expect(mini.game.player.hand[0], '食べた果実は無くなる').toBeUndefined();
  });

  it('アクションを持たないオブジェクトのカードは、アクションが空になる', () => {
    const mini = setUp();
    const branch = mini.spawn('branch', mini.slot('hand'));

    const card = cardOf(viewOf(mini), branch);

    expect(card.actions).toEqual([]);
    expect(card.description, 'localeに説明文が無ければundefined').toBeUndefined();
  });

  it('アクションはかかる時間を持つ（durationを持たなければ0）', () => {
    const mini = setUp();
    const fruit = mini.spawn('fruit', mini.slot('hand'));
    const bowl = mini.spawn('bowl', mini.slot('hand'));

    const view = viewOf(mini);

    expect(cardOf(view, fruit).actions[0].minutes, 'eatはdurationを持つ').toBe(15);
    expect(cardOf(view, bowl).actions[0].minutes, 'collect_rainはdurationを持たない').toBe(0);
  });

  it('中身が代表するカード（液体容器）には、中身のアクションが並ぶ', () => {
    // 水入りの器は1つの型なので、中身のtraitが配ったdrinkがそのまま自分のアクションになる
    // （容器自身のcollect_rainに続く）。
    const mini = setUp();
    const bowl = mini.spawn('bowl', mini.slot('hand'));
    bowl.becomeAlong(new Map([['content', 'water_liquid']]));
    bowl.tryGetProperty(mini.codex.propertyNames.getId('fill'))?.setNumber(250);
    const hydrationId = mini.codex.propertyNames.getId('hydration');

    const card = cardOf(viewOf(mini), bowl);

    expect(
      [...card.actions.map((action) => action.name)].sort(),
      '容器自身の操作と中身の操作が、1つの並びに合流する',
    ).toEqual(['collect_rain', 'drink']);

    card.actions.find((action) => action.name === 'drink')?.execute();

    expect(mini.player.tryGetProperty(hydrationId)?.number ?? 0, '飲んだ分だけ水分が増える').toBeGreaterThan(
      1,
    );
  });

  it('中身入りの容器の名前は、素の型と中身の名前から組み立てられる', () => {
    const texts = parseLocale(
      'ja.yaml',
      `object_texts:
  default:
    variation_names:
      content: '{value}入りの{base}'
  bowl:
    display_name: 器
  water_liquid:
    display_name: 水
`,
    );
    const mini = setUp();
    const bowl = mini.spawn('bowl', mini.slot('hand'));

    expect(cardOf(viewOf(mini, texts), bowl).name, '空なら入れ物の名前だけ').toBe('器');

    bowl.becomeAlong(new Map([['content', 'water_liquid']]));
    bowl.tryGetProperty(mini.codex.propertyNames.getId('fill'))?.setNumber(250);

    expect(cardOf(viewOf(mini, texts), bowl).name).toBe('水入りの器');
  });
});
