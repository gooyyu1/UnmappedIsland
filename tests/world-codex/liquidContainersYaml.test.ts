import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import {
  loadYamlDirectory,
  loadYamlFile,
  SAMPLE_CHARACTER,
  worldCodexPath,
} from '../support/worldCodexFiles';

describe('liquid_containers.yamlの液体容器定義', () => {
  let codex: WorldCodex;
  let nextInstanceId: number;
  let hydrationId: number;
  let wakefulnessId: number;
  let weatherId: number;
  let hourId: number;
  let locationsSlotId: number;
  let fillId: number;

  beforeAll(() => {
    const loader = new WorldCodexYamlLoader();
    loadYamlFile(loader, worldCodexPath('core.yaml'));
    loadYamlDirectory(loader, worldCodexPath('characters'));
    loadYamlFile(loader, worldCodexPath('liquid_containers.yaml'));
    codex = loader.build();

    hydrationId = codex.propertyNames.getId('hydration');
    wakefulnessId = codex.propertyNames.getId('wakefulness');
    weatherId = codex.propertyNames.getId('weather');
    hourId = codex.propertyNames.getId('hour');
    locationsSlotId = codex.slotNames.getId('locations');
    fillId = codex.propertyNames.getId('fill');
  });

  beforeEach(() => {
    nextInstanceId = 1;
  });

  function spawn(objectName: string): WorldObject {
    return new WorldObject(
      nextInstanceId++,
      codex.objects.get(codex.objectNames.getId(objectName)),
      new WorldSession(codex),
    );
  }

  /**
   * 液体入りの容器。**中身入りは容器の変種**（3.5節）なので、置く物は無く、その型のインスタンスを
   * 生んで量（fill）を入れるだけ。
   */
  function spawnContainer(containerName: string, liquidKind: string, size: number): WorldObject {
    const container = spawn(`${containerName}__content_${liquidKind}_liquid`);
    container.getProperty(fillId).overwrite(size);
    return container;
  }

  /** 中身の型（空の容器ならundefined）。中身は軸`content`の値。 */
  function contentOf(container: WorldObject): ObjectDef | undefined {
    const value = codex.variationsOf(container.def).get('content');
    return value === undefined ? undefined : codex.objects.get(codex.objectNames.getId(value));
  }

  function amountIn(container: WorldObject): number {
    return container.tryGetProperty(fillId)?.number ?? 0;
  }

  /** その容器が抱えられる量の上限（中身入りの変種のfillのrangeが持つ）。 */
  function capacityOf(containerName: string): number | undefined {
    const def = codex.objects.get(codex.objectNames.getId(`${containerName}__content_water_liquid`));
    return def.enumeratePropertyDefs().find((p) => p.globalId === fillId)?.range?.max;
  }

  /** hourは既定で昼（10-17時のdayステージ）。sunlightはhourとweatherの寄与の和で決まる。 */
  function spawnWorld(weather: string, hour = 12): WorldObject {
    const world = spawn('world');
    world.getProperty(weatherId).overwrite(codex.symbolNames.intern(weather));
    world.getProperty(hourId).overwrite(hour);
    return world;
  }

  function spawnEmptyUnderWorld(containerName: string, world: WorldObject): WorldObject {
    const container = spawn(containerName);
    container.moveToSlot(world, locationsSlotId, true);
    return container;
  }

  function spawnContainerUnderWorld(
    containerName: string,
    liquidKind: string,
    size: number,
    world: WorldObject,
  ): WorldObject {
    const container = spawnContainer(containerName, liquidKind, size);
    container.moveToSlot(world, locationsSlotId, true);
    return container;
  }

  it('空の容器は中身の宣言を一切持たず、中身入りは同じ型に畳まれている', () => {
    const canteen = codex.objects.get(codex.objectNames.getId('canteen'));
    const filled = codex.objects.get(codex.objectNames.getId('canteen__content_water_liquid'));

    expect(canteen.actions, '空の容器は中身の行動を持たない').toHaveLength(0);
    expect(canteen.combinations, '注ぎ移しを宣言するのは中身の側').toHaveLength(0);
    // volumeは容器自身の外寸のかさで、抱えている量はfillが持つ（LiquidContainerSystem.md 5節）。
    // **空の容器もfillを持つ**——空とは量が0であることで、増やせるのは中身のtraitを配られた変種だけ。
    expect(canteen.getPropertyDef(fillId)?.range?.max, '空の容器も上限を持つ').toBe(1000);
    expect(canteen.getPropertyDef(codex.propertyNames.getId('density')), '密度も中身のもの').toBeUndefined();

    expect(codex.baseOf(filled), '中身入りは容器の変種').toBe(canteen);
    expect(
      filled.actions.map((action) => action.name),
      '中身のdrinkが自分の行動になる',
    ).toEqual(['drink']);
    expect(filled.getPropertyDef(fillId)?.range?.max, '上限は素の型から引き継ぐ').toBe(1000);
  });

  it('中身入りの容器の重さは、容器の自重と水の重さの和になる', () => {
    // weight = volume × density（mL × g/mL = g、ContainerSystem.md 1節）。密度の桁が狂うと
    // ここだけが静かに壊れる——実ファイルの値で確かめる場所を1つ持っておく。
    const bowl = spawnContainer('coconut_bowl', 'water', 250);
    const weightId = codex.propertyNames.getId('weight');
    const densityId = codex.propertyNames.getId('density');

    expect(bowl.tryGetProperty(densityId)?.number ?? 0, '水は1g/mL').toBe(1);
    expect(bowl.tryGetProperty(weightId)?.getEffectiveValue() ?? 0, 'ヤシの器100g + 水250mL = 350g').toBe(
      350,
    );

    bowl.tryGetProperty(fillId)?.setNumber(100);

    expect(bowl.tryGetProperty(weightId)?.getEffectiveValue() ?? 0, '飲めばそのぶん軽くなる').toBe(200);
  });

  it('容量は軸の宣言が変種へ渡すfillのrangeが決める', () => {
    expect(capacityOf('coconut_bowl'), 'ヤシの器は250mL').toBe(250);
    expect(capacityOf('canteen'), '水筒は1L').toBe(1000);
    expect(capacityOf('bottle'), '瓶は2L').toBe(2000);
    expect(capacityOf('jar'), '甕は4L').toBe(4000);
  });

  it('水を飲むと中身のvolumeからactorのhydrationへ移る', () => {
    const actor = spawn(SAMPLE_CHARACTER);
    actor.getProperty(hydrationId).overwrite(0);
    const canteen = spawnContainer('canteen', 'water', 1000);

    expect(canteen.tryExecuteAction('drink', actor), '容器への操作は中身へ委譲される').toBe(true);

    expect(actor.tryGetProperty(hydrationId)?.number ?? 0, '250mLは10 tick分（to_amount、9.5節）').toBe(10);
    expect(amountIn(canteen), '減るのは液体の単位（mL）のまま').toBe(750);
  });

  it('水分が満水だと飲めず、理由not_thirstyを返す', () => {
    // 満水では0mLの何も起きない飲用になるため、実行自体をさせない（liquid_containers.yaml）。
    const actor = spawn(SAMPLE_CHARACTER);
    const hydrationMax = codex.objects
      .get(codex.objectNames.getId(SAMPLE_CHARACTER))
      .getPropertyDef(hydrationId)!.range!.max;
    actor.getProperty(hydrationId).overwrite(hydrationMax);
    const canteen = spawnContainer('canteen', 'water', 1000);

    expect(canteen.actionUnmetRequirement('drink', actor)?.reasonName).toBe('not_thirsty');
    expect(canteen.tryExecuteAction('drink', actor)).toBe(false);
    expect(amountIn(canteen), '実行されないので量は変わらない').toBe(1000);
  });

  it('水分が満水の一歩手前なら飲め、入る分だけが移る', () => {
    const actor = spawn(SAMPLE_CHARACTER);
    const hydrationMax = codex.objects
      .get(codex.objectNames.getId(SAMPLE_CHARACTER))
      .getPropertyDef(hydrationId)!.range!.max;
    actor.getProperty(hydrationId).overwrite(hydrationMax - 4);
    const canteen = spawnContainer('canteen', 'water', 1000);

    expect(canteen.actionUnmetRequirement('drink', actor)).toBeUndefined();
    expect(canteen.tryExecuteAction('drink', actor)).toBe(true);

    expect(actor.tryGetProperty(hydrationId)?.number ?? 0, 'あふれる分は飲まない').toBe(hydrationMax);
    // 空きは4 tick分。移送元の単位へ割り戻すと 4 × 250 / 10 = 100mL しか出ない（9.5節）。
    expect(amountIn(canteen), '入る分だけ減る').toBe(900);
  });

  it('残りを飲み切ると、中身のインスタンスごと消えて空の容器へ戻る', () => {
    const actor = spawn(SAMPLE_CHARACTER);
    actor.getProperty(hydrationId).overwrite(0);
    const canteen = spawnContainer('canteen', 'water', 100); // 1回分(250)より少ない

    expect(canteen.tryExecuteAction('drink', actor)).toBe(true);

    expect(actor.tryGetProperty(hydrationId)?.number ?? 0, '残っている分だけ飲む（100mL = 4 tick分）').toBe(
      4,
    );
    expect(contentOf(canteen), 'tickを待たずに空へ戻る（0mLの水は存在しない）').toBeUndefined();
  });

  it('お茶を飲むと追加の効果も適用できる', () => {
    const actor = spawn(SAMPLE_CHARACTER);
    actor.getProperty(hydrationId).overwrite(0);
    actor.getProperty(wakefulnessId).overwrite(0);
    const canteen = spawnContainer('canteen', 'tea', 1000);

    expect(canteen.tryExecuteAction('drink', actor)).toBe(true);

    expect(actor.tryGetProperty(hydrationId)?.number ?? 0).toBe(10);
    expect(actor.tryGetProperty(wakefulnessId)?.number ?? 0).toBe(2);
  });

  it('お茶のwakefulness効果は飲んだ量に比例する', () => {
    const actor = spawn(SAMPLE_CHARACTER);
    actor.getProperty(hydrationId).overwrite(0);
    actor.getProperty(wakefulnessId).overwrite(0);
    const canteen = spawnContainer('canteen', 'tea', 125); // 1回分(250)の半分しか無い

    expect(canteen.tryExecuteAction('drink', actor)).toBe(true);

    expect(actor.tryGetProperty(hydrationId)?.number ?? 0, '在庫の分だけ飲む（125mL = 5 tick分）').toBe(5);
    expect(actor.tryGetProperty(wakefulnessId)?.number ?? 0, 'linked_addは実際に移った量に比例する').toBe(1);
  });

  it('油にはdrinkアクションが無い', () => {
    const actor = spawn(SAMPLE_CHARACTER);
    const canteen = spawnContainer('canteen', 'oil', 1000);

    expect(canteen.tryExecuteAction('drink', actor), '飲用不可の液体はdrinkを持たない').toBe(false);
  });

  /**
   * 中身のバーの色は液体自身が宣言する（CardView.md 8節 カードの状態バー）。宣言し忘れた液体は
   * 灰色で出るだけで画面を見ても気付けないため、ここで全ての液体が持っていることを検査する。
   */
  it('液体はすべて自分の色を宣言している', () => {
    const colorId = codex.propertyNames.getId('color');
    // 中身入りの変種も液体のtraitを配られてliquidタグを持つので、配る側の束だけを見る。
    const liquids = codex
      .objectDefNamesWithTag('liquid')
      .filter((name) => !codex.isGenerated(codex.objects.get(codex.objectNames.getId(name))));
    expect(liquids.length, '検査対象が無い（liquidタグが変わっていないか）').toBeGreaterThan(0);

    const colors = liquids.map((name) => {
      const color = spawn(name).tryGetProperty(colorId)?.getEffectiveValue();
      expect(color, `'${name}' が色を宣言していない`).toBeDefined();
      return color;
    });
    expect(new Set(colors).size, '同じ色の液体は見分けが付かない').toBe(colors.length);
  });

  it('水は青、茶は茶緑、油は黄色に見える', () => {
    const colorId = codex.propertyNames.getId('color');
    const [water, tea, oil] = ['water', 'tea', 'oil'].map((kind) => {
      const color = spawn(`${kind}_liquid`).tryGetProperty(colorId)?.number ?? 0;
      return { red: (color >> 16) & 0xff, green: (color >> 8) & 0xff, blue: color & 0xff };
    });

    expect(water.blue, '水は青が最も強い').toBeGreaterThan(Math.max(water.red, water.green));
    expect(tea.green, '茶は緑が最も強い').toBeGreaterThan(Math.max(tea.red, tea.blue));
    expect(Math.min(oil.red, oil.green), '油は赤と緑が揃って強い＝黄色').toBeGreaterThan(oil.blue);
  });

  // 昼のsunlightは cloudy 7 / clear 10 / sunny 12 / scorching 15。
  it.each([
    ['cloudy', -1],
    ['clear', -1],
    ['sunny', -2],
    ['scorching', -3],
  ])('coconut_bowlの昼の蒸発量は日差しの強さ(%s)で決まる', (weather, expectedDelta) => {
    const world = spawnWorld(weather);
    const bowl = spawnContainerUnderWorld('coconut_bowl', 'water', 100, world);

    bowl.tick();

    expect(amountIn(bowl)).toBe(100 + expectedDelta);
  });

  it.each([
    ['cloudy', -2],
    ['clear', -4],
    ['sunny', -6],
    ['scorching', -8],
  ])('jarの昼の蒸発量は日差しの強さ(%s)で決まる', (weather, expectedDelta) => {
    const world = spawnWorld(weather);
    const jar = spawnContainerUnderWorld('jar', 'water', 200, world);

    jar.tick();

    expect(amountIn(jar)).toBe(200 + expectedDelta);
  });

  it.each([
    ['coconut_bowl', -1],
    ['jar', -2],
  ])('夜(%s)は日射の上乗せが消え、基礎の蒸発だけが残る', (containerName, expectedDelta) => {
    const world = spawnWorld('scorching', 0); // 夜はsunlightが0にクランプされる
    const container = spawnContainerUnderWorld(containerName, 'water', 200, world);

    container.tick();

    expect(amountIn(container)).toBe(200 + expectedDelta);
  });

  it.each([
    ['coconut_bowl', -2],
    ['jar', -6],
  ])('朝夕(%s)の日差しは昼より弱い', (containerName, expectedDelta) => {
    const world = spawnWorld('scorching', 7); // sunlight 12（昼のsunnyと同値）
    const container = spawnContainerUnderWorld(containerName, 'water', 200, world);

    container.tick();

    expect(amountIn(container)).toBe(200 + expectedDelta);
  });

  // 雨天は蒸発せず（蒸発の基礎は雨天を除外する）、代わりに降った分だけ増える。
  it.each([
    ['light_rain', 10],
    ['heavy_rain', 20],
    ['storm', 40],
  ])('coconut_bowlに溜まる雨の量は降り方(%s)で決まる', (weather, expectedDelta) => {
    const world = spawnWorld(weather);
    const bowl = spawnContainerUnderWorld('coconut_bowl', 'water', 100, world);

    bowl.tick();

    expect(amountIn(bowl)).toBe(100 + expectedDelta);
  });

  it.each([
    ['light_rain', 20],
    ['heavy_rain', 40],
    ['storm', 80],
  ])('jarに溜まる雨の量は降り方(%s)で決まる', (weather, expectedDelta) => {
    const world = spawnWorld(weather);
    const jar = spawnContainerUnderWorld('jar', 'water', 100, world);

    jar.tick();

    expect(amountIn(jar)).toBe(100 + expectedDelta);
  });

  it.each(['canteen', 'pot', 'bottle'])('密閉容器(%s)には雨が溜まらない', (objectName) => {
    const world = spawnWorld('storm');
    const container = spawnContainerUnderWorld(objectName, 'water', 100, world);

    container.tick();

    expect(amountIn(container)).toBe(100);
  });

  it('雨で増えるのは水だけで、茶の入った容器は開いていても増えない', () => {
    const world = spawnWorld('storm');
    const bowl = spawnContainerUnderWorld('coconut_bowl', 'tea', 100, world);

    bowl.tick();

    expect(amountIn(bowl)).toBe(100);
  });

  it('capacityを超えて降った分はあふれて失われる', () => {
    const world = spawnWorld('storm'); // ヤシの器へ1tickに40mL
    const bowl = spawnContainerUnderWorld('coconut_bowl', 'water', 240, world);

    bowl.tick();

    expect(amountIn(bowl), '満杯(250)で止まる').toBe(250);
  });

  it('雨が降っていれば、空の容器に雨を貯め始められる', () => {
    const actor = spawn(SAMPLE_CHARACTER);
    const world = spawnWorld('light_rain');
    const bowl = spawnEmptyUnderWorld('coconut_bowl', world);

    expect(bowl.actionUnmetRequirement('collect_rain', actor)).toBeUndefined();
    expect(bowl.tryExecuteAction('collect_rain', actor)).toBe(true);

    expect(contentOf(bowl)?.name, '溜まるのは水').toBe('water_liquid');
    expect(amountIn(bowl), '最少の量で始まり、以後は降っている間に増える').toBe(1);
  });

  it('貯め始めた雨は、そのまま降り続けるぶんだけ増える', () => {
    const actor = spawn(SAMPLE_CHARACTER);
    const world = spawnWorld('light_rain');
    const bowl = spawnEmptyUnderWorld('coconut_bowl', world);

    bowl.tryExecuteAction('collect_rain', actor);
    bowl.tick();

    expect(amountIn(bowl)).toBe(1 + 10);
  });

  it('雨が降っていなければ貯められず、理由not_rainingを返す', () => {
    const actor = spawn(SAMPLE_CHARACTER);
    const world = spawnWorld('clear');
    const bowl = spawnEmptyUnderWorld('coconut_bowl', world);

    expect(bowl.actionUnmetRequirement('collect_rain', actor)?.reasonName).toBe('not_raining');
    expect(bowl.tryExecuteAction('collect_rain', actor)).toBe(false);
    expect(contentOf(bowl), '空のまま').toBeUndefined();
  });

  it('中身の入った容器では雨を貯めるアクションが出ない（操作が中身へ委譲されるため）', () => {
    const actor = spawn(SAMPLE_CHARACTER);
    const world = spawnWorld('light_rain');
    const bowl = spawnContainerUnderWorld('coconut_bowl', 'water', 100, world);

    expect(bowl.tryExecuteAction('collect_rain', actor)).toBe(false);

    expect(amountIn(bowl), '溜まり続けるのはpassiveの仕事で、操作は要らない').toBe(100);
  });

  it.each(['canteen', 'pot', 'bottle'])('密閉容器(%s)は雨を貯めるアクション自体を持たない', (name) => {
    const actor = spawn(SAMPLE_CHARACTER);
    const world = spawnWorld('storm');
    const container = spawnEmptyUnderWorld(name, world);

    expect(container.tryExecuteAction('collect_rain', actor)).toBe(false);
    expect(contentOf(container)).toBeUndefined();
  });

  it.each(['canteen', 'pot', 'bottle'])('密閉容器(%s)は蒸発しない', (objectName) => {
    const world = spawnWorld('scorching');
    const container = spawnContainerUnderWorld(objectName, 'water', 100, world);

    container.tick();

    expect(amountIn(container)).toBe(100);
  });

  it('蒸発で量が尽きると中身のインスタンスごと消える', () => {
    const world = spawnWorld('clear');
    const bowl = spawnContainerUnderWorld('coconut_bowl', 'water', 1, world);

    bowl.tick();

    expect(contentOf(bowl), '量が0なら中身の軸が落ちて素の器へ戻る').toBeUndefined();
  });

  it('中身の液体は器から出せない', () => {
    // 中身は容器自身のfillなので、掴んで運べる液体のインスタンスがそもそも存在しない
    // （LiquidContainerSystem.md 2節）。別の器へ移すのは注ぎ移しの仕事。
    const jar = spawnContainer('jar', 'water', 800);

    expect(jar.children().next().done, '中身として置かれている物は無い').toBe(true);
    expect(amountIn(jar), '量は容器自身が持つ').toBe(800);
  });

  it('空の容器へ注ぐと、注ぎ先がその液体の変種になる', () => {
    const empty = spawn('canteen');
    const jar = spawnContainer('jar', 'water', 800);

    // 宣言を持つのは中身入りの側だけなので、selfは注ぎ元・draggedは空の容器（12.3節）。
    expect(jar.tryExecuteCombination(empty, undefined, 'pour_into_empty')).toBe(true);

    expect(amountIn(empty), '全量が移る').toBe(800);
    expect(jar.def.name, '注ぎ切った側は空の容器へ戻る').toBe('jar');
  });

  it('同じ種類の中身が入った容器へ注ぐと継ぎ足される', () => {
    const canteen = spawnContainer('canteen', 'water', 400);
    const jar = spawnContainer('jar', 'water', 500);

    expect(canteen.tryExecuteCombination(jar, undefined, 'pour_into_filled')).toBe(true);

    expect(amountIn(canteen)).toBe(900);
    expect(jar.def.name, '注ぎ切った側は空の容器へ戻る').toBe('jar');
  });

  it('capacityに入りきらない量は注ぎ元に残る', () => {
    const bowl = spawn('coconut_bowl'); // capacity 250
    const jar = spawnContainer('jar', 'water', 1000);

    expect(jar.tryExecuteCombination(bowl, undefined, 'pour_into_empty')).toBe(true);

    expect(amountIn(bowl), '入る分だけ入る').toBe(250);
    expect(amountIn(jar), '残りは注ぎ元に留まる').toBe(750);
  });

  it('異なる種類の中身が入った容器へは注げない', () => {
    const canteen = spawnContainer('canteen', 'tea', 400);
    const jar = spawnContainer('jar', 'water', 500);

    expect(canteen.combinationsWith(jar, undefined), '混ぜる組み合わせがそもそも現れない').toEqual([]);
    canteen.tryExecuteCombination(jar, undefined, 'pour_into_filled');

    expect(amountIn(canteen), '混ざらない（種類ごとのタグに合致しない）').toBe(400);
    expect(amountIn(jar)).toBe(500);
  });
});
