import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

describe('WorldObjectのactions/combinations実行', () => {
  let sessions: Map<WorldCodex, WorldSession>;

  beforeEach(() => {
    sessions = new Map();
  });

  function load(yaml: string): WorldCodex {
    return new WorldCodexYamlLoader().load('core.yaml', yaml).build();
  }

  /** 1つのcodexから作る物は同じセッションに属する（WorldObject.session）。 */
  function spawn(codex: WorldCodex, objectName: string): WorldObject {
    let session = sessions.get(codex);
    if (session === undefined) {
      session = new WorldSession(codex);
      sessions.set(codex, session);
    }
    return session.spawn(codex.objectNames.getId(objectName));
  }

  // ------------------------------------------------------------------
  // actions: conditions / active（self・actor）
  // ------------------------------------------------------------------

  it('アクションの実行でselfとactor両方にactiveが適用され、selfが消滅する', () => {
    const yaml = `
object_defs:
  player:
    props:
      satiety:
        value: 0
  apple:
    actions:
      eat:
        add:
          actor:
            satiety: 10
        destroy: self
`;
    const codex = load(yaml);
    const satietyId = codex.propertyNames.getId('satiety');

    const actor = spawn(codex, 'player');
    const appleInstance = spawn(codex, 'apple');

    const executed = appleInstance.tryGetAction('eat', actor)?.tryExecute() === true;

    expect(executed).toBe(true);
    expect(actor.tryGetProperty(satietyId)?.number ?? 0).toBe(10);
    expect(appleInstance.parent, 'destroy: trueによりself(apple)は消滅する').toBeUndefined();
  });

  it('条件を満たさない場合は何もせずfalseを返す', () => {
    const yaml = `
object_defs:
  player2:
    props:
      satiety:
        value: 100
  apple2:
    actions:
      eat:
        conditions:
          - {subject: actor, prop: satiety, lt: 100}
        add:
          actor:
            satiety: 10
`;
    const codex = load(yaml);
    const satietyId = codex.propertyNames.getId('satiety');

    const actor = spawn(codex, 'player2');
    const appleInstance = spawn(codex, 'apple2');

    const executed = appleInstance.tryGetAction('eat', actor)?.tryExecute() === true;

    expect(executed, 'satietyが既に100(<100を満たさない)のため実行されない').toBe(false);
    expect(actor.tryGetProperty(satietyId)?.number ?? 0, '条件を満たさないため何も変化しない').toBe(100);
  });

  it('spawnの配列で1回のアクションから複数のオブジェクトが生成される', () => {
    const yaml = `
object_defs:
  crate:
    slots:
      inside: {}
    actions:
      open:
        spawn:
          - {object: apple_loot, into: self}
          - {object: berry_loot, into: self}
  apple_loot: {}
  berry_loot: {}
`;
    const codex = load(yaml);
    const insideSlotId = codex.slotNames.getId('inside');

    const crate = spawn(codex, 'crate');

    const executed = crate.tryGetAction('open', undefined)?.tryExecute() === true;

    const inside = crate.tryGetSlot(insideSlotId);
    expect(executed).toBe(true);
    expect(inside?.contents).toHaveLength(2);
    expect(inside?.contents.map((c) => c.def.name).sort()).toEqual(['apple_loot', 'berry_loot'].sort());
  });

  it('未知のアクション名を指定するとfalseを返す', () => {
    const yaml = `
object_defs:
  apple3: {}
`;
    const codex = load(yaml);

    const appleInstance = spawn(codex, 'apple3');

    expect(appleInstance.tryGetAction('does_not_exist', undefined)?.tryExecute() === true).toBe(false);
  });

  it('parent対象は現在の親に適用される', () => {
    const yaml = `
object_defs:
  basket:
    slots:
      items: {}
    props:
      weight_budget:
        value: 10
  rock_item:
    actions:
      use:
        add:
          parent:
            weight_budget: -1
`;
    const codex = load(yaml);
    const itemsSlotId = codex.slotNames.getId('items');
    const budgetId = codex.propertyNames.getId('weight_budget');

    const basketInstance = spawn(codex, 'basket');
    const rockInstance = spawn(codex, 'rock_item');
    expect(rockInstance.moveToSlot(basketInstance, itemsSlotId)).toBeUndefined();

    const executed = rockInstance.tryGetAction('use', undefined)?.tryExecute() === true;

    expect(executed).toBe(true);
    expect(basketInstance.tryGetProperty(budgetId)?.number ?? 0).toBe(9);
  });

  it('parent対象は親を持たない場合は黙って無視される', () => {
    const yaml = `
object_defs:
  rock_item2:
    actions:
      use:
        destroy: parent
`;
    const codex = load(yaml);
    const rockInstance = spawn(codex, 'rock_item2'); // 親を持たない

    const executed = rockInstance.tryGetAction('use', undefined)?.tryExecute() === true;

    expect(executed, 'アクション自体は実行される(親が無いのでparent対象の適用だけが無視される)').toBe(true);
  });

  it('destroyの対象を、インスタンスIDを持つプロパティで指せる', () => {
    // 定義時点では決まらず実行時に確定する個体を消す形（動物がぶつかって壊す1手、
    // docs/engine/HuntingSystem.md 5節）。指す先が居なければ何も起きない。
    const yaml = `
object_defs:
  ground:
    slots:
      items: {}
  boar:
    props:
      smash_target:
        value: 0
    actions:
      trample:
        destroy: {prop: smash_target}
  basket: {}
`;
    const codex = load(yaml);
    const itemsSlotId = codex.slotNames.getId('items');
    const smashTargetId = codex.propertyNames.getId('smash_target');

    const ground = spawn(codex, 'ground');
    const boar = spawn(codex, 'boar');
    const basket = spawn(codex, 'basket');
    expect(boar.moveToSlot(ground, itemsSlotId)).toBeUndefined();
    expect(basket.moveToSlot(ground, itemsSlotId)).toBeUndefined();

    boar.getProperty(smashTargetId).init(9999);
    expect(boar.tryGetAction('trample', undefined)?.tryExecute() === true).toBe(true);
    expect(basket.parent, '指す先が居なければ何も起きない').toBe(ground);

    boar.getProperty(smashTargetId).init(basket.instanceId);
    expect(boar.tryGetAction('trample', undefined)?.tryExecute() === true).toBe(true);
    expect(basket.parent, 'プロパティが指す個体が消える').toBeUndefined();
  });

  // ------------------------------------------------------------------
  // pick: 重み付き確率分岐
  // ------------------------------------------------------------------

  it('pickの重みが支配的な候補は常に選ばれ続ける', () => {
    const yaml = `
object_defs:
  player3:
    props:
      hp:
        value: 100
  sword:
    actions:
      attack:
        pick:
          - weight: 100
            add:
              actor:
                hp: -10
          - weight: 0
            add:
              actor:
                hp: -9999
`;
    const codex = load(yaml);
    const hpId = codex.propertyNames.getId('hp');

    // weight比が100:0のため、nextDoubleが[0,1)のどんな値でも常に1番目(-10)だけが選ばれる。
    // 「どのpickが選ばれるか」に依存するシナリオなので、StubRngで20回分の値列を明示する。
    const actor = spawn(codex, 'player3');
    const swordInstance = spawn(codex, 'sword');

    for (let i = 0; i < 20; i++) {
      swordInstance.tryGetAction('attack', actor)?.tryExecute();
    }

    expect(
      actor.tryGetProperty(hpId)?.number ?? 0,
      '重み100:0なので常に最初の候補(-10)だけが選ばれ続け、2番目(-9999)は一度も選ばれない',
    ).toBe(100 - 20 * 10);
  });

  it('pathでweightを参照すると、より重い候補が選ばれやすくなる', () => {
    const yaml = `
object_defs:
  player4:
    props:
      hp:
        value: 100
      luck:
        value: 0
  bow:
    actions:
      shoot:
        pick:
          - weight: {subject: actor, prop: luck}
            add:
              actor:
                hp: 1
          - weight: 0
            add:
              actor:
                hp: -1
`;
    const codex = load(yaml);
    const hpId = codex.propertyNames.getId('hp');
    const luckId = codex.propertyNames.getId('luck');

    const actor = spawn(codex, 'player4');
    actor.getProperty(luckId).init(1000); // 2番目(重み0固定)を圧倒する
    const bowInstance = spawn(codex, 'bow');

    bowInstance.tryGetAction('shoot', actor)?.tryExecute();

    expect(
      actor.tryGetProperty(hpId)?.number ?? 0,
      'luck(1000)がweightのpath参照先なので、ほぼ確実に1番目の候補が選ばれる',
    ).toBe(101);
  });

  // ------------------------------------------------------------------
  // combinations: with（タグ）・dragged対象
  // ------------------------------------------------------------------

  it('withがタグにマッチするとselfとdraggedの両方に効果が適用される', () => {
    const yaml = `
object_defs:
  wood:
    combinations:
      chop:
        with: {tag: axe_tool}
        add:
          dragged:
            durability: -1
        destroy: self
  axe_tool:
    tags: [axe_tool]
    props:
      durability:
        value: 10
`;
    const codex = load(yaml);
    const durabilityId = codex.propertyNames.getId('durability');

    const woodInstance = spawn(codex, 'wood');
    const axeInstance = spawn(codex, 'axe_tool');

    const executed =
      woodInstance
        .combinationsWith(axeInstance, undefined)
        .find((c) => c.name === 'chop')
        ?.tryExecute() === true;

    expect(executed).toBe(true);
    expect(woodInstance.parent, 'self(wood)はdestroyされる').toBeUndefined();
    expect(axeInstance.tryGetProperty(durabilityId)?.number ?? 0).toBe(9);
  });

  it('dragged_parentは対象キーとして使えない', () => {
    const yaml = `
object_defs:
  lever:
    combinations:
      operate:
        with: {tag: marker_tag}
        add:
          dragged_parent:
            power: 3
  marker:
    tags: [marker_tag]
`;
    expect(() => load(yaml)).toThrowError(/未知の対象キー/);
  });

  it('タグが一致しないdraggedに対してはfalseを返す', () => {
    const yaml = `
object_defs:
  wood2:
    combinations:
      chop:
        with: {tag: axe_tool2}
        destroy: self
  pebble3: {}
`;
    const codex = load(yaml);
    const woodInstance = spawn(codex, 'wood2');
    const pebbleInstance = spawn(codex, 'pebble3');

    const executed =
      woodInstance
        .combinationsWith(pebbleInstance, undefined)
        .find((c) => c.name === 'chop')
        ?.tryExecute() === true;

    expect(executed, 'draggedがwithのタグを持たないため実行されない').toBe(false);
  });

  it('trait経由で得たタグでもwithにマッチして効果が適用される', () => {
    const yaml = `
traits:
  sharp_tool: {tags: [sharp_tool]}
object_defs:
  wood3:
    combinations:
      chop:
        with: {tag: sharp_tool}
        destroy: self
  axe_tool3:
    traits: [sharp_tool]
`;
    const codex = load(yaml);
    const woodInstance = spawn(codex, 'wood3');
    const axeInstance = spawn(codex, 'axe_tool3');

    const executed =
      woodInstance
        .combinationsWith(axeInstance, undefined)
        .find((c) => c.name === 'chop')
        ?.tryExecute() === true;

    expect(executed, "object_def自身のidではなく、参照したtrait経由で得た'sharp_tool'タグでマッチする").toBe(
      true,
    );
  });

  it('withをobjectで書くと、その型そのものだけがマッチする', () => {
    const yaml = `
object_defs:
  hearth2:
    combinations:
      ignite:
        with: {object: burning_tinder2}
        destroy: dragged
  burning_tinder2:
    tags: [tinder2]
  dry_grass2:
    tags: [tinder2]
`;
    const codex = load(yaml);
    const hearthInstance = spawn(codex, 'hearth2');
    const tinderInstance = spawn(codex, 'burning_tinder2');
    const grassInstance = spawn(codex, 'dry_grass2');

    expect(
      hearthInstance
        .combinationsWith(grassInstance, undefined)
        .find((c) => c.name === 'ignite')
        ?.tryExecute() === true,
      '同じタグを持っていても、別の型はマッチしない',
    ).toBe(false);
    expect(
      hearthInstance
        .combinationsWith(tinderInstance, undefined)
        .find((c) => c.name === 'ignite')
        ?.tryExecute() === true,
    ).toBe(true);
    expect(tinderInstance.parent, 'destroy: draggedが適用される').toBeUndefined();
  });

  it('マッチするcombination検索はdraggedにマッチするものだけを返す', () => {
    const yaml = `
object_defs:
  wood4:
    combinations:
      chop:
        with: {tag: axe_tool4}
      sand:
        with: {tag: sandpaper}
  axe_tool4:
    tags: [axe_tool4]
`;
    const codex = load(yaml);
    const woodInstance = spawn(codex, 'wood4');
    const axeInstance = spawn(codex, 'axe_tool4');

    const matches = woodInstance.combinationsWith(axeInstance, undefined);

    expect(matches.map((c) => c.name)).toEqual(['chop']);
  });

  it('combinationのconditionsはdraggedを参照できる', () => {
    const yaml = `
object_defs:
  wood5:
    combinations:
      chop:
        with: {tag: axe_tool5}
        conditions:
          - {subject: dragged, prop: durability, gt: 0}
        destroy: self
  axe_tool5:
    tags: [axe_tool5]
    props:
      durability:
        value: 0
`;
    const codex = load(yaml);
    const durabilityId = codex.propertyNames.getId('durability');

    const woodInstance = spawn(codex, 'wood5');
    const axeInstance = spawn(codex, 'axe_tool5');

    expect(
      woodInstance
        .combinationsWith(axeInstance, undefined)
        .find((c) => c.name === 'chop')
        ?.tryExecute() === true,
      'durabilityが0(gt 0を満たさない)なので実行されない',
    ).toBe(false);

    axeInstance.getProperty(durabilityId).init(1);
    expect(
      woodInstance
        .combinationsWith(axeInstance, undefined)
        .find((c) => c.name === 'chop')
        ?.tryExecute() === true,
    ).toBe(true);
  });
});
