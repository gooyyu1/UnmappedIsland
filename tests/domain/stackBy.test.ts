import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

// represented_by（GameElementDefinition.md 7.6節）に対する自動テスト。同じObjectDefでも、代表オブジェクト
// （さらにその代表…）が異なれば別のObjectStackになることを検証する。
describe('RepresentedByTests', () => {
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

  function spawnRepresentedContainer(
    codex: WorldCodex,
    containerName: string,
    contentName: string,
  ): WorldObject {
    const contentSlotId = codex.slotNames.getId('content');
    const container = spawn(codex, containerName);
    const content = spawn(codex, contentName);
    content.moveToSlot(container, contentSlotId, codex.wellKnown);
    return container;
  }

  it('represented_byは、コンテナのDefだけでなく代表オブジェクトのDefでもグループ化する', () => {
    const yaml = `
traits:
  represented_container:
    represented_by: content
    slots:
      content:
        accepts: [{tag: liquid, max: 1}]
object_defs:
  bag_repr:
    slots:
      pile: {}
  empty_liquid:
    tags: [liquid]
  water_liquid:
    tags: [liquid]
  jug:
    traits: [represented_container]
`;
    const codex = load(yaml);
    const pileSlotId = codex.slotNames.getId('pile');

    const bag = spawn(codex, 'bag_repr');
    const emptyJug1 = spawnRepresentedContainer(codex, 'jug', 'empty_liquid');
    const emptyJug2 = spawnRepresentedContainer(codex, 'jug', 'empty_liquid');
    const waterJug = spawnRepresentedContainer(codex, 'jug', 'water_liquid');

    emptyJug1.moveToSlot(bag, pileSlotId, codex.wellKnown);
    emptyJug2.moveToSlot(bag, pileSlotId, codex.wellKnown);
    waterJug.moveToSlot(bag, pileSlotId, codex.wellKnown);

    const pile = bag.tryGetSlot(pileSlotId)!;
    const stacks = pile.cells;

    expect(stacks, '同じjugでも represented_by 先のObjectDefが違えば別スタックになる').toHaveLength(2);
    expect(stacks[0]!.members).toHaveLength(2);
    expect(stacks[1]!.members).toHaveLength(1);
  });

  it('represented_byは、中身が同じでもコンテナのDefが違えば別スタックのままにする', () => {
    // represented_by は同種判定を「中身のObjectDefまで」細分化するが、外側オブジェクト自体も
    // アイデンティティの先頭要素として含まれる。中身が同じ水でも、容器のObjectDefが違えば別スタック。
    const yaml = `
traits:
  represented_container:
    represented_by: content
    slots:
      content:
        accepts: [{tag: liquid, max: 1}]
object_defs:
  bag_repr3:
    slots:
      pile: {}
  water_liquid:
    tags: [liquid]
  bowl:
    traits: [represented_container]
  bottle:
    traits: [represented_container]
`;
    const codex = load(yaml);
    const pileSlotId = codex.slotNames.getId('pile');

    const bag = spawn(codex, 'bag_repr3');
    const waterBowl = spawnRepresentedContainer(codex, 'bowl', 'water_liquid');
    const waterBottle = spawnRepresentedContainer(codex, 'bottle', 'water_liquid');

    waterBowl.moveToSlot(bag, pileSlotId, codex.wellKnown);
    waterBottle.moveToSlot(bag, pileSlotId, codex.wellKnown);

    const pile = bag.tryGetSlot(pileSlotId)!;
    const stacks = pile.cells;

    expect(stacks, '中身が同じ水でも容器（外側ObjectDef）が違えば別スタックになる').toHaveLength(2);
    expect(stacks[0]!.members).toHaveLength(1);
    expect(stacks[1]!.members).toHaveLength(1);
  });

  it('represented_byは、中身が空になったオブジェクトを既存の一致スタックへ再合流させる', () => {
    // 既に空ボウルのスタックがある状態で、水入りボウルの中身が空になったら、そのボウルは
    // 弾き出されて既存の空ボウルスタックへ合流する（スロット全体で「同種は1スタック」を保つ）。
    const yaml = `
traits:
  represented_container:
    represented_by: content
    slots:
      content:
        accepts: [{tag: liquid, max: 1}]
object_defs:
  bag_remig:
    slots:
      pile: {}
  water_liquid:
    tags: [liquid]
  bowl:
    traits: [represented_container]
`;
    const codex = load(yaml);
    const pileSlotId = codex.slotNames.getId('pile');
    const contentSlotId = codex.slotNames.getId('content');

    const bag = spawn(codex, 'bag_remig');
    const emptyBowl = spawn(codex, 'bowl');
    const waterBowl = spawn(codex, 'bowl');
    const water = spawn(codex, 'water_liquid');
    water.moveToSlot(waterBowl, contentSlotId, codex.wellKnown);

    emptyBowl.moveToSlot(bag, pileSlotId, codex.wellKnown);
    waterBowl.moveToSlot(bag, pileSlotId, codex.wellKnown);

    const pile = bag.tryGetSlot(pileSlotId)!;
    expect(
      pile.cells.filter((c) => c !== undefined),
      '最初は空ボウルと水入りボウルで別スタック',
    ).toHaveLength(2);

    // 水入りボウルの中身を消す → 空ボウルになり、既存の空ボウルスタックへ再合流するはず。
    water.destroy();

    const live = pile.cells.filter((c) => c !== undefined);
    expect(live, '空になったボウルは既存の空ボウルスタックへ合流し1スタックにまとまる').toHaveLength(1);
    expect(live[0]!.members).toEqual(expect.arrayContaining([emptyBowl, waterBowl]));
    expect(live[0]!.members).toHaveLength(2);
  });

  it('represented_byは、末端の中身の差し替えを最上位のスタックまで連鎖して伝播する', () => {
    // 瓶→出汁→エッセンスの2段代表。末端のエッセンスを差し替えるだけで、最上位（瓶）のスタックまで
    // 再判定が連鎖して、同じだった2本の瓶が別スタックに分かれること（局所規則の自己伝播）を確かめる。
    const yaml = `
traits:
  represented_container:
    represented_by: content
    slots:
      content:
        accepts: [{tag: liquid, max: 1}]
  represented_liquid:
    represented_by: essence
    slots:
      essence:
        accepts: [{tag: essence, max: 1}]
object_defs:
  bag_deep:
    slots:
      pile: {}
  sweet_essence:
    tags: [essence]
  bitter_essence:
    tags: [essence]
  broth:
    traits: [represented_liquid]
    tags: [liquid]
  bottle_deep:
    traits: [represented_container]
`;
    const codex = load(yaml);
    const pileSlotId = codex.slotNames.getId('pile');
    const contentSlotId = codex.slotNames.getId('content');
    const essenceSlotId = codex.slotNames.getId('essence');

    const bag = spawn(codex, 'bag_deep');
    const bottleA = spawn(codex, 'bottle_deep');
    const bottleB = spawn(codex, 'bottle_deep');
    const brothA = spawn(codex, 'broth');
    const brothB = spawn(codex, 'broth');
    const sweetA = spawn(codex, 'sweet_essence');
    const sweetB = spawn(codex, 'sweet_essence');

    sweetA.moveToSlot(brothA, essenceSlotId, codex.wellKnown);
    sweetB.moveToSlot(brothB, essenceSlotId, codex.wellKnown);
    brothA.moveToSlot(bottleA, contentSlotId, codex.wellKnown);
    brothB.moveToSlot(bottleB, contentSlotId, codex.wellKnown);
    bottleA.moveToSlot(bag, pileSlotId, codex.wellKnown);
    bottleB.moveToSlot(bag, pileSlotId, codex.wellKnown);

    const pile = bag.tryGetSlot(pileSlotId)!;
    expect(
      pile.cells.filter((c) => c !== undefined),
      '代表の代表まで同じなので最初は同じスタック',
    ).toHaveLength(1);

    // brothA の末端エッセンスを sweet → bitter に差し替える。
    sweetA.destroy();
    const bitterA = spawn(codex, 'bitter_essence');
    bitterA.moveToSlot(brothA, essenceSlotId, codex.wellKnown);

    const live = pile.cells.filter((c) => c !== undefined);
    expect(live, '末端の差し替えが最上位まで伝播し、2本の瓶が別スタックに分かれる').toHaveLength(2);
    const liveMembers = live.flatMap((s) => s!.members);
    expect(liveMembers).toHaveLength(2);
    expect(liveMembers).toEqual(expect.arrayContaining([bottleA, bottleB]));
  });

  it('represented_byは、代表チェーンの深さ分だけ再帰的に同種判定を細分化する', () => {
    const yaml = `
traits:
  represented_container:
    represented_by: content
    slots:
      content:
        accepts: [{tag: liquid, max: 1}]
  represented_liquid:
    represented_by: essence
    slots:
      essence:
        accepts: [{tag: essence, max: 1}]
object_defs:
  bag_repr2:
    slots:
      pile: {}
  sweet_essence:
    tags: [essence]
  bitter_essence:
    tags: [essence]
  broth:
    traits: [represented_liquid]
    tags: [liquid]
  bottle_repr:
    traits: [represented_container]
`;
    const codex = load(yaml);
    const pileSlotId = codex.slotNames.getId('pile');
    const contentSlotId = codex.slotNames.getId('content');
    const essenceSlotId = codex.slotNames.getId('essence');

    const bag = spawn(codex, 'bag_repr2');

    const bottle1 = spawn(codex, 'bottle_repr');
    const bottle2 = spawn(codex, 'bottle_repr');
    const bottle3 = spawn(codex, 'bottle_repr');
    const broth1 = spawn(codex, 'broth');
    const broth2 = spawn(codex, 'broth');
    const broth3 = spawn(codex, 'broth');
    const sweet1 = spawn(codex, 'sweet_essence');
    const sweet2 = spawn(codex, 'sweet_essence');
    const bitter = spawn(codex, 'bitter_essence');

    broth1.moveToSlot(bottle1, contentSlotId, codex.wellKnown);
    broth2.moveToSlot(bottle2, contentSlotId, codex.wellKnown);
    broth3.moveToSlot(bottle3, contentSlotId, codex.wellKnown);
    sweet1.moveToSlot(broth1, essenceSlotId, codex.wellKnown);
    sweet2.moveToSlot(broth2, essenceSlotId, codex.wellKnown);
    bitter.moveToSlot(broth3, essenceSlotId, codex.wellKnown);

    bottle1.moveToSlot(bag, pileSlotId, codex.wellKnown);
    bottle2.moveToSlot(bag, pileSlotId, codex.wellKnown);
    bottle3.moveToSlot(bag, pileSlotId, codex.wellKnown);

    const pile = bag.tryGetSlot(pileSlotId)!;
    const stacks = pile.cells;

    expect(stacks, '代表の代表まで同じときだけ同じスタックにまとまる').toHaveLength(2);
    expect(stacks[0]!.members).toHaveLength(2);
    expect(stacks[1]!.members).toHaveLength(1);
  });

  it('represented_by+fixedPositionsは、代表オブジェクトが違えば固定グリッドのセルを共有しない', () => {
    const yaml = `
traits:
  represented_container:
    represented_by: content
    slots:
      content:
        accepts: [{tag: liquid, max: 1}]
object_defs:
  hand_repr:
    slots:
      hand:
        stackable: true
        unit_capacity: 3
        fixed_positions: true
  empty_liquid:
    tags: [liquid]
  water_liquid:
    tags: [liquid]
  jug_repr2:
    traits: [represented_container]
`;
    const codex = load(yaml);
    const handSlotId = codex.slotNames.getId('hand');

    const hand = spawn(codex, 'hand_repr');
    const emptyJug = spawnRepresentedContainer(codex, 'jug_repr2', 'empty_liquid');
    const waterJug = spawnRepresentedContainer(codex, 'jug_repr2', 'water_liquid');

    emptyJug.moveToSlot(hand, handSlotId, codex.wellKnown);
    waterJug.moveToSlot(hand, handSlotId, codex.wellKnown);

    const handSlot = hand.tryGetSlot(handSlotId)!;
    // fixedPositionsなのでcellsには空セル(undefined)も含まれる。実在スタックだけを見るためundefinedを除く。
    const stacks = handSlot.cells.filter((c) => c !== undefined);

    expect(stacks).toHaveLength(2);
    expect(stacks.map((s) => handSlot.indexOfStack(s!))).toEqual(expect.arrayContaining([0, 1]));
  });
});
