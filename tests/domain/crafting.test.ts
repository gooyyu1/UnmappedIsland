import { beforeEach, describe, expect, it } from 'vitest';
import {
  advanceCrafting,
  currentStep,
  spawnInProgressObject,
  stepIsSupplied,
  stepSupplyRatio,
} from '../../src/domain/crafting';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { World } from '../../src/domain/views/World';
import { loadYamlFile, worldCodexPath } from '../support/worldCodexFiles';
import { inProgressObjectName, MATERIALS_SLOT } from '../../src/loader/inProgressObjects';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { RecipeDef } from '../../src/domain/RecipeDef';

/** 工程を進める操作（RecipeSystem.md 4節）。 */
describe('工程を進める', () => {
  // 2工程のレシピ。1工程目は道具（消費しない）も要求する。
  const YAML = `
object_defs:
  # 経過中のtickは世界の木を辿って回るので、locationとして世界へ繋いでおく。
  crafting_ground:
    tags: [location]
    slots:
      items:
        cell: {accept: {tag: item}}
  wood:
    tags: [item]
  knife:
    tags: [item]
  rope:
    tags: [item]
  # tickごとにすり減り、0になった時点で壊れる木（30分＝2tickで壊れる）。
  crumbling_wood:
    tags: [item]
    props:
      durability:
        value: 2
        range: {min: 0, max: 10}
        on_min:
          destroy: self
        passives:
          - add:
              self:
                durability: -1
  spear:
    tags: [item]
    recipes:
      basic:
        steps:
          - requires:
              - {object: crumbling_wood, count: 1, consume: true}
            duration: 30
  axe:
    tags: [item]
    recipes:
      basic:
        steps:
          - requires:
              - {object: wood, count: 2, consume: true}
              - {object: knife, consume: false}
            duration: 30
          - requires:
              - {object: rope, count: 1, consume: true}
            duration: 10
  # 2つの工程が同じ型を要求する。枠の上限は合計（3）なので、1工程目の要求（1）より多く入りうる。
  raft:
    tags: [item]
    recipes:
      basic:
        steps:
          - requires:
              - {object: wood, count: 1, consume: true}
            duration: 10
          - requires:
              - {object: wood, count: 2, consume: true}
            duration: 10
`;

  let codex: WorldCodex;
  let session: WorldSession;
  let ground: WorldObject;
  let wip: WorldObject;
  let recipe: RecipeDef;

  const idOf = (name: string) => codex.objectNames.getId(name);
  const materialsId = () => codex.slotNames.getId(MATERIALS_SLOT);
  const progressId = () => codex.propertyNames.getId('progress');

  beforeEach(() => {
    // 時間を進めるにはWorldを持つセッションが要るので、実物のcore.yamlを一緒に読む。
    const loader = new WorldCodexYamlLoader();
    loadYamlFile(loader, worldCodexPath('core.yaml'));
    codex = loader.load('crafting.yaml', YAML).build();

    const worldInstance = new WorldObject(0, codex.objects.get(idOf('world')), new WorldSession(codex));
    session = new WorldSession(codex, new World(worldInstance, codex.propertyNames, codex.symbolNames));
    ground = new WorldObject(1, codex.objects.get(idOf('crafting_ground')), session);
    ground.moveToSlot(worldInstance, codex.slotNames.getId('locations'));
    wip = session.spawn(idOf(inProgressObjectName('axe', 'basic')));
    wip.moveToSlot(ground, codex.slotNames.getId('items'));
    recipe = codex.objects.get(idOf('axe')).recipes[0];
  });

  function put(objectName: string, count: number): void {
    for (let i = 0; i < count; i += 1) session.spawn(idOf(objectName)).moveToSlot(wip, materialsId());
  }

  const boxContents = () =>
    (wip.tryGetSlot(materialsId())?.contents ?? []).map((object) => object.def.name).sort();

  const onGround = () =>
    (ground.tryGetSlot(codex.slotNames.getId('items'))?.contents ?? []).map((o) => o.def.name);

  it('進捗が入る区間から、今の工程が決まる', () => {
    expect(currentStep(recipe, 0)?.durationMinutes).toBe(30);
    expect(currentStep(recipe, 30), '1工程目を終えたら2工程目').toBe(recipe.steps[1]);
    expect(currentStep(recipe, 40), '全部終えていればundefined').toBeUndefined();
  });

  it('材料の充足率は、今の工程の要求を素材も道具も数える', () => {
    put('wood', 1);
    expect(stepSupplyRatio(wip, materialsId(), recipe.steps[0]), '木1/2、刃物0/1').toBeCloseTo(1 / 3);

    put('knife', 1);
    expect(stepSupplyRatio(wip, materialsId(), recipe.steps[0]), '道具も数に入る').toBeCloseTo(2 / 3);

    put('wood', 1);
    expect(stepSupplyRatio(wip, materialsId(), recipe.steps[0])).toBe(1);
    expect(stepIsSupplied(wip, materialsId(), recipe.steps[0]), '揃った時点で作業できる').toBe(true);
  });

  it('要求数を超えて入っている分は、充足率を進めない', () => {
    // 枠の上限は全工程の合計なので、1工程目の要求を超えて入れられる。
    const raftWip = session.spawn(idOf(inProgressObjectName('raft', 'basic')));
    raftWip.moveToSlot(ground, codex.slotNames.getId('items'));
    const raft = codex.objects.get(idOf('raft')).recipes[0];
    for (let i = 0; i < 3; i += 1) session.spawn(idOf('wood')).moveToSlot(raftWip, materialsId());

    expect(stepSupplyRatio(raftWip, materialsId(), raft.steps[0]), '1工程目は1つで足りる').toBe(1);
  });

  it('終えた工程の数はfinished_stepsに現れ、割合は終えた工程の数÷全工程数になる', () => {
    // CardView.md 10.1節の進捗バー（gauge宣言）が読む値。progressと違い所要時間ではなく
    // 純粋な回数なので、工程の長さが不揃いでも「2工程中1工程＝0.5」がそのまま割合になる。
    const finishedStepsId = codex.propertyNames.getId('finished_steps');
    expect(wip.tryGetProperty(finishedStepsId)?.ratio, '着手前は0').toBe(0);

    put('wood', 2);
    put('knife', 1);
    expect(advanceCrafting(wip, recipe, materialsId(), codex, session)).toBe(true);

    expect(wip.getNumber(finishedStepsId), '1工程終えるごとに1増える').toBe(1);
    expect(wip.tryGetProperty(finishedStepsId)?.ratio, '2工程中1工程＝0.5').toBe(0.5);
  });

  it('工程が1つのレシピには、進捗バー用のfinished_stepsがそもそも宣言されない', () => {
    // 唯一の工程を終えると、その場で完成品へ置き換わる。値が動くところを見せる余地が無いので、
    // UI側が特別扱いしなくて済むよう、宣言そのものを省く（CardView.md 10.1節）。
    const finishedStepsId = codex.propertyNames.tryGetId('finished_steps');
    expect(finishedStepsId, '2工程以上のレシピ（axe）があるので識別子自体は存在する').toBeDefined();

    const spearWip = session.spawn(idOf(inProgressObjectName('spear', 'basic')));
    spearWip.moveToSlot(ground, codex.slotNames.getId('items'));

    expect(spearWip.tryGetProperty(finishedStepsId!)).toBeUndefined();
  });

  it('素材が足りなければ進まない', () => {
    put('wood', 1);
    put('knife', 1);

    expect(stepIsSupplied(wip, materialsId(), recipe.steps[0])).toBe(false);
    expect(advanceCrafting(wip, recipe, materialsId(), codex, session)).toBe(false);
    expect(wip.getNumber(progressId())).toBe(0);
  });

  it('素材は消え、出番の終わった道具は足元へこぼれる', () => {
    put('wood', 2);
    put('knife', 1);

    expect(advanceCrafting(wip, recipe, materialsId(), codex, session)).toBe(true);
    // 木は消費される。刃物は2工程目が要求しないので、箱に留めず親へ返す。
    expect(boxContents()).toEqual([]);
    expect(onGround().sort()).toEqual([inProgressObjectName('axe', 'basic'), 'knife']);
    expect(wip.getNumber(progressId()), '工程の所要時間ぶん進む').toBe(30);
  });

  it('工程の所要時間ぶん、ゲーム内時間が進む', () => {
    put('wood', 2);
    put('knife', 1);
    const before = session.world!.totalMinutes;

    advanceCrafting(wip, recipe, materialsId(), codex, session);

    expect(session.world!.totalMinutes - before).toBe(30);
  });

  it('素材が消えるのは経過し切ってから（経過中の各tickではまだ箱に在る）', () => {
    put('wood', 2);
    put('knife', 1);

    const duringTicks: string[][] = [];
    session.observeTicks(
      () => duringTicks.push(boxContents()),
      () => advanceCrafting(wip, recipe, materialsId(), codex, session),
    );

    expect(duringTicks.length, '30分＝2tick').toBe(2);
    for (const contents of duringTicks) expect(contents).toEqual(['knife', 'wood', 'wood']);
    expect(boxContents(), '経過し切った時点で消える').toEqual([]);
  });

  // 在庫確認は開始時に一度だけで、経過中の再判定はしない（ActionSystem.md 6.1節）。
  it('経過中に素材が失われても、始めた工程は成立する', () => {
    const spear = codex.objects.get(idOf('spear')).recipes[0];
    const spearWip = session.spawn(idOf(inProgressObjectName('spear', 'basic')));
    spearWip.moveToSlot(ground, codex.slotNames.getId('items'));
    const rotting = session.spawn(idOf('crumbling_wood'));
    rotting.moveToSlot(spearWip, materialsId());

    expect(advanceCrafting(spearWip, spear, materialsId(), codex, session)).toBe(true);

    expect(rotting.parent, '素材は経過中に壊れて世界から外れている').toBeUndefined();
    expect(spearWip.def.name, 'それでも工程は成立し、同じ個体が完成品になる').toBe('spear');
  });

  it('最後の工程を終えると、完成品が製作中オブジェクトのいた場所へ生まれる', () => {
    put('wood', 2);
    put('knife', 1);
    put('rope', 1);

    expect(advanceCrafting(wip, recipe, materialsId(), codex, session)).toBe(true);
    expect(onGround().sort(), '途中はまだ製作中。用済みの刃物は先にこぼれる').toEqual([
      inProgressObjectName('axe', 'basic'),
      'knife',
    ]);

    expect(advanceCrafting(wip, recipe, materialsId(), codex, session)).toBe(true);
    expect(onGround().sort()).toEqual(['axe', 'knife']);
  });
});

/** レシピ一覧から製作を始める操作（RecipeSystem.md 1節）。 */
describe('製作を始める', () => {
  // 土地はアイテムと設置物で置き場所が分かれる（core.yamlのlocation traitと同じ形）。
  const YAML = `
object_defs:
  crafting_ground:
    tags: [location]
    slots:
      items:
        cell: {accept: {tag: item}}
      fixtures:
        cell: {accept: {tag: fixture}}
  wood:
    tags: [item]
  stone:
    tags: [item]
  axe:
    tags: [item]
    recipes:
      basic:
        steps:
          - requires: [{object: wood, count: 1, consume: true}]
            duration: 30
  # 持ち歩けない完成品。製作中も設置物のタグを引き継ぐ（同5節）。
  campfire:
    tags: [fixture]
    recipes:
      stacked:
        steps:
          - requires: [{object: stone, count: 1, consume: true}]
            duration: 15
`;

  let codex: WorldCodex;
  let session: WorldSession;
  let ground: WorldObject;

  const idOf = (name: string) => codex.objectNames.getId(name);
  const contentsOf = (slotName: string) =>
    (ground.tryGetSlot(codex.slotNames.getId(slotName))?.contents ?? []).map((o) => o.def.name);

  beforeEach(() => {
    const loader = new WorldCodexYamlLoader();
    loadYamlFile(loader, worldCodexPath('core.yaml'));
    codex = loader.load('crafting.yaml', YAML).build();

    const worldInstance = new WorldObject(0, codex.objects.get(idOf('world')), new WorldSession(codex));
    session = new WorldSession(codex, new World(worldInstance, codex.propertyNames, codex.symbolNames));
    ground = new WorldObject(1, codex.objects.get(idOf('crafting_ground')), session);
    ground.moveToSlot(worldInstance, codex.slotNames.getId('locations'));
  });

  it('製作中オブジェクトは、完成品のタグが通るスロットへ入る', () => {
    const axe = spawnInProgressObject(session, ground, idOf(inProgressObjectName('axe', 'basic')));
    expect(axe.parent, 'アイテムはitemsへ').toBe(ground);
    expect(contentsOf('items')).toEqual([inProgressObjectName('axe', 'basic')]);

    // itemsはfixtureを受け入れないので、スロット名を決め打ちすると行き先を失う。
    const campfire = spawnInProgressObject(
      session,
      ground,
      idOf(inProgressObjectName('campfire', 'stacked')),
    );
    expect(campfire.parent, '設置物はfixturesへ').toBe(ground);
    expect(contentsOf('fixtures')).toEqual([inProgressObjectName('campfire', 'stacked')]);
  });
});
