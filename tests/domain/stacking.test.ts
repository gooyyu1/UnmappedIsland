import { beforeEach, describe, expect, it } from 'vitest';
import type { ObjectStack } from '../../src/domain/runtime/ObjectStack';
import type { Slot } from '../../src/domain/runtime/Slot';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

// アイテムのスタック表示（Slot.contentsの並び順・SlotDefのstackable/unitCapacity/fixedPositions・
// ObjectDef.stackOrder・same_slotとの相互作用）に対する自動テスト。
describe('StackingTests', () => {
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

  // テスト補助: 固定スロット内で、指定した型(ObjectDef)のアイテムを持つスタックとその番号を引く。
  // 素の型（represented_by無し＝1型1スタック）のテスト専用。スタック側のDefではなく各メンバーの
  // Def(WorldObject.def)で引くのであって、外側Def一致で位置を決めているわけではない。
  function stackOfType(slot: Slot, objectDefGlobalId: number): ObjectStack | undefined {
    return slot.cells.find((s) => s !== undefined && s.members[0].def.globalId === objectDefGlobalId);
  }

  function gridIndexOfType(slot: Slot, objectDefGlobalId: number): number | undefined {
    const stack = stackOfType(slot, objectDefGlobalId);
    return stack !== undefined ? slot.indexOfStack(stack) : undefined;
  }

  // ------------------------------------------------------------------
  // ObjectDef.stackOrder: 同種のrun内で「手前に重ねたいものほど末尾」に並ぶこと
  // ------------------------------------------------------------------

  it('AddInternalは同種のrun内で、優先度の高いものほど末尾（手前）に来るよう並べる', () => {
    const yaml = `
object_defs:
  ground:
    slots:
      pile: {}
  log:
    props:
      life:
        value: 0
    # 寿命(life)が短いものほど末尾(=手前に重なる)にしたいので ascending: false
    stack_order:
      property: life
      ascending: false
`;
    const codex = load(yaml);
    const lifeId = codex.propertyNames.getId('life');
    const pileSlotId = codex.slotNames.getId('pile');

    const groundInstance = spawn(codex, 'ground');

    const log10 = spawn(codex, 'log');
    log10.setProperty(lifeId, 10);
    const log5 = spawn(codex, 'log');
    log5.setProperty(lifeId, 5);
    const log20 = spawn(codex, 'log');
    log20.setProperty(lifeId, 20);

    log10.moveToSlot(groundInstance, pileSlotId, codex.wellKnown);
    log5.moveToSlot(groundInstance, pileSlotId, codex.wellKnown);
    log20.moveToSlot(groundInstance, pileSlotId, codex.wellKnown);

    const pile = groundInstance.tryGetSlot(pileSlotId)!;

    expect(
      pile.contents.map((o) => o.instanceId),
      'life値の大きい順(20,10,5)に並び、最も寿命が短い(5)が末尾(=手前)に来る',
    ).toEqual([log20.instanceId, log10.instanceId, log5.instanceId]);
  });

  it('getStacksは連続する同種のrunをまとめてグループ化する', () => {
    const yaml = `
object_defs:
  ground2:
    slots:
      pile: {}
  wood: {}
  rock: {}
`;
    const codex = load(yaml);
    const pileSlotId = codex.slotNames.getId('pile');

    const groundInstance = spawn(codex, 'ground2');
    const wood1 = spawn(codex, 'wood');
    const wood2 = spawn(codex, 'wood');
    const rock1 = spawn(codex, 'rock');

    wood1.moveToSlot(groundInstance, pileSlotId, codex.wellKnown);
    wood2.moveToSlot(groundInstance, pileSlotId, codex.wellKnown);
    rock1.moveToSlot(groundInstance, pileSlotId, codex.wellKnown);

    const pile = groundInstance.tryGetSlot(pileSlotId)!;
    const stacks = pile.cells;

    expect(stacks).toHaveLength(2);
    expect(stacks[0]!.members[0].def.name).toBe('wood');
    expect(stacks[0]!.members).toHaveLength(2);
    expect(stacks[1]!.members[0].def.name).toBe('rock');
    expect(stacks[1]!.members).toHaveLength(1);
  });

  // ------------------------------------------------------------------
  // same_slot とリスト順の関係
  // ------------------------------------------------------------------

  it('same_slot+destroyは、異なる型の間でも元の位置をそのまま置き換える', () => {
    const yaml = `
object_defs:
  loc_abc:
    slots:
      pile: {}
  a_item: {}
  c_item: {}
  d_item: {}
  b_item:
    props:
      life:
        value: 0
        range: {min: 1, max: 2147483647}
        on_shortfall:
          destroy: self
          spawn:
            object: d_item
            into: same_slot
`;
    const codex = load(yaml);
    const pileSlotId = codex.slotNames.getId('pile');

    const session = new WorldSession(codex);
    const locInstance = spawn(codex, 'loc_abc');
    const aInstance = spawn(codex, 'a_item');
    const bInstance = spawn(codex, 'b_item');
    const cInstance = spawn(codex, 'c_item');

    aInstance.moveToSlot(locInstance, pileSlotId, session.codex.wellKnown);
    bInstance.moveToSlot(locInstance, pileSlotId, session.codex.wellKnown);
    cInstance.moveToSlot(locInstance, pileSlotId, session.codex.wellKnown);

    locInstance.tick(session);

    const pile = locInstance.tryGetSlot(pileSlotId)!;
    expect(
      pile.contents.map((o) => o.def.name),
      'A B C の B が D に置き換わっても A・C の位置はずれず、A D C になる',
    ).toEqual(['a_item', 'd_item', 'c_item']);
  });

  it('same_slot+destroyは、スタック内の位置もそのまま置き換える', () => {
    const yaml = `
object_defs:
  loc_abbc:
    slots:
      pile: {}
  a_item2: {}
  c_item2: {}
  d_item2: {}
  b_item2:
    props:
      life:
        value: 0
        range: {min: 1, max: 2147483647}
        on_shortfall:
          destroy: self
          spawn:
            object: d_item2
            into: same_slot
`;
    const codex = load(yaml);
    const pileSlotId = codex.slotNames.getId('pile');
    const lifeId = codex.propertyNames.getId('life');

    const session = new WorldSession(codex);
    const locInstance = spawn(codex, 'loc_abbc');
    const aInstance = spawn(codex, 'a_item2');
    const bInstance1 = spawn(codex, 'b_item2'); // 生き残る方
    const bInstance2 = spawn(codex, 'b_item2'); // life=0 になり置き換わる方
    const cInstance = spawn(codex, 'c_item2');

    aInstance.moveToSlot(locInstance, pileSlotId, session.codex.wellKnown);
    bInstance1.moveToSlot(locInstance, pileSlotId, session.codex.wellKnown);
    bInstance2.moveToSlot(locInstance, pileSlotId, session.codex.wellKnown);
    cInstance.moveToSlot(locInstance, pileSlotId, session.codex.wellKnown);

    // bInstance1 は on_shortfall が発火しないよう life を残す（bInstance2 のみ 0 のまま）。
    bInstance1.setProperty(lifeId, 5);

    locInstance.tick(session);

    const pile = locInstance.tryGetSlot(pileSlotId)!;
    expect(
      pile.contents.map((o) => o.def.name),
      'A B B C の(末尾側の)Bが D に置き換わると、残るBの位置はそのままで A B D C になる',
    ).toEqual(['a_item2', 'b_item2', 'd_item2', 'c_item2']);
  });

  it('same_slot（destroyなし）は自分の直後にそのまま挿入する', () => {
    const yaml = `
object_defs:
  loc_grow:
    slots:
      pile: {}
  a_item3: {}
  c_item3: {}
  d_item3: {}
  b_item3:
    props:
      life:
        value: 0
        range: {min: 1, max: 2147483647}
        on_shortfall:
          spawn:
            object: d_item3
            into: same_slot
`;
    const codex = load(yaml);
    const pileSlotId = codex.slotNames.getId('pile');

    const session = new WorldSession(codex);
    const locInstance = spawn(codex, 'loc_grow');
    const aInstance = spawn(codex, 'a_item3');
    const bInstance = spawn(codex, 'b_item3');
    const cInstance = spawn(codex, 'c_item3');

    aInstance.moveToSlot(locInstance, pileSlotId, session.codex.wellKnown);
    bInstance.moveToSlot(locInstance, pileSlotId, session.codex.wellKnown);
    cInstance.moveToSlot(locInstance, pileSlotId, session.codex.wellKnown);

    locInstance.tick(session);

    const pile = locInstance.tryGetSlot(pileSlotId)!;
    expect(
      pile.contents.map((o) => o.def.name),
      'destroyを伴わない場合、Bは残ったまま、DはBの直後に入る(A B D C)',
    ).toEqual(['a_item3', 'b_item3', 'd_item3', 'c_item3']);
    expect(bInstance.parent, 'destroy: falseなのでB自身は破棄されない').not.toBeUndefined();
  });

  it('same_slotは、同種の既存スタックがあれば位置指定より合流を優先する', () => {
    const yaml = `
object_defs:
  loc_merge:
    slots:
      pile: {}
  a_item4: {}
  d_item4: {}
  b_item4:
    props:
      life:
        value: 0
        range: {min: 1, max: 2147483647}
        on_shortfall:
          destroy: self
          spawn:
            object: d_item4
            into: same_slot
`;
    const codex = load(yaml);
    const pileSlotId = codex.slotNames.getId('pile');

    const session = new WorldSession(codex);
    const locInstance = spawn(codex, 'loc_merge');

    // D A B の並びで、Bが置き換わって生まれるDは、Bが居た位置ではなく既にあるDのスタックへ入る。
    spawn(codex, 'd_item4').moveToSlot(locInstance, pileSlotId, session.codex.wellKnown);
    spawn(codex, 'a_item4').moveToSlot(locInstance, pileSlotId, session.codex.wellKnown);
    spawn(codex, 'b_item4').moveToSlot(locInstance, pileSlotId, session.codex.wellKnown);

    locInstance.tick(session);

    const pile = locInstance.tryGetSlot(pileSlotId)!;
    expect(
      pile.cells.map((c) => c?.members.map((o) => o.def.name)),
      'Dは2個で1スタックのまま、新しいスタックは生まれない',
    ).toEqual([['d_item4', 'd_item4'], ['a_item4']]);
  });

  // ------------------------------------------------------------------
  // UnitCapacity / Stackable（かまど型: 非スタック・個数固定）
  // ------------------------------------------------------------------

  it('unitCapacity+stackableは、異なる型の種類数だけを制限し合計個数は制限しない', () => {
    const yaml = `
object_defs:
  hand_owner:
    slots:
      hand:
        stackable: true
        unit_capacity: 2
  apple_h: {}
  pebble_h: {}
  twig_h: {}
`;
    const codex = load(yaml);
    const handSlotId = codex.slotNames.getId('hand');

    const handInstance = spawn(codex, 'hand_owner');

    const apple1 = spawn(codex, 'apple_h');
    const apple2 = spawn(codex, 'apple_h');
    const pebble1 = spawn(codex, 'pebble_h');
    const twig1 = spawn(codex, 'twig_h');

    expect(apple1.moveToSlot(handInstance, handSlotId, codex.wellKnown)).toBeUndefined();
    expect(
      apple2.moveToSlot(handInstance, handSlotId, codex.wellKnown),
      '同種の追加はunit_capacityの種類数を消費しない',
    ).toBeUndefined();
    expect(pebble1.moveToSlot(handInstance, handSlotId, codex.wellKnown)).toBeUndefined();
    expect(
      twig1.moveToSlot(handInstance, handSlotId, codex.wellKnown),
      '3種類目はunit_capacity(2)を超えるため拒否される',
    ).toBeDefined();
  });

  it('unitCapacity+非stackableは、同じ型でも個体ごとの個数を制限する', () => {
    const yaml = `
object_defs:
  furnace:
    slots:
      intake:
        stackable: false
        unit_capacity: 2
  fuel: {}
`;
    const codex = load(yaml);
    const intakeSlotId = codex.slotNames.getId('intake');

    const furnaceInstance = spawn(codex, 'furnace');
    const fuel1 = spawn(codex, 'fuel');
    const fuel2 = spawn(codex, 'fuel');
    const fuel3 = spawn(codex, 'fuel');

    expect(fuel1.moveToSlot(furnaceInstance, intakeSlotId, codex.wellKnown)).toBeUndefined();
    expect(
      fuel2.moveToSlot(furnaceInstance, intakeSlotId, codex.wellKnown),
      '非stackableは同種でも個体ごとに枠を消費する',
    ).toBeUndefined();
    expect(
      fuel3.moveToSlot(furnaceInstance, intakeSlotId, codex.wellKnown),
      '同種であっても個数がunit_capacity(2)を超えるため3個目は拒否される',
    ).toBeDefined();
  });

  // ------------------------------------------------------------------
  // FixedPositions（プレイヤー手持ち: 前詰めしない固定番号）
  // ------------------------------------------------------------------

  it('fixedPositionsは空いている最小番号を割り当て、削除時も空きをそのまま残す', () => {
    const yaml = `
object_defs:
  hand_owner2:
    slots:
      hand:
        stackable: true
        unit_capacity: 3
        fixed_positions: true
  type_a: {}
  type_b: {}
  type_c: {}
`;
    const codex = load(yaml);
    const handSlotId = codex.slotNames.getId('hand');
    const typeAId = codex.objectNames.getId('type_a');
    const typeBId = codex.objectNames.getId('type_b');
    const typeCId = codex.objectNames.getId('type_c');

    const handInstance = spawn(codex, 'hand_owner2');
    const a = spawn(codex, 'type_a');
    const b = spawn(codex, 'type_b');

    a.moveToSlot(handInstance, handSlotId, codex.wellKnown);
    b.moveToSlot(handInstance, handSlotId, codex.wellKnown);

    const hand2 = handInstance.tryGetSlot(handSlotId)!;
    expect(gridIndexOfType(hand2, typeAId)).toBe(0);
    expect(gridIndexOfType(hand2, typeBId)).toBe(1);

    a.destroy(); // 0番が空く

    const c = spawn(codex, 'type_c');
    c.moveToSlot(handInstance, handSlotId, codex.wellKnown);

    expect(gridIndexOfType(hand2, typeBId), '既存の型は前詰めされず番号を維持する').toBe(1);
    expect(gridIndexOfType(hand2, typeCId), '新しい型は空いている最小番号(0)へ入る').toBe(0);
  });

  it('fixedPositionsのtrySetManualPositionは2つの型を入れ替える', () => {
    const yaml = `
object_defs:
  hand_owner3:
    slots:
      hand:
        stackable: true
        unit_capacity: 3
        fixed_positions: true
  type_a2: {}
  type_b2: {}
`;
    const codex = load(yaml);
    const handSlotId = codex.slotNames.getId('hand');
    const typeAId = codex.objectNames.getId('type_a2');
    const typeBId = codex.objectNames.getId('type_b2');

    const handInstance = spawn(codex, 'hand_owner3');
    const a = spawn(codex, 'type_a2');
    const b = spawn(codex, 'type_b2');

    a.moveToSlot(handInstance, handSlotId, codex.wellKnown);
    b.moveToSlot(handInstance, handSlotId, codex.wellKnown);

    const hand3 = handInstance.tryGetSlot(handSlotId)!;

    expect(hand3.trySetManualPosition(stackOfType(hand3, typeAId)!, 1)).toBe(true);
    expect(gridIndexOfType(hand3, typeAId)).toBe(1);
    expect(gridIndexOfType(hand3, typeBId), '入れ替え先の型は元のtypeAの番号へ移る').toBe(0);
  });

  it('fixedPositions+same_slotは、唯一のインスタンスが置き換わる場合に空いた固定番号を引き継ぐ', () => {
    // potatoを「0番以外」（1番）に置き、置き換えの瞬間に0番が別途空いている状態を作る。
    // これにより、「元々の空き最小番号(0)」と「引き継いだ番号(1)」が異なる値になり、
    // 引き継ぎが実際に機能しているかどうかを区別できる（両方0番なら偶然の一致で検証にならない）。
    const yaml = `
object_defs:
  hand_owner4:
    slots:
      hand:
        stackable: true
        unit_capacity: 3
        fixed_positions: true
  filler_item: {}
  rotten_potato: {}
  potato:
    props:
      freshness:
        value: 0
        range: {min: 1, max: 2147483647}
        on_shortfall:
          destroy: self
          spawn:
            object: rotten_potato
            into: same_slot
`;
    const codex = load(yaml);
    const handSlotId = codex.slotNames.getId('hand');
    const rottenId = codex.objectNames.getId('rotten_potato');

    const session = new WorldSession(codex);
    const handInstance = spawn(codex, 'hand_owner4');
    const fillerInstance = spawn(codex, 'filler_item'); // 0番を先に占有
    const potatoInstance = spawn(codex, 'potato'); // 1番に入る

    fillerInstance.moveToSlot(handInstance, handSlotId, session.codex.wellKnown);
    potatoInstance.moveToSlot(handInstance, handSlotId, session.codex.wellKnown);
    fillerInstance.destroy(); // 0番が空く（1番=potatoとは別に）

    const hand4 = handInstance.tryGetSlot(handSlotId)!;
    const potatoGridIndex = gridIndexOfType(hand4, codex.objectNames.getId('potato'))!;
    expect(potatoGridIndex, '前提: potatoは1番のまま（0番が空いても前詰めされない）').toBe(1);

    handInstance.tick(session);

    expect(
      gridIndexOfType(hand4, rottenId),
      '唯一のインスタンスが置き換わる場合、固定番号(1番)はそのまま新しい型へ引き継がれる' +
        '（空き最小番号である0番を新規に割り当てられるのではない）',
    ).toBe(potatoGridIndex);
  });

  it('fixedPositions+same_slotは、同種が他に残っている場合は固定番号を引き継がない', () => {
    const yaml = `
object_defs:
  hand_owner5:
    slots:
      hand:
        stackable: true
        unit_capacity: 3
        fixed_positions: true
  rotten_potato2: {}
  potato2:
    props:
      freshness:
        value: 0
        range: {min: 1, max: 2147483647}
        on_shortfall:
          destroy: self
          spawn:
            object: rotten_potato2
            into: same_slot
`;
    const codex = load(yaml);
    const handSlotId = codex.slotNames.getId('hand');
    const potatoId = codex.objectNames.getId('potato2');
    const rottenId = codex.objectNames.getId('rotten_potato2');
    const freshnessId = codex.propertyNames.getId('freshness');

    const session = new WorldSession(codex);
    const handInstance = spawn(codex, 'hand_owner5');
    const potato1 = spawn(codex, 'potato2'); // freshness=5のまま生き残る方
    const potato2 = spawn(codex, 'potato2'); // freshness=0のまま置き換わる方

    potato1.moveToSlot(handInstance, handSlotId, session.codex.wellKnown);
    potato2.moveToSlot(handInstance, handSlotId, session.codex.wellKnown);
    potato1.setProperty(freshnessId, 5);

    const hand5 = handInstance.tryGetSlot(handSlotId)!;
    const potatoGridIndex = gridIndexOfType(hand5, potatoId)!;

    handInstance.tick(session);

    expect(gridIndexOfType(hand5, potatoId), '残ったpotatoの番号は変わらない').toBe(potatoGridIndex);
    expect(
      gridIndexOfType(hand5, rottenId),
      '同種が残っている場合、新しい型は別の固定番号を新規に割り当てられる',
    ).not.toBe(potatoGridIndex);
  });

  it('fixedPositions+same_slot（destroyなし）は自分の直後へ挿入し、必要に応じて後続を押し出す', () => {
    // 「A _ B _」→ Aから(destroyなしで)Cが生まれる → 「A C B _」
    //           → Aから(destroyなしで)Dが生まれる → 「A D C B」（CとBがそれぞれ+1される）
    //           → Aから(destroyなしで)Eが生まれる → 入る場所が無いのでfallback
    const yaml = `
object_defs:
  hand_owner6:
    slots:
      hand:
        stackable: true
        unit_capacity: 4
        fixed_positions: true
  loc_fallback:
    slots:
      ground: {}
  type_b3: {}
  type_c3: {}
  type_d3: {}
  type_e3: {}
  type_a3:
    props:
      spawn_c:
        value: 1
        range: {min: 1, max: 2147483647}
        on_shortfall:
          spawn:
            object: type_c3
            into: same_slot
      spawn_d:
        value: 1
        range: {min: 1, max: 2147483647}
        on_shortfall:
          spawn:
            object: type_d3
            into: same_slot
      spawn_e:
        value: 1
        range: {min: 1, max: 2147483647}
        on_shortfall:
          spawn:
            object: type_e3
            into: same_slot
`;
    const codex = load(yaml);
    const handSlotId = codex.slotNames.getId('hand');
    const groundSlotId = codex.slotNames.getId('ground');
    const spawnCId = codex.propertyNames.getId('spawn_c');
    const spawnDId = codex.propertyNames.getId('spawn_d');
    const spawnEId = codex.propertyNames.getId('spawn_e');
    const aTypeId = codex.objectNames.getId('type_a3');
    const bTypeId = codex.objectNames.getId('type_b3');
    const cTypeId = codex.objectNames.getId('type_c3');
    const dTypeId = codex.objectNames.getId('type_d3');

    const session = new WorldSession(codex);
    const locationInstance = spawn(codex, 'loc_fallback');
    const handInstance = spawn(codex, 'hand_owner6');
    handInstance.moveToSlot(locationInstance, groundSlotId, session.codex.wellKnown);

    const aInstance = spawn(codex, 'type_a3');
    const bInstance = spawn(codex, 'type_b3');
    aInstance.moveToSlot(handInstance, handSlotId, session.codex.wellKnown); // grid 0
    bInstance.moveToSlot(handInstance, handSlotId, session.codex.wellKnown); // grid 1

    const hand6 = handInstance.tryGetSlot(handSlotId)!;
    expect(gridIndexOfType(hand6, aTypeId)).toBe(0);
    expect(
      gridIndexOfType(hand6, bTypeId),
      '前提: A(0) _ B(1)... ではなくA(0) B(1)の状態からBを2番へ動かす',
    ).toBe(1);

    // 前提を「A _ B _」（A=0, B=2）に合わせるため、Bを手動で2番へ動かす。
    expect(hand6.trySetManualPosition(stackOfType(hand6, bTypeId)!, 2)).toBe(true);
    expect(gridIndexOfType(hand6, bTypeId)).toBe(2);

    // --- Cが生まれる: 期待 A(0) C(1) B(2) _(3) ---
    aInstance.setProperty(spawnCId, 0);
    handInstance.tick(session);
    aInstance.setProperty(spawnCId, 1); // 再発火を防ぐ

    expect(gridIndexOfType(hand6, aTypeId)).toBe(0);
    expect(gridIndexOfType(hand6, cTypeId), '空いている1番へそのまま入る（ずれ無し）').toBe(1);
    expect(gridIndexOfType(hand6, bTypeId), 'Bの番号は変わらない').toBe(2);

    // --- Dが生まれる: 期待 A(0) D(1) C(2) B(3) ---
    aInstance.setProperty(spawnDId, 0);
    handInstance.tick(session);
    aInstance.setProperty(spawnDId, 1);

    expect(gridIndexOfType(hand6, aTypeId)).toBe(0);
    expect(gridIndexOfType(hand6, dTypeId), 'Dは1番に割り込む').toBe(1);
    expect(gridIndexOfType(hand6, cTypeId), 'Cは押し出されて2番になる').toBe(2);
    expect(gridIndexOfType(hand6, bTypeId), 'Bも押し出されて3番になる').toBe(3);

    const handAfterD = handInstance.tryGetSlot(handSlotId)!;
    expect(
      handAfterD.contents.map((o) => o.def.name),
      'Contentsの並び順もA D C Bになっている',
    ).toEqual(['type_a3', 'type_d3', 'type_c3', 'type_b3']);

    // --- Eが生まれる: 4枠すべて埋まっており入る場所が無いのでfallback ---
    aInstance.setProperty(spawnEId, 0);
    handInstance.tick(session);

    expect(
      hand6.contents.some((o) => o.def.name === 'type_e3'),
      'handには入らない',
    ).toBe(false);
    const ground = locationInstance.tryGetSlot(groundSlotId)!;
    expect(
      ground.contents.some((o) => o.def.name === 'type_e3'),
      'handの親(location)へforceで強制的に伝播している',
    ).toBe(true);
  });

  it('fixedPositions+same_slot（destroyなし）は、同種のスタックが既存セルへオーバーフローせず合流する', () => {
    const yaml = `
object_defs:
  hand_owner7:
    slots:
      hand:
        stackable: true
        unit_capacity: 1
        fixed_positions: true
  type_a4:
    props:
      spawn_a:
        value: 0
        range: {min: 1, max: 2147483647}
        on_shortfall:
          spawn:
            object: type_a4
            into: same_slot
`;
    const codex = load(yaml);
    const handSlotId = codex.slotNames.getId('hand');
    const aTypeId = codex.objectNames.getId('type_a4');

    const session = new WorldSession(codex);
    const handInstance = spawn(codex, 'hand_owner7');
    const aInstance = spawn(codex, 'type_a4');
    aInstance.moveToSlot(handInstance, handSlotId, session.codex.wellKnown);

    const hand7 = handInstance.tryGetSlot(handSlotId)!;
    expect(gridIndexOfType(hand7, aTypeId)).toBe(0);

    // unit_capacity=1なので、別の型なら絶対に入らないが、同種のスタックへの合流は
    // 新しい固定番号を消費しないため、あふれずに成功するはず。
    handInstance.tick(session);

    expect(
      hand7.contents.filter((o) => o.def.name === 'type_a4').length,
      '同種はunit_capacity(1)を超えず、既存のグリッドへ合流する',
    ).toBe(2);
    expect(gridIndexOfType(hand7, aTypeId), '固定番号は変わらない').toBe(0);
  });

  it('fixedPositions+same_slotは、右に空きが無ければ左へフォールバックする', () => {
    // 「_ _ A B」→ Aから(destroyなしで)Cが生まれる → 「_ C A B」（右に空きが無いので左へ）
    //           → Bから(destroyなしで)Dが生まれる → 「C A D B」（Cのさらに左は無いのでCとAを
    //              1つずつ左へ押し出して割り込ませる）
    const yaml = `
object_defs:
  hand_owner8:
    slots:
      hand:
        stackable: true
        unit_capacity: 4
        fixed_positions: true
  type_c4: {}
  type_d4: {}
  type_a5:
    props:
      spawn_c:
        value: 1
        range: {min: 1, max: 2147483647}
        on_shortfall:
          spawn:
            object: type_c4
            into: same_slot
  type_b5:
    props:
      spawn_d:
        value: 1
        range: {min: 1, max: 2147483647}
        on_shortfall:
          spawn:
            object: type_d4
            into: same_slot
`;
    const codex = load(yaml);
    const handSlotId = codex.slotNames.getId('hand');
    const spawnCId = codex.propertyNames.getId('spawn_c');
    const spawnDId = codex.propertyNames.getId('spawn_d');
    const aTypeId = codex.objectNames.getId('type_a5');
    const bTypeId = codex.objectNames.getId('type_b5');
    const cTypeId = codex.objectNames.getId('type_c4');
    const dTypeId = codex.objectNames.getId('type_d4');

    const session = new WorldSession(codex);
    const handInstance = spawn(codex, 'hand_owner8');
    const aInstance = spawn(codex, 'type_a5');
    const bInstance = spawn(codex, 'type_b5');
    aInstance.moveToSlot(handInstance, handSlotId, session.codex.wellKnown);
    bInstance.moveToSlot(handInstance, handSlotId, session.codex.wellKnown);

    const hand8 = handInstance.tryGetSlot(handSlotId)!;
    // 前提を「_ _ A B」（A=2, B=3）に合わせる。
    expect(hand8.trySetManualPosition(stackOfType(hand8, aTypeId)!, 2)).toBe(true);
    expect(hand8.trySetManualPosition(stackOfType(hand8, bTypeId)!, 3)).toBe(true);

    // --- Cが生まれる: 期待 _ C A B ---
    aInstance.setProperty(spawnCId, 0);
    handInstance.tick(session);
    aInstance.setProperty(spawnCId, 1);

    expect(gridIndexOfType(hand8, cTypeId), '右(3番)はBで埋まっているため、左の空き(1番)へ入る').toBe(1);
    expect(gridIndexOfType(hand8, aTypeId), 'Aの番号は変わらない').toBe(2);
    expect(gridIndexOfType(hand8, bTypeId), 'Bの番号も変わらない').toBe(3);

    // --- Dが生まれる: 期待 C A D B ---
    bInstance.setProperty(spawnDId, 0);
    handInstance.tick(session);

    expect(gridIndexOfType(hand8, cTypeId), 'Cはさらに左へ押し出される').toBe(0);
    expect(gridIndexOfType(hand8, aTypeId), 'Aも左へ押し出される').toBe(1);
    expect(gridIndexOfType(hand8, dTypeId), 'Dは2番に割り込む').toBe(2);
    expect(gridIndexOfType(hand8, bTypeId), 'Bの番号は変わらない').toBe(3);

    expect(
      hand8.contents.map((o) => o.def.name),
      'Contentsの並び順もC A D Bになっている',
    ).toEqual(['type_c4', 'type_a5', 'type_d4', 'type_b5']);
  });

  it('fixedPositionsの左方向シフトは、押し出される複数個のスタックの中身を保つ', () => {
    // 押し出される型がスタック（同種複数個）であっても、その中身がバラけたり
    // 個数が変化したりしないことを確認する。
    const yaml = `
object_defs:
  hand_owner9:
    slots:
      hand:
        stackable: true
        unit_capacity: 4
        fixed_positions: true
  type_c5: {}
  type_d5: {}
  type_a6: {}
  type_b6:
    props:
      spawn_d:
        value: 1
        range: {min: 1, max: 2147483647}
        on_shortfall:
          spawn:
            object: type_d5
            into: same_slot
`;
    const codex = load(yaml);
    const handSlotId = codex.slotNames.getId('hand');
    const spawnDId = codex.propertyNames.getId('spawn_d');
    const aTypeId = codex.objectNames.getId('type_a6');
    const bTypeId = codex.objectNames.getId('type_b6');
    const cTypeId = codex.objectNames.getId('type_c5');
    const dTypeId = codex.objectNames.getId('type_d5');

    const session = new WorldSession(codex);
    const handInstance = spawn(codex, 'hand_owner9');
    const c1 = spawn(codex, 'type_c5');
    const c2 = spawn(codex, 'type_c5'); // Cは2個のスタック
    const aInstance = spawn(codex, 'type_a6');
    const bInstance = spawn(codex, 'type_b6');

    c1.moveToSlot(handInstance, handSlotId, session.codex.wellKnown);
    c2.moveToSlot(handInstance, handSlotId, session.codex.wellKnown); // 既存のCスタックへ合流
    aInstance.moveToSlot(handInstance, handSlotId, session.codex.wellKnown);
    bInstance.moveToSlot(handInstance, handSlotId, session.codex.wellKnown);

    const hand9 = handInstance.tryGetSlot(handSlotId)!;
    // 前提を「_ C(x2) A B」（C=1, A=2, B=3）に合わせる。
    expect(hand9.trySetManualPosition(stackOfType(hand9, cTypeId)!, 1)).toBe(true);
    expect(hand9.trySetManualPosition(stackOfType(hand9, aTypeId)!, 2)).toBe(true);
    expect(hand9.trySetManualPosition(stackOfType(hand9, bTypeId)!, 3)).toBe(true);
    expect(hand9.contents.filter((o) => o.def.globalId === cTypeId)).toHaveLength(2);

    // Bから(destroyなしで)Dが生まれる: 右(4番)は存在せず、左は「A(2)」で埋まっているため、
    // さらに左の空き(0番)まで探し、C・Aをそれぞれ1つずつ左へ押し出してDが2番に割り込む。
    bInstance.setProperty(spawnDId, 0);
    handInstance.tick(session);

    expect(gridIndexOfType(hand9, cTypeId), 'Cのスタックごと左へ押し出される').toBe(0);
    expect(gridIndexOfType(hand9, aTypeId), 'Aも左へ押し出される').toBe(1);
    expect(gridIndexOfType(hand9, dTypeId), 'Dは2番に割り込む').toBe(2);
    expect(gridIndexOfType(hand9, bTypeId), 'Bの番号は変わらない').toBe(3);

    expect(
      hand9.contents.filter((o) => o.def.globalId === cTypeId),
      '押し出されてもCのスタックの個数は変わらない',
    ).toHaveLength(2);
    expect(
      hand9.contents.map((o) => o.def.name),
      'Cの2個は連続したまま、A D Bと続く',
    ).toEqual(['type_c5', 'type_c5', 'type_a6', 'type_d5', 'type_b6']);
  });
});
