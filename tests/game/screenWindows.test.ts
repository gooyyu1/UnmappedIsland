import { describe, expect, it } from 'vitest';
import type { WorldObject } from '../../src/domain/WorldObject';
import type { ObjectCardStack, ObjectWindowView, PlayScreenView } from '../../src/game/view/PlayScreenView';
import { fromGameSession } from '../../src/game/view/PlayScreenView';
import type { Localization } from '../../src/locale/Localization';
import { parseLocale } from '../../src/locale/Localization';
import type { MiniGame } from '../support/miniGame';
import { miniGame } from '../support/miniGame';

/**
 * 子ウィンドウ（Windows.md）とステータスエリア（StatusArea.md）の自動テスト。
 *
 * どちらも**宣言をそのまま並べるだけ**で、何が何に効くかを画面は知らない。ここで確かめるのは
 * 「どの宣言がどこへ出るか」で、しきい値や効き目そのものは世界側の話。
 */
describe('子ウィンドウとステータスエリア', () => {
  const locale = parseLocale('ja.yaml', 'object_texts:\n  stone:\n    display_name: 石\n');

  const WORLD = `
property_tags:
  # ステータスエリアに常時バーで出すもの。
  status:
  vitals:
  # どのプロパティも名乗らないタグ。中身のないタブが出ないことの相手役。
  skills:

traits:
  liquid_container:
    tags: [liquid_container]
  liquid:
    tags: [liquid]
    props:
      density: {value: 1}

object_defs:
  survivor:
    traits: [carrier]
    props:
      hydration:
        tags: [status]
        gauge: {min: bad, max: good}
        value: 75
        range: {min: 0, max: 100}
        stages:
          - {name: parched, alert: fatal}
          - {name: thirsty, min: 20, alert: watch}
          - {name: watered, min: 80}
      # 自分では動かず、injuriesスロットの中の怪我がmodifyで押し上げる。
      pain:
        tags: [status]
        gauge: {min: good, max: bad}
        value: 0
        range: {min: 0, max: 100}
      # ステータスエリアには出ないが、プロパティウィンドウには出る。
      body_fat:
        tags: [vitals]
        value: 50
        range: {min: 0, max: 100}

  # 負っている間だけ、負った本人の痛みを押し上げる。
  sprain:
    tags: [injury]
    visible_slots: [treatment]
    slots:
      treatment: {cell_count: 1, cell: {accept: {tag: treatment}}}
    passives:
      - modify: {parent: {pain: 40}}

  bandage:
    tags: [item, treatment]

  stone:
    tags: [item]
    props:
      volume: {value: 100}

  crate:
    tags: [item]
    storage: true
    visible_slots: [contents]
    props:
      volume: {value: 500}
    slots:
      contents:
        cell_count: 10
        cell: {accept: {tag: item}}
        capacity: 20000

  bowl:
    tags: [item]
    traits: [liquid_container]
    props:
      weight: {value: 200}
      fill: {value: 0, range: {min: 0, max: 250}, on_min: {become: {content: none}}}
      volume: {value: 200}
    variation_axes:
      content: {of: {tag: liquid}}

  water_liquid:
    traits: [liquid]
`;

  const setUp = (): MiniGame => miniGame(WORLD, { player: 'survivor' });

  const viewOf = (mini: MiniGame, texts: Localization = locale): PlayScreenView =>
    fromGameSession(mini.game, mini.codex, texts);

  const cardOf = (view: PlayScreenView, object: WorldObject): ObjectCardStack =>
    view.cardsIn(object.parentSlot!).find((card) => card?.objects[0] === object)!;

  it('中身を持つカードは、それを映す場所と、空けておく枠の数の元になる容量を持つ', () => {
    // 中身を見せるかはタグではなくスロットで決める（Windows.md 1節 子ウィンドウ）。
    const mini = setUp();
    const sprain = mini.createObject('sprain', mini.slot('injuries'));
    const crate = mini.createObject('crate', mini.slot('hand'));
    const bandage = mini.createObject('bandage', mini.slot('hand'));

    const view = viewOf(mini);
    const sprainCard = cardOf(view, sprain);
    const crateCard = cardOf(view, crate);
    const bandageCard = cardOf(view, bandage);

    const treatment = sprain.getSlot(mini.codex.slotNames.getId('treatment'));
    expect(sprainCard.visibleSlots, '治療具のタブが出る').toEqual([treatment]);
    expect(view.slotViewOf(treatment).cells, '治療具の枠は1つだけ').toBe(1);
    // 行き先は重ねる物で変わる。怪我が受け取るのは治療具だけで、入れ物は受け取らない。
    expect(sprainCard.contentsFor(bandageCard), '包帯は治療具のスロットへ入る').toEqual(treatment);
    expect(sprainCard.contentsFor(crateCard), '入れ物は怪我に入らない').toBeUndefined();

    const contents = crate.getSlot(mini.codex.slotNames.getId('contents'));
    expect(crateCard.visibleSlots, '中身のタブが出る').toEqual([contents]);
    expect(view.slotViewOf(contents).cells, '宣言した枠数がそのまま出る').toBe(10);
    expect(crateCard.contentsFor(bandageCard), '入れ物は持ち物を受け取る').toEqual(contents);
  });

  it('子ウィンドウは、映す対象のオブジェクト1つから作る', () => {
    // 窓が映すのは1個ぶんなので、束かどうかもどの枠に居るかも要らない。キャラクタ・現在地は
    // 画面から名前で開く入口で、答えは同じ経路（windowOf）から来る。
    const mini = setUp();
    const stone = mini.createObject('stone', mini.slot('hand'));

    const view = viewOf(mini);

    expect(view.characterWindow.card, 'ポートレイトと同じ1枚').toBe(view.characterCard);
    expect(view.nestedLocations[0].window.card).toBe(view.currentLocationCard);
    expect(view.windowOf(stone).explorationRatio, '石は探索できない').toBeUndefined();
    expect(view.windowOf(stone).card.name, '押した札が映す物の姿を出す').toBe(cardOf(view, stone).name);
  });

  it('子ウィンドウに要るものは、対象ごとに1つのまとまりで答える', () => {
    // 呼び出し側（PlayScene）がばらばらのメンバーから組み立てると、窓を足すたびに組み立ての手順も
    // 増える。1つの窓に要るものは1つの問い合わせで揃う（Windows.md 1節）。
    const mini = setUp();
    const crate = mini.createObject('crate', mini.slot('hand'));

    const view = viewOf(mini);
    const crateWindow = view.windowOf(crate);

    expect(crateWindow.card.name, 'その札そのものを出す').toBe(cardOf(view, crate).name);
    expect(crateWindow.slots, '入れ物は中身のタブを持つ').toHaveLength(1);
    expect(crateWindow.properties, 'タグの付いたプロパティを持たないのでタブが出ない').toEqual([]);
    expect(crateWindow.explorationRatio, '探索できるのは場所だけ').toBeUndefined();

    expect(view.characterWindow.properties.length, 'キャラクタはプロパティのタブを持つ').toBeGreaterThan(0);
    expect(
      view.characterWindow.slots.map((slot) => view.slotViewOf(slot).key),
      '外から見えるのは装備と怪我だけ（手持ちはレーンに出ている）',
    ).toEqual(['equipment', 'injuries']);
  });

  it('液体の容器は中身を開かない（水を単独で取り出させない）', () => {
    // 中身は容器自身のfillなので、そもそも開く先が無い（LiquidContainerSystem.md 2節）。
    const mini = setUp();
    const bowl = mini.createObject('bowl', mini.slot('hand'));
    bowl.becomeAlong(new Map([['content', 'water_liquid']]));
    bowl.tryGetProperty(mini.codex.propertyNames.getId('fill'))?.setNumber(100);

    const card = cardOf(viewOf(mini), bowl);

    expect(card.visibleSlots, '中身の並びは開かない').toEqual([]);
    expect(
      card.gauges?.find((gauge) => gauge.key === '@fill')?.ratio,
      '入っていることはバーで見せる',
    ).toBeGreaterThan(0);
  });

  it('プロパティの詳細は、その値を持つ物から読む', () => {
    // 同じ名前のプロパティを複数の型が持つことはある。詳細に出る影響の出入りは、プロパティの名前では
    // なく持ち主で決まる（Windows.md 6節）。
    const mini = miniGame(
      `${WORLD}
  charm:
    tags: [item]
    props:
      pain:
        tags: [status]
        gauge: {min: good, max: bad}
        value: 10
        range: {min: 0, max: 100}
`,
      { player: 'survivor' },
    );
    const charm = mini.createObject('charm', mini.slot('hand'));
    mini.createObject('sprain', mini.slot('injuries'));

    const view = viewOf(mini);
    const painIn = (window: ObjectWindowView) =>
      window.properties.flatMap((tab) => tab.entries).find((entry) => entry.key === 'pain');
    const charmPain = painIn(view.windowOf(charm));
    const characterPain = painIn(view.characterWindow);

    expect(charmPain?.value, 'お守り自身の値が出る').toBe(10);
    expect(charmPain?.detail?.received, 'お守りは何の影響も受けていない').toEqual([]);
    expect(
      characterPain?.detail?.received.length,
      'キャラクタの痛みは負った怪我から影響を受けている',
    ).toBeGreaterThan(0);
  });

  it('ステータスエリアには、statusタグが付いたプロパティだけが実際の値で並ぶ', () => {
    const mini = setUp();
    const tagged = mini.player.propertiesWithTag(mini.codex.propertyTagNames.getId('status'));

    const view = viewOf(mini);

    expect(view.statuses).toHaveLength(tagged.length);
    expect(view.statuses.map((status) => status.key)).toEqual(tagged.map((property) => property.def.name));
    expect(
      view.statuses.map((status) => status.ratio),
      '宣言した初期値がそのまま割合になる',
    ).toEqual([0.75, 0]);
    expect(
      view.statuses.map((status) => status.alert),
      '安全域を外れているものだけが域を上げる',
    ).toEqual(['watch', 'safe']);
    // localeに登録が無ければ識別子がそのまま出る（Localization.md）。
    expect(view.statuses.map((status) => status.name)).toEqual(tagged.map((property) => property.def.name));
  });

  it('ステータスの行には、対応表が宣言したアイコンが付く', () => {
    // propsのdefaultエントリは全オブジェクト共通（Localization.md）。
    const mini = setUp();
    const withIcon = parseLocale(
      'ja.yaml',
      'object_texts:\n  default:\n    props:\n      hydration:\n        display_name: 水分\n        icon: 💧\n',
    );

    const { statuses } = viewOf(mini, withIcon);

    expect(statuses.find((status) => status.key === 'hydration')?.icon).toBe('💧');
    expect(
      statuses.find((status) => status.key === 'pain')?.icon,
      '宣言が無ければ絵は無い（行は表示名で代用する）',
    ).toBeUndefined();
  });

  it('ステータスの域は、値が減るとその区分に従って上がる', () => {
    const mini = setUp();
    mini.player.tryGetProperty(mini.codex.propertyNames.getId('hydration'))?.setNumber(10);

    const view = viewOf(mini);

    expect(view.statuses.find((status) => status.key === 'hydration')?.alert).toBe('fatal');
  });

  it('痛みの詳細には、負っている怪我が影響元として並ぶ', () => {
    // 痛みはステータスからは一切影響を受けない（怪我のmodifyだけが押し上げる）。
    const mini = setUp();
    mini.createObject('sprain', mini.slot('injuries'));

    const view = viewOf(mini);
    const pain = view.statuses.find((status) => status.key === 'pain')?.detail;

    expect(pain?.received).toHaveLength(1);
    expect(pain?.received[0]?.name, '相手はステータスではなく怪我そのもの').toBe('sprain');
    expect(pain?.received[0]?.art, '怪我のカードと同じ絵を出す').toBe('sprain');
    expect(pain?.received[0]?.reversible, 'modifyなので三角').toBe(true);
    expect(pain?.received[0]?.increases).toBe(true);
    expect(pain?.received[0]?.worsens, '痛みは増えると悪い').toBe(true);
    expect(pain?.received[0]?.active, '負っている間は効いている').toBe(true);
  });

  it('プロパティウィンドウのタブはproperty_tagsの宣言順で、中身のないタグは出ない', () => {
    const mini = setUp();

    const view = viewOf(mini);

    // skillsは誰も名乗っていないので出ない。
    expect(view.propertyCategories.map((category) => category.name)).toEqual(['status', 'vitals']);
    for (const category of view.propertyCategories) expect(category.entries.length).toBeGreaterThan(0);
  });

  it('プロパティウィンドウには、ステータスエリアに出ないプロパティも出る', () => {
    const mini = setUp();

    const view = viewOf(mini);

    const shown = new Set(view.propertyCategories.flatMap((c) => c.entries.map((e) => e.name)));
    const inStatusArea = new Set(view.statuses.map((status) => status.name));
    // body_fatはvitalsタグだけを持つため、ウィンドウにだけ現れる。
    expect(shown.has('body_fat')).toBe(true);
    expect(inStatusArea.has('body_fat')).toBe(false);
  });
});
