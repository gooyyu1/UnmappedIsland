import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/views/Location';
import { PlayerCharacter } from '../../src/domain/views/PlayerCharacter';
import { World } from '../../src/domain/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * coconut.yamlのヤシの実の加工の連鎖を、実ファイルの定義だけで検証する。熟度で分かれる2本
 * （青い実: 木を登って採り、穴を開けて水を飲み、割ってゼリーを採る／熟した実: 皮をはぎ、割り、
 * 果肉を掻き出して器を残す）をそれぞれ一続きで通す。熟した実の入手は土地の探索なので、ここでは扱わない。
 */
describe('coconut.yamlのヤシの実の加工', () => {
  let codex: WorldCodex;
  let session: WorldSession;
  let worldView: World;
  let beach: WorldObject;
  let player: WorldObject;
  let hydrationId: number;

  beforeAll(() => {
    // 刃物（tools.yaml）・土地（locations.yaml）・殻の容器（liquid_containers.yaml）への
    // ファイルをまたぐ参照があるため、ディレクトリ全体を一括ロードする。
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    hydrationId = codex.propertyNames.getId('hydration');
  });

  beforeEach(() => {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    worldView = new World(worldInstance, codex.propertyNames, codex.symbolNames);
    // 実採りは確率で捻挫する（injuries.yaml）。ここは加工の連鎖を見るテストなので、必ず成功する側を引く。
    session = new WorldSession(codex, worldView, fixedRng(0));

    beach = spawnInto('sandy_beach', worldInstance, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, beach, 'characters');
  });

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.spawn(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlot(parent, codex.slotNames.getId(slotName))).toBeUndefined();
    return spawned;
  }

  /** 土地のitemsスロットに並ぶ物の識別子。 */
  function itemsOn(location: WorldObject): string[] {
    return new Location(location, codex).items.map((object) => object.def.name);
  }

  /** 土地のitemsスロットに並ぶカードの識別子と、そのカードが束ねている個数。 */
  function itemStacksOn(location: WorldObject): string[] {
    return new Location(location, codex).itemStacks.map((stack) => `${stack[0].def.name} x${stack.length}`);
  }

  /** 土地のitemsスロットに並ぶ物の重さ（g）。 */
  function weightsOn(location: WorldObject): number[] {
    const weightId = codex.propertyNames.getId('weight');
    return new Location(location, codex).items.map((object) => object.getNumber(weightId));
  }

  /** 手持ちに並ぶ物の識別子（同種のスタックは個数ぶん並べる）。 */
  function handOf(character: WorldObject): string[] {
    return new PlayerCharacter(character, codex).handStacks.flatMap((stack) =>
      stack.map((object) => object.def.name),
    );
  }

  /** 道具を手に取り、対象のカードへドラッグしてcombinationを1つ実行する。 */
  function combine(target: WorldObject, toolName: string, combinationName: string): void {
    const tool = spawnInto(toolName, player, 'hand');
    expect(target.tryExecuteCombination(tool, player, combinationName, session)).toBe(true);
    expect(tool.parent, '道具は消費されない').toBe(player);
  }

  it('ヤシの木に登ると、手持ちに青い実が増える', () => {
    const tree = spawnInto('palm_tree', beach, 'fixtures');

    expect(tree.tryExecuteAction('pick_green_coconut', player, session)).toBe(true);

    expect(handOf(player), '1回登ればまとめて採れる').toEqual(['green_coconut', 'green_coconut']);
    expect(tree.parent, 'ヤシの木は残る').toBe(beach);
    expect(worldView.hour, 'durationの30分が経つ').toBe(0);
    expect(worldView.minute).toBe(30);
  });

  it('手持ちが埋まっていると、採った実は装備欄ではなく足元へ落ちる', () => {
    const tree = spawnInto('palm_tree', beach, 'fixtures');
    // 手持ち6枠を別々の型で埋める（同種は1枠にまとまるため、6種類必要）。
    for (const name of ['stone', 'sharp_stone', 'twig', 'thick_branch', 'taro', 'water_spinach'])
      spawnInto(name, player, 'hand');

    expect(tree.tryExecuteAction('pick_green_coconut', player, session)).toBe(true);

    expect(new PlayerCharacter(player, codex).equipmentStacks, '装備欄は自動配置の対象外（7.7節）').toEqual(
      [],
    );
    expect(itemsOn(beach)).toEqual(['green_coconut', 'green_coconut']);
  });

  it('青い実に穴を開けると、その場で水を飲み、水の抜けた実が残る', () => {
    const green = spawnInto('green_coconut', beach, 'items');
    // 空になる寸前から。0にすると、穴を開ける15分の間に水分が尽きて渇きで死ぬ（VitalsSystem.md 8節）。
    player.setProperty(hydrationId, 1);

    combine(green, 'sharp_stone', 'bore');

    expect(player.getNumber(hydrationId), '1個ぶんの水500mL = 20 tick分').toBe(20);
    expect(itemsOn(beach), '実は元の実が居た場所へ置き換わる').toEqual(['drained_green_coconut']);
  });

  it('水分が満水でも穴は開けられる（飲みきれない分はこぼれる）', () => {
    // 条件で塞ぐと満水の間だけ連鎖が止まるため、あえて条件を持たせていない（coconut.yaml）。
    const green = spawnInto('green_coconut', beach, 'items');
    const hydrationMax = codex.objects
      .get(codex.objectNames.getId(SAMPLE_CHARACTER))
      .getPropertyDef(hydrationId)!.range!.max;
    player.setProperty(hydrationId, hydrationMax);

    combine(green, 'sharp_stone', 'bore');

    expect(player.getNumber(hydrationId), 'あふれる分は失われる').toBe(hydrationMax);
    expect(itemsOn(beach)).toEqual(['drained_green_coconut']);
  });

  it('水を飲んだ青い実を割ると、ゼリー状の果肉が2つ採れる（器は残らない）', () => {
    const drained = spawnInto('drained_green_coconut', beach, 'items');

    combine(drained, 'sharp_stone', 'split');

    expect(itemsOn(beach), '薄い殻は器にならないので、果肉だけが残る').toEqual([
      'coconut_jelly',
      'coconut_jelly',
    ]);
  });

  it('ゼリー状の果肉を食べると、水分は入るが腹には残らない', () => {
    const jelly = spawnInto('coconut_jelly', player, 'hand');
    const satietyId = codex.propertyNames.getId('satiety');
    // 食べるのに1 tickかかり、時間は効果より先に進む（actionTime参照）。0から測ると、その1 tickで
    // 水分が尽きて渇き死ぬので、1 tickぶんの減り（satiety -16・hydration -1）を載せた値から測る。
    player.setProperty(satietyId, 16);
    player.setProperty(hydrationId, 1);

    expect(jelly.tryExecuteAction('eat', player, session)).toBe(true);

    expect(player.getNumber(hydrationId)).toBeCloseTo(5.2, 10);
    expect(player.getNumber(satietyId), '熟した果肉（200mL）より小さい').toBe(150);
    expect(jelly.parent, '食べた果肉は消える').toBeUndefined();
  });

  it('実1個ぶんの水分は、青い実が熟した実を上回る（登る理由になっている）', () => {
    // 青い実 = 水20 + ゼリー2個×5.2、熟した実 = 果肉2個×6（coconut.yaml。単位はtick分）。
    const waterOf = (name: string, action: string) => {
      const target = spawnInto(name, player, 'hand');
      // 1 tickぶんの減り（-1）を載せた値から測る（上のテスト参照）。
      player.setProperty(hydrationId, 1);
      expect(target.tryExecuteAction(action, player, session)).toBe(true);
      return player.getNumber(hydrationId);
    };

    const green = 20 + 2 * waterOf('coconut_jelly', 'eat');
    const mature = 2 * waterOf('coconut_meat', 'eat');

    expect(green).toBeCloseTo(30.4, 10);
    expect(mature).toBe(12);
  });

  it('熟したヤシの実に刃物を当てると、皮を剥いだ実と皮に分かれる', () => {
    const coconut = spawnInto('coconut', beach, 'items');

    combine(coconut, 'sharp_stone', 'husk');

    expect(itemsOn(beach), '実も皮も、元の実が居た場所へ宣言順に並んで置き換わる').toEqual([
      'husked_coconut',
      'coconut_husk',
    ]);
    expect(weightsOn(beach), '1400gの実が800gの実と600gの皮に分かれる（重さが増えも減りもしない）').toEqual([
      800, 600,
    ]);
    expect(handOf(player), '道具以外は手元へ入らない').toEqual(['sharp_stone']);
  });

  it('手持ちのヤシの実の皮をはぐと、実も皮も手持ちに残る', () => {
    const coconut = spawnInto('coconut', player, 'hand');

    combine(coconut, 'sharp_stone', 'husk');

    expect(handOf(player), '皮も手持ちに収まる（実の隣の枠へ入る）').toEqual([
      'husked_coconut',
      'coconut_husk',
      'sharp_stone',
    ]);
    expect(itemsOn(beach), '足元へこぼれるものは無い').toEqual([]);
  });

  it('手持ちが埋まっていると、はいだ皮だけが足元へ落ちる', () => {
    const coconut = spawnInto('coconut', player, 'hand');
    // 実と道具を除く残り4枠を別々の型で埋める（同種は1枠にまとまるため、4種類必要）。
    for (const name of ['stone', 'twig', 'thick_branch', 'taro']) spawnInto(name, player, 'hand');

    combine(coconut, 'sharp_stone', 'husk');

    expect(handOf(player), '実は元の実の枠を引き継ぎ、皮の入る枠は残っていない').toEqual([
      'husked_coconut',
      'stone',
      'twig',
      'thick_branch',
      'taro',
      'sharp_stone',
    ]);
    expect(itemsOn(beach)).toEqual(['coconut_husk']);
  });

  it.each([
    ['stone', 'crack'],
    ['sharp_stone', 'pry_open'],
  ])('皮を剥いだ実は%sで割れ、割れた実が2つできる', (toolName, combinationName) => {
    const holed = spawnInto('husked_coconut', beach, 'items');

    combine(holed, toolName, combinationName);

    expect(itemsOn(beach), '割れた実は2つとも、元の実が居た場所の1スタックへ収まる').toEqual([
      'coconut_half',
      'coconut_half',
    ]);
    expect(weightsOn(beach), '800gの実が300g×2になる（差の200gは割ってこぼれる水）').toEqual([300, 300]);
    expect(handOf(player)).toEqual([toolName]);
  });

  // issue #299 の再現手順。アイテムレーンで割ると、既存の割れた実のカードへ積み上がる。
  it('レーンに割れた実があるとき、新たに割った実は既存のカードへスタックする', () => {
    const husked = spawnInto('husked_coconut', beach, 'items');
    spawnInto('coconut_half', beach, 'items');

    combine(husked, 'sharp_stone', 'pry_open');

    expect(itemStacksOn(beach), '割れた実のカードは1枚のまま3個に増える').toEqual(['coconut_half x3']);
  });

  it('割れた実に刃物を当てると、果肉が採れて殻が残る', () => {
    const half = spawnInto('coconut_half', beach, 'items');

    combine(half, 'sharp_stone', 'scrape');

    expect(itemsOn(beach), '果肉と殻は割れた実が居た場所へ宣言順に並んで置き換わる').toEqual([
      'coconut_meat',
      'coconut_bowl',
    ]);
    expect(weightsOn(beach), '300gの実が200gの果肉と100gの殻に分かれる（掻き出しでは何も失わない）').toEqual([
      200, 100,
    ]);
    expect(handOf(player)).toEqual(['sharp_stone']);
  });

  it('ヤシの殻は液体を入れられ、持ち歩ける', () => {
    const bowl = spawnInto('coconut_bowl', player, 'hand');
    const water = session.spawn(codex.objectNames.getId('water_liquid'));

    expect(water.moveToSlot(bowl, codex.slotNames.getId('content'))).toBeUndefined();
    expect(handOf(player), '手持ちのaccepts（itemタグ）を通る').toEqual(['coconut_bowl']);
  });

  it('果肉を食べると満腹度・水分・栄養が増え、果肉は無くなる', () => {
    const meat = spawnInto('coconut_meat', player, 'hand');
    const satietyId = codex.propertyNames.getId('satiety');
    const lipidId = codex.propertyNames.getId('lipid');
    // 1 tickぶんの減りを載せた値から測る（上のテスト参照）。脂質は在庫が0だと輸送も動かない。
    player.setProperty(satietyId, 16);
    player.setProperty(hydrationId, 1);
    player.setProperty(lipidId, 0);

    expect(meat.tryExecuteAction('eat', player, session)).toBe(true);

    expect(player.getNumber(satietyId)).toBe(200);
    expect(player.getNumber(hydrationId)).toBe(6);
    expect(player.getNumber(lipidId), '脂質が多い').toBe(26);
    expect(meat.parent, '食べた果肉は消える').toBeUndefined();
  });

  it.each(['coconut', 'green_coconut'])(
    '生の実（%s）は食べられない（連鎖を通さないと栄養にならない）',
    (name) => {
      const raw = spawnInto(name, player, 'hand');

      expect(raw.tryExecuteAction('eat', player, session)).toBe(false);
    },
  );
});
