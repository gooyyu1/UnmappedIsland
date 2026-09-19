import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/wrappers/Location';
import { PlayerCharacter } from '../../src/domain/wrappers/PlayerCharacter';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { makeBrightEnoughForAnyAction } from '../support/illumination';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * ドラッグ型の操作を「手にしている道具を条件で見るメニュー型」へ書き換えると何が変わるかを、
 * 元の宣言と写した宣言を並べて測る（ActionSystem.md 1.2節）。
 *
 * **メニュー型には `instrument` が居ない**（同 4節の表。参照は1階層で、道具を指すパスが無い）ので、
 * 書き換えるときは道具を見る条件と道具へ及ぶ効果を落とすほかない。落とすと何が変わるのかが、
 * 「ドラッグを残す」の根拠そのものなので、ここが赤くなったらその根拠が消えている。
 *
 * 写す先は、**道具に触れない宣言**（fiber.yamlのアバカ）と、**道具を見て道具を減らす宣言**
 * （timber.yamlの広葉樹）。書き換えの効き方が分かれるので、どちらも要る。
 *
 * **下のYAMLは元の宣言を手で写したもので、元が動いても自動では追わない。** 追わせなくてよいのは、
 * **比べる相手を実データから引いている**ため——元の要件や効果が動けば、写しではなくそちらの測定が
 * 落ちる（`too_worn` を消せば下の「ドラッグ型は断り」が、刃を減らす効果を消せば「斧が減る」が赤くなる）。
 * 写しはそのとき一緒に直す。
 */
const REWRITTEN_YAML = `
object_defs:
  # fiber.yamlのabacaのfellを、刃物のドラッグではなく「手に刃物があるか」で受ける形へ写したもの。
  # 元の宣言はinstrumentに触れないので、落ちるキーが無い。
  abaca_as_menu:
    tags: [fixture]
    art: abaca
    props:
      weight: {value: 25000}
    interactions:
      fell:
        trigger: menu
        conditions:
          - reason: no_blade
            subject: agent
            slot: hand
            matches: {tag: cutting_tool}
          - reason: too_dark
            subject: agent
            prop: looking_brightness
            in_stage_or_above: bright
          - reason: too_stormy
            not: {subject: agent, prop: wind_speed, in_stage_or_above: gale}
        duration: 20
        destroy: self
        spawn: {object: banana_stem, count: 5, into: agent}

  # timber.yamlのbroadleaf_treeのfellを同じ形へ写したもの。**元の宣言が持っていた、刃の余力を見る
  # 要件（subject: instrument）と刃を減らす効果（add: instrument）を落としている**。どちらも
  # メニュー型には書けないので、写した先に残す手段が無い。
  #
  # **受け口を刻む手（chop）は写していない。** 落ちる要件も効果も倒す手の側に在るので、
  # 比べるのに要るのはこちらだけ。
  broadleaf_tree_as_menu:
    tags: [fixture]
    art: broadleaf_tree
    props:
      weight: {value: 150000}
      trunk_integrity: {value: 1, range: {min: 1, max: 4}}
    interactions:
      fell:
        trigger: menu
        duration: 60
        conditions:
          - {prop: trunk_integrity, lte: 1}
          - reason: no_axe
            subject: agent
            slot: hand
            matches: {tag: chopping_tool}
          - reason: too_dark
            subject: agent
            prop: looking_brightness
            in_stage_or_above: bright
          - reason: too_stormy
            not: {subject: agent, prop: wind_speed, in_stage_or_above: gale}
        add:
          agent:
            skill_woodwork: 2
        spawn:
          - {object: log, count: 2, into: self}
          - {object: thick_branch, count: 3, into: self}
        destroy: self
`;

describe('ドラッグ型をメニュー型へ書き換えると何が変わるか', () => {
  let codex: WorldCodex;
  let session: WorldSession;
  let jungle: WorldObject;
  let player: WorldObject;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR)
      .load('rewritten.yaml', REWRITTEN_YAML)
      .buildAndReset();
  });

  beforeEach(() => {
    session = new WorldSession(codex, undefined, fixedRng(0));
    const worldInstance = session.createObject(def('world').globalId);
    session.adoptWorld(new World(worldInstance));

    jungle = spawnInto('jungle', worldInstance, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, jungle, 'characters');
    // 見たいのは書き換えの効き方だけなので、暗さと嵐の要件は作業者の側で満たす。
    makeBrightEnoughForAnyAction(player, codex);
  });

  function def(name: string): ObjectDef {
    return codex.objects.get(codex.objectNames.getId(name));
  }

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

  /** ドラッグ型の側のその手。今成立するものと、理由を告げて断るものの両方から引く。 */
  function dragAction(plant: WorldObject, tool: WorldObject, name: string) {
    return [...plant.combinationsWith(tool, player), ...plant.refusedCombinationsWith(tool, player)].find(
      (c) => c.name === name,
    );
  }

  /** メニュー型の側のその手。ボタンには常に並ぶので、成立しているかは要件が答える。 */
  function menuAction(plant: WorldObject, name: string) {
    const action = plant.menuActionsFor(player).find((a) => a.name === name);
    expect(action, 'メニュー型はボタンとして必ず並ぶ').toBeDefined();
    return action!;
  }

  const dragFell = (plant: WorldObject, tool: WorldObject) => dragAction(plant, tool, 'fell');
  const menuFell = (plant: WorldObject) => menuAction(plant, 'fell');

  /** 刃の余力。**無ければ落とす**——既定値で埋めると「減らない」が測れないまま緑になる。 */
  function durabilityOf(tool: WorldObject): number {
    return tool.getProperty(codex.propertyNames.getId('durability')).number;
  }

  describe('道具に触れない宣言（アバカ）は、成果物まで同じものが書ける', () => {
    it('刃物を手にしていれば、どちらも同じ成果物になる', () => {
      const dragPlant = spawnInto('abaca', jungle, 'fixtures');
      const menuPlant = spawnInto('abaca_as_menu', jungle, 'fixtures');
      const knife = spawnInto('sharp_stone', player, 'hand');

      expect(dragFell(dragPlant, knife)?.tryExecute()).toBe(true);
      const afterDrag = carriedBy(player);

      expect(menuFell(menuPlant).tryExecute()).toBe(true);
      const afterMenu = carriedBy(player).slice(afterDrag.length);

      expect(afterMenu, '採れる物も本数も同じ').toEqual(afterDrag.filter((name) => name === 'banana_stem'));
      expect(dragPlant.parent, 'ドラッグ型は株が消える').toBeUndefined();
      expect(menuPlant.parent, 'メニュー型も株が消える').toBeUndefined();
      expect(knife.parent, 'どちらも刃物は残る').toBe(player);
    });

    it('刃物が地面にあると、ドラッグ型だけが成立する', () => {
      const dragPlant = spawnInto('abaca', jungle, 'fixtures');
      const menuPlant = spawnInto('abaca_as_menu', jungle, 'fixtures');
      const knife = spawnInto('sharp_stone', jungle, 'items');

      expect(
        dragFell(dragPlant, knife)?.unmetRequirement(),
        'ドラッグ型は運ばれてきた札を見るので、居場所を問わない',
      ).toBeUndefined();
      expect(
        menuFell(menuPlant).unmetRequirement()?.reasonName,
        'メニュー型は手の枠を名指して見るので、地面の刃物は届かない',
      ).toBe('no_blade');
    });
  });

  describe('道具を見て道具を減らす宣言（広葉樹）は、書き換えると別の操作になる', () => {
    /**
     * 倒す手が立つところまで刻んだ木。**1回では倒れない**（docs/engine/ActionSystem.md 6.3節）ので、
     * 落ちる要件（刃の余力を見る）と効果（刃を減らす）を持つ手はここから先にしか現れない。
     */
    function treeReadyToFell(): WorldObject {
      const tree = spawnInto('broadleaf_tree', jungle, 'fixtures');
      tree.getProperty(codex.propertyNames.getId('trunk_integrity')).setNumberWithoutEvents(1);
      return tree;
    }

    it('刃の尽きた斧を、ドラッグ型は断り、メニュー型は通してしまう', () => {
      const dragTree = treeReadyToFell();
      const menuTree = spawnInto('broadleaf_tree_as_menu', jungle, 'fixtures');
      const axe = spawnInto('stone_axe', player, 'hand');
      // 1本ぶん（120）を割った刃。**0にはしない**——0へ届いた刃は折れて無くなる
      // （weathering.yaml の on_min）ので、尽きた斧という札は残らない。
      axe.getProperty(codex.propertyNames.getId('durability')).setNumber(100);

      expect(
        dragFell(dragTree, axe)?.unmetRequirement()?.reasonName,
        '刃の余力を見る要件はinstrumentを指すので、ドラッグ型にしか書けない',
      ).toBe('too_worn');
      expect(
        menuFell(menuTree).unmetRequirement(),
        '書き換えた側はその要件を落としているので、尽きた斧でも通る',
      ).toBeUndefined();

      expect(menuFell(menuTree).tryExecute()).toBe(true);
      expect(itemsOn(jungle), '尽きた斧で丸太が採れてしまう').toEqual([
        'log',
        'log',
        'thick_branch',
        'thick_branch',
        'thick_branch',
      ]);
    });

    it('倒しても斧が減らない', () => {
      const menuTree = spawnInto('broadleaf_tree_as_menu', jungle, 'fixtures');
      const axe = spawnInto('stone_axe', player, 'hand');
      // **屋外に在るだけで進む劣化（weathering.yaml）は、倒した斧にも置いた斧にも同じだけ掛かる。**
      // 突き合わせる相手を置くことで、倒したこと自体が減らしていないかだけを見る。
      const idle = spawnInto('stone_axe', jungle, 'items');

      expect(menuFell(menuTree).tryExecute()).toBe(true);

      expect(durabilityOf(axe), '刃を減らす効果はinstrumentを指すので、写す先が無い').toBe(
        durabilityOf(idle),
      );
    });

    it('ドラッグ型のままなら、同じ1回で斧が減る', () => {
      const dragTree = treeReadyToFell();
      const axe = spawnInto('stone_axe', player, 'hand');
      const before = durabilityOf(axe);
      // **置いた相手と突き合わせる**——屋外の劣化だけでも減るので、差だけを見ると倒したことが
      // 減らしたのかが言えない。
      const idle = spawnInto('stone_axe', jungle, 'items');

      expect(dragFell(dragTree, axe)?.tryExecute()).toBe(true);

      expect(durabilityOf(axe)).toBeLessThan(before);
      expect(durabilityOf(axe), '置いた斧より深く減る（倒したぶん）').toBeLessThan(durabilityOf(idle));
    });
  });

  describe('落とした要件と効果は、メニュー型へは書けない', () => {
    /** 書けない理由まで見る——別の綴り間違いで落ちたのを「書けない」と読まないように。 */
    const NO_INSTRUMENT_HERE = /参照ルート 'instrument' は使えません/;

    function loadWithMenuInteraction(body: string): () => WorldCodex {
      return () =>
        loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR)
          .load(
            'menu_with_instrument.yaml',
            `
object_defs:
  menu_with_instrument:
    tags: [fixture]
    interactions:
      fell:
        trigger: menu
${body}
`,
          )
          .buildAndReset();
    }

    it('道具を見る要件は、メニュー型に書くとロードで落ちる', () => {
      expect(
        loadWithMenuInteraction(
          '        conditions:\n          - {subject: instrument, prop: durability, gt: 0}',
        ),
      ).toThrow(NO_INSTRUMENT_HERE);
    });

    it('道具へ及ぶ効果は、メニュー型に書くとロードで落ちる', () => {
      expect(
        loadWithMenuInteraction('        add:\n          instrument:\n            durability: -120'),
      ).toThrow(NO_INSTRUMENT_HERE);
    });
  });
});
