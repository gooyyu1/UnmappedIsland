import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/wrappers/Location';
import { PlayerCharacter } from '../../src/domain/wrappers/PlayerCharacter';
import { World } from '../../src/domain/wrappers/World';
import { fixedRng } from '../support/rng';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction, makeTooDarkToWork } from '../support/illumination';
import type { PropertyGlobalId } from '../../src/domain/GlobalId';

/**
 * timber.yamlの伐採を、実ファイルの定義だけで検証する。斧でしか倒せないこと、倒せば丸太が採れること
 * ——石斧から丸太、丸太から筏（voyage.yaml）へ繋がる唯一の経路（docs/world/Voyage.md 1節）。
 */
describe('timber.yamlの伐採', () => {
  let codex: WorldCodex;
  let session: WorldSession;
  let forest: WorldObject;
  let player: WorldObject;

  beforeAll(() => {
    codex = bundledCodex();
  });

  beforeEach(() => {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    const worldView = new World(worldInstance, codex);
    session = new WorldSession(codex, worldView, fixedRng(0));

    forest = spawnInto('forest', worldInstance, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, forest, 'characters');
    // 木を伐るのも明るさを要求する（IlluminationSystem.md 5節）。ここで見たいのは伐採の取り分
    // なので、時刻や光源を組み立てずに作業者の側で明るさを満たす。
    makeBrightEnoughForAnyAction(player, codex);
  });

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  function itemsOn(location: WorldObject): string[] {
    return new Location(location, codex).items.map((object) => object.def.name);
  }

  function carriedBy(character: WorldObject): string[] {
    return new PlayerCharacter(character, codex).handStacks.flatMap((stack) =>
      stack.map((object) => object.def.name),
    );
  }

  it('斧で伐り倒すと木が消え、丸太と太い枝が落ちる', () => {
    const tree = spawnInto('broadleaf_tree', forest, 'fixtures');
    const axe = spawnInto('stone_axe', player, 'hand');

    expect(
      tree
        .combinationsWith(axe, player)
        .find((c) => c.name === 'fell')
        ?.tryExecute() === true,
    ).toBe(true);

    const items = itemsOn(forest);
    expect(
      items.filter((name) => name === 'log'),
      '丸太が2本',
    ).toHaveLength(2);
    expect(
      items.filter((name) => name === 'thick_branch'),
      '太い枝も採れる',
    ).toHaveLength(3);
    expect(tree.parent, '倒した木は残らない').toBeUndefined();
    expect(axe.parent, '斧は消費されない').toBe(player);
    expect(
      axe.tryGetProperty(codex.propertyNames.getId('durability'))?.getEffectiveValue() ?? 0,
      '斧は刃こぼれする',
    ).toBeLessThan(960);
  });

  it('尖った石では伐り倒せない。当てて成立するのは樹皮剥ぎだけ', () => {
    const tree = spawnInto('broadleaf_tree', forest, 'fixtures');
    const knife = spawnInto('sharp_stone', player, 'hand');

    expect(tree.combinationsWith(knife, player).map((c) => c.name)).toEqual(['strip_bark']);
    expect(tree.combinationsWith(player, player), '素手では何も成立しない').toEqual([]);
    expect(tree.parent, '木は立ったまま').toBe(forest);
  });

  it('石斧を当てて成立するのは伐採だけ（樹皮剥ぎと同時に成立させない）', () => {
    // **画面が出せるのは成立するもの1つだけ**で、複数あれば宣言順の先頭が勝つ
    // （docs/ui/CardInteraction.md 2節、docs/engine/GameElementDefinition.md 12.1節）。石斧が
    // 樹皮剥ぎにも当たると、先に書かれたfellが必ず勝って剥ぐ道がプレイヤーへ届かなくなる。
    const tree = spawnInto('broadleaf_tree', forest, 'fixtures');
    const axe = spawnInto('stone_axe', player, 'hand');

    expect(tree.combinationsWith(axe, player).map((c) => c.name)).toEqual(['fell']);
  });

  it('摩耗した石斧が暗がりで名乗る理由は、その斧にできる操作のもの', () => {
    // 断る組み合わせが複数並ぶと、画面へ出るのは先頭だけ（docs/ui/CardInteraction.md 2.1節）。
    // 斧が樹皮剥ぎにも当たっていた
    // 頃は、暗さで塞がれた樹皮剥ぎの理由が伐採の「摩耗」に隠れていた。
    const tree = spawnInto('broadleaf_tree', forest, 'fixtures');
    const axe = spawnInto('stone_axe', player, 'hand');
    axe.getProperty(codex.propertyNames.getId('durability')).setNumberWithoutEvents(0);
    makeTooDarkToWork(player, codex);

    expect(tree.combinationsWith(axe, player), '成立するものは無い').toEqual([]);
    expect(
      tree.refusedCombinationsWith(axe, player).map((c) => [c.name, c.unmetRequirement()?.reasonName]),
      '断るのは伐採だけで、理由も斧そのものを指す',
    ).toEqual([['fell', 'too_worn']]);
  });

  it('暗がりで尖った石を当てると、樹皮剥ぎが暗さを理由に断る', () => {
    const tree = spawnInto('broadleaf_tree', forest, 'fixtures');
    const knife = spawnInto('sharp_stone', player, 'hand');
    makeTooDarkToWork(player, codex);

    expect(tree.combinationsWith(knife, player)).toEqual([]);
    expect(
      tree.refusedCombinationsWith(knife, player).map((c) => [c.name, c.unmetRequirement()?.reasonName]),
    ).toEqual([['strip_bark', 'too_dark']]);
  });

  it('若木は刃物で切ると消え、長い棒が1本採れる', () => {
    // 長い棒の唯一の出どころ（docs/world/SurvivalItems.md 0節）。**斧を要求しない**ことが、
    // 槍を斧の後ろから外している（同3節）。
    const sapling = spawnInto('sapling', forest, 'fixtures');
    const knife = spawnInto('sharp_stone', player, 'hand');

    expect(
      sapling
        .combinationsWith(knife, player)
        .find((c) => c.name === 'cut_pole')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(
      carriedBy(player).filter((name) => name === 'long_pole'),
      '長い棒が1本',
    ).toHaveLength(1);
    expect(sapling.parent, '切った若木は残らない').toBeUndefined();
    expect(knife.parent, '刃物は消費されない').toBe(player);
  });

  it('若木を切ると木材加工が伸びる（斧を持たないまま伸ばせる）', () => {
    // 伐るのは木材加工（docs/engine/SkillSystem.md 3節の実行経路）。**槍が要求する腕を、槍の材料を
    // 採る手そのものが配る**ので、刃物1本から槍まで繋がる（docs/world/SurvivalItems.md 3節）。
    const sapling = spawnInto('sapling', forest, 'fixtures');
    const knife = spawnInto('sharp_stone', player, 'hand');
    const woodworkId = codex.propertyNames.getId('skill_woodwork');
    const before = player.tryGetProperty(woodworkId)?.number ?? 0;

    expect(
      sapling
        .combinationsWith(knife, player)
        .find((c) => c.name === 'cut_pole')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(player.tryGetProperty(woodworkId)?.number ?? 0).toBeGreaterThan(before);
  });

  it('長い棒は太い枝より軽いのに、かさは何倍もある', () => {
    // 長さの違いは目方ではなくかさで効く（docs/world/SurvivalItems.md 0節）。
    const weightId = codex.propertyNames.getId('weight');
    const volumeId = codex.propertyNames.getId('volume');
    const pole = spawnInto('long_pole', forest, 'items');
    const branch = spawnInto('thick_branch', forest, 'items');
    const valueOf = (object: WorldObject, propertyGlobalId: PropertyGlobalId): number =>
      object.tryGetProperty(propertyGlobalId)?.number ?? 0;

    expect(valueOf(pole, weightId)).toBeLessThan(valueOf(branch, weightId));
    expect(valueOf(pole, volumeId)).toBeGreaterThan(valueOf(branch, volumeId) * 3);
  });

  it('丸太1本は、キャラクタが担げる限界に近い重さ', () => {
    const log = spawnInto('log', forest, 'items');
    const loadId = codex.propertyNames.getId('load');

    expect(log.moveToSlotOrRejection(player.getSlot(codex.slotNames.getId('hand')))).toBeUndefined();

    // 1本担いだだけで、荷重の段が「軽い」を外れる（2本目は運べない、docs/world/Voyage.md 1節）。
    expect(player.tryGetProperty(loadId)?.isInStage('light') ?? false, '1本担いだだけで軽い段を外れる').toBe(
      false,
    );
  });
});
