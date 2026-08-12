import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { StubRng } from '../support/StubRng';

describe('WorldObjectのactions/combinations実行', () => {
  let nextInstanceId: number;

  beforeEach(() => {
    nextInstanceId = 1;
  });

  function load(yaml: string): WorldCodex {
    return new WorldCodexYamlLoader().load('core.yaml', yaml).build();
  }

  function spawn(codex: WorldCodex, objectName: string): WorldObject {
    const def = codex.objects.get(codex.objectNames.getId(objectName));
    return new WorldObject(nextInstanceId++, def, new WorldSession(codex));
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

    const session = new WorldSession(codex);
    const actor = spawn(codex, 'player');
    const appleInstance = spawn(codex, 'apple');

    const executed = appleInstance.tryExecuteAction('eat', actor, session);

    expect(executed).toBe(true);
    expect(actor.getNumber(satietyId)).toBe(10);
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
          - {object: actor, prop: satiety, lt: 100}
        add:
          actor:
            satiety: 10
`;
    const codex = load(yaml);
    const satietyId = codex.propertyNames.getId('satiety');

    const session = new WorldSession(codex);
    const actor = spawn(codex, 'player2');
    const appleInstance = spawn(codex, 'apple2');

    const executed = appleInstance.tryExecuteAction('eat', actor, session);

    expect(executed, 'satietyが既に100(<100を満たさない)のため実行されない').toBe(false);
    expect(actor.getNumber(satietyId), '条件を満たさないため何も変化しない').toBe(100);
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

    const session = new WorldSession(codex);
    const crate = spawn(codex, 'crate');

    const executed = crate.tryExecuteAction('open', undefined, session);

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

    const session = new WorldSession(codex);
    const appleInstance = spawn(codex, 'apple3');

    expect(appleInstance.tryExecuteAction('does_not_exist', undefined, session)).toBe(false);
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

    const session = new WorldSession(codex);
    const basketInstance = spawn(codex, 'basket');
    const rockInstance = spawn(codex, 'rock_item');
    expect(rockInstance.moveToSlot(basketInstance, itemsSlotId)).toBeUndefined();

    const executed = rockInstance.tryExecuteAction('use', undefined, session);

    expect(executed).toBe(true);
    expect(basketInstance.getNumber(budgetId)).toBe(9);
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
    const session = new WorldSession(codex);
    const rockInstance = spawn(codex, 'rock_item2'); // 親を持たない

    const executed = rockInstance.tryExecuteAction('use', undefined, session);

    expect(executed, 'アクション自体は実行される(親が無いのでparent対象の適用だけが無視される)').toBe(true);
  });

  it('represented_by先の中身がある場合はそちらへ委譲される', () => {
    const yaml = `
object_defs:
  player_repr:
    props:
      satiety:
        value: 0
  snack_container:
    represented_by: content
    slots:
      content:
        cell: {accept: {tag: edible}}
  apple_slice:
    tags: [edible]
    actions:
      eat:
        add:
          actor:
            satiety: 10
`;
    const codex = load(yaml);
    const satietyId = codex.propertyNames.getId('satiety');
    const contentSlotId = codex.slotNames.getId('content');

    const session = new WorldSession(codex);
    const actor = spawn(codex, 'player_repr');
    const container = spawn(codex, 'snack_container');
    const slice = spawn(codex, 'apple_slice');
    expect(slice.moveToSlot(container, contentSlotId)).toBeUndefined();

    const executed = container.tryExecuteAction('eat', actor, session);

    expect(executed).toBe(true);
    expect(actor.getNumber(satietyId)).toBe(10);
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
    const session = new WorldSession(codex, undefined, new StubRng({ doubles: Array(20).fill(0.5) }));
    const actor = spawn(codex, 'player3');
    const swordInstance = spawn(codex, 'sword');

    for (let i = 0; i < 20; i++) {
      swordInstance.tryExecuteAction('attack', actor, session);
    }

    expect(
      actor.getNumber(hpId),
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
          - weight: {object: actor, prop: luck}
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

    const session = new WorldSession(codex);
    const actor = spawn(codex, 'player4');
    actor.setProperty(luckId, 1000); // 2番目(重み0固定)を圧倒する
    const bowInstance = spawn(codex, 'bow');

    bowInstance.tryExecuteAction('shoot', actor, session);

    expect(
      actor.getNumber(hpId),
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
        with: axe_tool
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

    const session = new WorldSession(codex);
    const woodInstance = spawn(codex, 'wood');
    const axeInstance = spawn(codex, 'axe_tool');

    const executed = woodInstance.tryExecuteCombination(axeInstance, undefined, 'chop', session);

    expect(executed).toBe(true);
    expect(woodInstance.parent, 'self(wood)はdestroyされる').toBeUndefined();
    expect(axeInstance.getNumber(durabilityId)).toBe(9);
  });

  it('dragged_parentは対象キーとして使えない', () => {
    const yaml = `
object_defs:
  lever:
    combinations:
      operate:
        with: marker_tag
        add:
          dragged_parent:
            power: 3
  marker:
    tags: [marker_tag]
`;
    expect(() => load(yaml)).toThrowError(/未知の対象キー/);
  });

  it('receiver/draggedの両方が代表(represented_by)の中身へ委譲される', () => {
    const yaml = `
traits:
  liquid_container:
    represented_by: content
    slots:
      content:
        cell_count: 1
        cell: {accept: {tag: liquid}}
object_defs:
  receiver:
    traits: [liquid_container]
  source:
    traits: [liquid_container]
  water_liquid:
    tags: [liquid, water_liquid]
    props:
      amount:
        value: 0
    combinations:
      pour_in:
        with: water_liquid
        add:
          self:
            amount: 2
          dragged:
            amount: -2
`;
    const codex = load(yaml);
    const contentSlotId = codex.slotNames.getId('content');
    const amountId = codex.propertyNames.getId('amount');

    const session = new WorldSession(codex);
    const receiver = spawn(codex, 'receiver');
    const source = spawn(codex, 'source');
    const receiverLiquid = spawn(codex, 'water_liquid');
    const sourceLiquid = spawn(codex, 'water_liquid');
    receiverLiquid.setProperty(amountId, 1);
    sourceLiquid.setProperty(amountId, 5);
    expect(receiverLiquid.moveToSlot(receiver, contentSlotId)).toBeUndefined();
    expect(sourceLiquid.moveToSlot(source, contentSlotId)).toBeUndefined();

    const executed = receiver.tryExecuteCombination(source, undefined, 'pour_in', session);

    expect(executed).toBe(true);
    expect(receiverLiquid.getNumber(amountId)).toBe(3);
    expect(sourceLiquid.getNumber(amountId)).toBe(3);
  });

  it('マッチするcombination検索も代表(represented_by)の中身を使う', () => {
    const yaml = `
traits:
  liquid_container:
    represented_by: content
    slots:
      content:
        cell_count: 1
        cell: {accept: {tag: liquid}}
object_defs:
  receiver2:
    traits: [liquid_container]
  source2:
    traits: [liquid_container]
  water_liquid2:
    tags: [liquid, water_liquid2]
    combinations:
      pour_in:
        with: water_liquid2
        destroy: self
`;
    const codex = load(yaml);
    const contentSlotId = codex.slotNames.getId('content');

    const receiver = spawn(codex, 'receiver2');
    const source = spawn(codex, 'source2');
    expect(spawn(codex, 'water_liquid2').moveToSlot(receiver, contentSlotId)).toBeUndefined();
    expect(spawn(codex, 'water_liquid2').moveToSlot(source, contentSlotId)).toBeUndefined();
    const names = receiver.findMatchingCombinations(source).map((c) => c.name);
    expect(names).toEqual(['pour_in']);
  });

  it('タグが一致しないdraggedに対してはfalseを返す', () => {
    const yaml = `
object_defs:
  wood2:
    combinations:
      chop:
        with: axe_tool2
        destroy: self
  pebble3: {}
`;
    const codex = load(yaml);
    const session = new WorldSession(codex);
    const woodInstance = spawn(codex, 'wood2');
    const pebbleInstance = spawn(codex, 'pebble3');

    const executed = woodInstance.tryExecuteCombination(pebbleInstance, undefined, 'chop', session);

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
        with: sharp_tool
        destroy: self
  axe_tool3:
    traits: [sharp_tool]
`;
    const codex = load(yaml);
    const session = new WorldSession(codex);
    const woodInstance = spawn(codex, 'wood3');
    const axeInstance = spawn(codex, 'axe_tool3');

    const executed = woodInstance.tryExecuteCombination(axeInstance, undefined, 'chop', session);

    expect(executed, "object_def自身のidではなく、参照したtrait経由で得た'sharp_tool'タグでマッチする").toBe(
      true,
    );
  });

  it('マッチするcombination検索はdraggedにマッチするものだけを返す', () => {
    const yaml = `
object_defs:
  wood4:
    combinations:
      chop:
        with: axe_tool4
      sand:
        with: sandpaper
  axe_tool4:
    tags: [axe_tool4]
`;
    const codex = load(yaml);
    const woodInstance = spawn(codex, 'wood4');
    const axeInstance = spawn(codex, 'axe_tool4');

    const matches = woodInstance.findMatchingCombinations(axeInstance);

    expect(matches.map((c) => c.name)).toEqual(['chop']);
  });

  it('combinationのconditionsはdraggedを参照できる', () => {
    const yaml = `
object_defs:
  wood5:
    combinations:
      chop:
        with: axe_tool5
        conditions:
          - {object: dragged, prop: durability, gt: 0}
        destroy: self
  axe_tool5:
    tags: [axe_tool5]
    props:
      durability:
        value: 0
`;
    const codex = load(yaml);
    const durabilityId = codex.propertyNames.getId('durability');

    const session = new WorldSession(codex);
    const woodInstance = spawn(codex, 'wood5');
    const axeInstance = spawn(codex, 'axe_tool5');

    expect(
      woodInstance.tryExecuteCombination(axeInstance, undefined, 'chop', session),
      'durabilityが0(gt 0を満たさない)なので実行されない',
    ).toBe(false);

    axeInstance.setProperty(durabilityId, 1);
    expect(woodInstance.tryExecuteCombination(axeInstance, undefined, 'chop', session)).toBe(true);
  });
});
