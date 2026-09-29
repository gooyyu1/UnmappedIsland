import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toolWearsOf } from '../../src/analysis/durations';
import { staticValueOf } from '../../src/analysis/staticValue';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
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
    session = new WorldSession(codex, undefined, fixedRng(0));
    const worldInstance = session.createObject(codex.objectNames.getId('world'));
    const worldView = new World(worldInstance);
    session.adoptWorld(worldView);

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
    return new Location(location).items.map((object) => object.def.name);
  }

  function carriedBy(character: WorldObject): string[] {
    return new PlayerCharacter(character).handStacks.flatMap((stack) =>
      stack.map((object) => object.def.name),
    );
  }

  /**
   * その工程1回が石斧の余力から食う量。
   *
   * **食う量は宣言から読む。** 直値で書くと閾値の側しか見ないことになり、`add` を動かしても緑の
   * ままになる（CLAUDE.md「置いた主張は、破れたときに落ちるものと対で置く」の「その主張の面を
   * 見ている」）。toolWearsOf の uses は満タンから尽きるまでの回数なので、満タンを割れば1回ぶん。
   */
  function axeCostPerUse(stepName: string): number {
    const wear = toolWearsOf(codex).find(
      (row) => row.objectName === 'stone_axe' && row.stepName === stepName,
    );
    expect(wear, `${stepName} が斧を減らす宣言`).toBeDefined();
    const full = staticValueOf(
      codex.objects.get(codex.objectNames.getId('stone_axe')),
      codex.propertyNames.getId('durability'),
      'lowest',
    );
    expect(full, '石斧の durability が定義だけから読めない').toBeDefined();
    return full! / wear!.uses;
  }

  /**
   * 斧を1回入れる。**1回で倒れる木は無い**（docs/engine/ActionSystem.md 6.3節）ので、成立している
   * ほうの手（受け口を刻むchopか、倒すfell）を引いて実行する。
   */
  function swingAxeAt(tree: WorldObject, axe: WorldObject): string {
    const [combination] = tree.combinationsWith(axe, player);
    expect(combination, '斧を当てて成立する手').toBeDefined();
    expect(combination.tryExecute()).toBe(true);
    return combination.name;
  }

  it('斧を何度も入れて初めて木が倒れ、丸太と太い枝が落ちる', () => {
    const tree = spawnInto('broadleaf_tree', forest, 'fixtures');
    const axe = spawnInto('stone_axe', player, 'hand');
    // 何回で倒れるかは木の宣言が持つ（直値で書くと、宣言を動かしても緑のままになる）。
    const swings = tree.getProperty(codex.propertyNames.getId('trunk_integrity')).number;

    const names: string[] = [];
    for (let left = swings; left > 0; left -= 1) names.push(swingAxeAt(tree, axe));

    expect(names.at(-1), '最後の1回だけが倒す手').toBe('fell');
    expect(new Set(names.slice(0, -1)), 'そこまでは受け口を刻むだけ').toEqual(new Set(['chop']));

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
    expect(
      tree.combinationsWith(player, player).map((c) => c.name),
      '素手では何も成立しない',
    ).toEqual([]);
    expect(tree.parent, '木は立ったまま').toBe(forest);
  });

  it('石斧を当てて成立するのは伐採だけ（樹皮剥ぎと同時に成立させない）', () => {
    // **画面が出せるのは成立するもの1つだけ**で、複数あれば宣言順の先頭が勝つ
    // （docs/ui/CardInteraction.md 2節、docs/engine/GameElementDefinition.md 12.1節）。石斧が
    // 樹皮剥ぎにも当たると、先に書かれた伐採の手が必ず勝って剥ぐ道がプレイヤーへ届かなくなる。
    //
    // **伐採の2つの手どうしも同時には成立しない**（同12.1節「条件で分ける」）——受け口を刻む手と
    // 倒す手は幹の残りで排他なので、立っている木に出るのは刻むほうだけ。
    const tree = spawnInto('broadleaf_tree', forest, 'fixtures');
    const axe = spawnInto('stone_axe', player, 'hand');

    expect(tree.combinationsWith(axe, player).map((c) => c.name)).toEqual(['chop']);
  });

  it('摩耗した石斧が暗がりで名乗る理由は、その斧にできる操作のもの', () => {
    // 断る組み合わせが複数並ぶと、画面へ出るのは先頭だけ（docs/ui/CardInteraction.md 2節）。
    // 斧が樹皮剥ぎにも当たっていた
    // 頃は、暗さで塞がれた樹皮剥ぎの理由が伐採の「摩耗」に隠れていた。
    const tree = spawnInto('broadleaf_tree', forest, 'fixtures');
    const axe = spawnInto('stone_axe', player, 'hand');
    // 1本ぶん（120）を割った刃。**0にはしない**——0へ届いた刃は折れて無くなる（weathering.yaml）
    // ので、その札は盤面に残らない（docs/engine/DurabilitySystem.md 2.1節）。
    axe.getProperty(codex.propertyNames.getId('durability')).setNumberWithoutEvents(20);
    makeTooDarkToWork(player, codex);

    expect(
      tree.combinationsWith(axe, player).map((c) => c.name),
      '成立するものは無い',
    ).toEqual([]);
    expect(
      tree.refusedCombinationsWith(axe, player).map((c) => [c.name, c.unmetRequirement()?.reasonName]),
      '断るのは伐採だけで、理由も斧そのものを指す',
    ).toEqual([['chop', 'too_worn']]);
  });

  it('ちょうど1本ぶんの余力で刻み始めた斧でも、最後まで倒し切れる', () => {
    // 刻んでいるあいだにも屋外の劣化は進む（weathering.yamlのlong_lived_material、晴れで-0.1/tick）。
    // **刻むたびに余力の線を引き直すと、ちょうど1本ぶんで始めた斧が途中で断られる**——払った時間が
    // 幹に取り残されたまま、丸太が1本も返らない（issue #2304）。
    const tree = spawnInto('broadleaf_tree', forest, 'fixtures');
    const axe = spawnInto('stone_axe', player, 'hand');
    const durabilityId = codex.propertyNames.getId('durability');
    // 倒し切るのにちょうど足りる余力。**直値で書かない**——食う量を動かしても緑のままになる。
    axe.getProperty(durabilityId).setNumberWithoutEvents(axeCostPerUse('fell'));

    const swings = tree.getProperty(codex.propertyNames.getId('trunk_integrity')).number;
    for (let left = swings; left > 0; left -= 1) {
      const [combination] = tree.combinationsWith(axe, player);
      expect(
        combination,
        `残り${left}の幹に手が立つ（立たなければ、そこまで払った時間が取り残される）: 断り=${JSON.stringify(
          tree
            .refusedCombinationsWith(axe, player)
            .map((refused) => [refused.name, refused.unmetRequirement()?.reasonName]),
        )}`,
      ).toBeDefined();
      expect(combination.tryExecute()).toBe(true);
    }

    expect(
      itemsOn(forest).filter((name) => name === 'log'),
      '払った時間のぶん、丸太が2本返る',
    ).toHaveLength(2);
  });

  it('刻み始めた木は、余力が1本ぶんを割っていても倒し切れる（折れるのは倒した後）', () => {
    // **線が守るのは、刻み始める前に残っていた安い使い道**（docs/engine/DurabilitySystem.md 2.1節）。
    // 刻み始めた後にその余力を別の使い道へ回したなら、倒す一撃は残りを食い切って折れる——摩耗は
    // 効果の一部で、効果は時間を進めきってから一度に入るので、**折れるのは木が倒れた後**。
    const tree = spawnInto('broadleaf_tree', forest, 'fixtures');
    const axe = spawnInto('stone_axe', player, 'hand');
    const durabilityId = codex.propertyNames.getId('durability');
    const swings = tree.getProperty(codex.propertyNames.getId('trunk_integrity')).number;

    for (let left = swings; left > 1; left -= 1) expect(swingAxeAt(tree, axe)).toBe('chop');
    // 刻み終えた木の前で、余力が倒す一撃に足りなくなった斧。**0にはしない**——0へ届いた刃は折れて
    // 無くなる（weathering.yaml）ので、その札は盤面に残らない。
    axe.getProperty(durabilityId).setNumberWithoutEvents(axeCostPerUse('buck'));

    expect(swingAxeAt(tree, axe), '刻み切った木は倒せる').toBe('fell');

    expect(
      itemsOn(forest).filter((name) => name === 'log'),
      '丸太は返る',
    ).toHaveLength(2);
    expect(axe.parent, '倒したところで斧は折れて無くなる').toBeUndefined();
  });

  it('斧を断る線は、その仕事が食う量と一致している', () => {
    // 線はその工程が食う量と同じところに引き、**刃を食わない手には仕事1つぶんの線を引く**
    // （docs/engine/DurabilitySystem.md 2.1節）——倒し切れない仕事を始めさせないため。**見るのは
    // まだ手を付けていない木にだけ**なので、刻む手の線は閾値ではなく、断る／断らないで当てる
    // （閾値を読むと、まだ何も払っていない木にだけ効く形かどうかは分からない）。
    const tree = spawnInto('broadleaf_tree', forest, 'fixtures');
    const trunk = spawnInto('driftwood_trunk', forest, 'fixtures');
    const axe = spawnInto('stone_axe', player, 'hand');
    const durabilityId = codex.propertyNames.getId('durability');
    const setDurability = (value: number): void =>
      axe.getProperty(durabilityId).setNumberWithoutEvents(value);
    const refusal = (target: WorldObject, step: string): string | undefined =>
      target
        .refusedCombinationsWith(axe, player)
        .find((combination) => combination.name === step)
        ?.unmetRequirement()?.reasonName;

    const fellCost = axeCostPerUse('fell');
    const buckCost = axeCostPerUse('buck');
    expect(buckCost, '玉切りは1回ぶんで済むので、倒し切るより安い').toBeLessThan(fellCost);
    expect(
      toolWearsOf(codex).find((row) => row.objectName === 'stone_axe' && row.stepName === 'chop'),
      '刻む手は刃を食わない（食う手は必ず何かを返す）',
    ).toBeUndefined();

    setDurability(fellCost);
    expect(
      tree.combinationsWith(axe, player).map((c) => c.name),
      '1本ぶんちょうどなら刻み始められる',
    ).toEqual(['chop']);

    setDurability(fellCost - 1);
    expect(refusal(tree, 'chop'), '1足りなければ刻ませない').toBe('too_worn');
    expect(
      trunk.combinationsWith(axe, player).map((c) => c.name),
      '倒せなくなっても、1回ぶんで済む玉切りは残る',
    ).toEqual(['buck']);

    setDurability(buckCost);
    expect(
      trunk.combinationsWith(axe, player).map((c) => c.name),
      '1回ぶんちょうどなら玉切れる',
    ).toEqual(['buck']);

    setDurability(buckCost - 1);
    expect(refusal(trunk, 'buck'), '玉切りの1回ぶんも割れば、そちらも断る').toBe('too_worn');
  });

  it('暗がりで尖った石を当てると、樹皮剥ぎが暗さを理由に断る', () => {
    const tree = spawnInto('broadleaf_tree', forest, 'fixtures');
    const knife = spawnInto('sharp_stone', player, 'hand');
    makeTooDarkToWork(player, codex);

    expect(tree.combinationsWith(knife, player).map((c) => c.name)).toEqual([]);
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
