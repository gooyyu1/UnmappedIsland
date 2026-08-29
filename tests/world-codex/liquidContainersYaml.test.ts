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
  let handBrightnessId: number;

  beforeAll(() => {
    const loader = new WorldCodexYamlLoader();
    loadYamlFile(loader, worldCodexPath('core.yaml'));
    loadYamlDirectory(loader, worldCodexPath('characters'));
    loadYamlFile(loader, worldCodexPath('liquid_containers.yaml'));
    // 容器を世界の下へ置くための土地（placeUnderWorld）。天候・日射を持つのは世界なので、
    // 容器はその下に居ないと蒸発も雨も成立しない。locations.yamlは依存が広いので最小のものを立てる。
    // location traitのambient_brightnessはvalueを持たない（樹冠と地面の反射は場所ごと）ので、
    // ここで与える。0は「遮るものが無い開けた場所」で、世界の日射がそのまま届く。
    //
    // 蒸発が読むのは器の居る場所の明るさなので（LiquidContainerSystem.md 6節）、樹冠と反射の
    // 効き方を見るために+1（砂浜相当）と-5（森相当）も立てる。値の出どころはContentSkeleton.md
    // 8.1.2節で、ここが確かめるのは値そのものではなく「土地の値が上乗せの段を動かすこと」。
    //
    // test_fixture_lightは据え付けの光源の代役。松明も炉も親のhand_brightness/looking_brightnessへ
    // 書くだけで（IlluminationSystem.md 3節）、その形が蒸発へ届かないことを見るのが目的なので、
    // 依存の広いfire.yamlは読まずに同じ2行を持つ物を立てる。
    loader.load(
      'test_ground.yaml',
      `object_defs:
  test_ground:
    traits: [location]
    props:
      ambient_brightness: {value: 0}
  test_bright_ground:
    traits: [location]
    props:
      ambient_brightness: {value: 1}
  test_shaded_ground:
    traits: [location]
    props:
      ambient_brightness: {value: -5}
  test_fixture_light:
    tags: [fixture]
    props:
      weight: {value: 0}
    passives:
      - modify: {parent: {hand_brightness: 11, looking_brightness: 11}}
`,
    );
    codex = loader.buildAndReset();

    hydrationId = codex.propertyNames.getId('hydration');
    wakefulnessId = codex.propertyNames.getId('wakefulness');
    weatherId = codex.propertyNames.getId('weather');
    hourId = codex.propertyNames.getId('hour');
    locationsSlotId = codex.slotNames.getId('locations');
    fillId = codex.propertyNames.getId('fill');
    handBrightnessId = codex.propertyNames.getId('hand_brightness');
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
    container.getProperty(fillId).setNumberWithoutEvents(size);
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

  /** hourは既定で正午（11-12時のnoonステージ）。明るさはhourとweatherの寄与の和で決まる。 */
  function spawnWorld(weather: string, hour = 12): WorldObject {
    const world = spawn('world');
    world.getProperty(weatherId).setNumberWithoutEvents(codex.symbolNames.intern(weather));
    world.getProperty(hourId).setNumberWithoutEvents(hour);
    return world;
  }

  /** 世界の下の土地。既定は開けた土地（樹冠も反射も無い）。 */
  function spawnLandUnderWorld(world: WorldObject, landName = 'test_ground'): WorldObject {
    const land = spawn(landName);
    expect(land.moveToSlotOrRejection(world.getSlot(locationsSlotId))).toBeUndefined();
    return land;
  }

  /** 天候・日射は世界が持つので、容器は世界の下——土地のアイテム枠——へ置く。 */
  function placeUnderWorld(container: WorldObject, world: WorldObject, landName?: string): WorldObject {
    expect(container.moveIntoFirstAcceptingSlot(spawnLandUnderWorld(world, landName))).toBe(true);
    return container;
  }

  function spawnEmptyUnderWorld(containerName: string, world: WorldObject): WorldObject {
    return placeUnderWorld(spawn(containerName), world);
  }

  function spawnContainerUnderWorld(
    containerName: string,
    liquidKind: string,
    size: number,
    world: WorldObject,
    landName?: string,
  ): WorldObject {
    return placeUnderWorld(spawnContainer(containerName, liquidKind, size), world, landName);
  }

  it('空の容器は中身の宣言を一切持たず、中身入りは同じ型に畳まれている', () => {
    const jar = codex.objects.get(codex.objectNames.getId('jar'));
    const filled = codex.objects.get(codex.objectNames.getId('jar__content_water_liquid'));

    expect(
      jar.menuTriggers.map((trigger) => trigger.interaction.name),
      '空の容器が持つのは容器自身の行動だけ（中身のdrinkは無い）',
    ).toEqual(['collect_rain']);
    expect(jar.dragTriggers, '注ぎ移しを宣言するのは中身の側').toHaveLength(0);
    // volumeは容器自身の外寸のかさで、抱えている量はfillが持つ（LiquidContainerSystem.md 5節）。
    // **空の容器もfillを持つ**——空とは量が0であることで、増やせるのは中身のtraitを配られた変種だけ。
    expect(jar.tryGetPropertyDef(fillId)?.range?.max, '空の容器も上限を持つ').toBe(4000);
    expect(jar.tryGetPropertyDef(codex.propertyNames.getId('density')), '密度も中身のもの').toBeUndefined();

    expect(codex.baseOf(filled), '中身入りは容器の変種').toBe(jar);
    expect(
      filled.menuTriggers.map((trigger) => trigger.interaction.name),
      '中身のdrinkが、容器自身の行動に続いて自分の行動になる',
    ).toEqual(['collect_rain', 'drink']);
    expect(filled.tryGetPropertyDef(fillId)?.range?.max, '上限は素の型から引き継ぐ').toBe(4000);
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
    expect(capacityOf('jar'), '甕は4L').toBe(4000);
  });

  it('水を飲むと中身のvolumeからagentのhydrationへ移る', () => {
    const agent = spawn(SAMPLE_CHARACTER);
    agent.getProperty(hydrationId).setNumberWithoutEvents(0);
    const jar = spawnContainer('jar', 'water', 1000);

    expect(jar.tryGetAction('drink', agent)?.tryExecute() === true, '容器への操作は中身へ委譲される').toBe(
      true,
    );

    expect(agent.tryGetProperty(hydrationId)?.number ?? 0, '250mLは10 tick分（to_amount、9.5節）').toBe(10);
    expect(amountIn(jar), '減るのは液体の単位（mL）のまま').toBe(750);
  });

  it('水分が満水だと飲めず、理由not_thirstyを返す', () => {
    // 満水では0mLの何も起きない飲用になるため、実行自体をさせない（liquid_containers.yaml）。
    const agent = spawn(SAMPLE_CHARACTER);
    const hydrationMax = codex.objects
      .get(codex.objectNames.getId(SAMPLE_CHARACTER))
      .tryGetPropertyDef(hydrationId)!.range!.max;
    agent.getProperty(hydrationId).setNumberWithoutEvents(hydrationMax);
    const jar = spawnContainer('jar', 'water', 1000);

    expect(jar.tryGetAction('drink', agent)?.unmetRequirement()?.reasonName).toBe('not_thirsty');
    expect(jar.tryGetAction('drink', agent)?.tryExecute() === true).toBe(false);
    expect(amountIn(jar), '実行されないので量は変わらない').toBe(1000);
  });

  it('水分が満水の一歩手前なら飲め、入る分だけが移る', () => {
    const agent = spawn(SAMPLE_CHARACTER);
    const hydrationMax = codex.objects
      .get(codex.objectNames.getId(SAMPLE_CHARACTER))
      .tryGetPropertyDef(hydrationId)!.range!.max;
    agent.getProperty(hydrationId).setNumberWithoutEvents(hydrationMax - 4);
    const jar = spawnContainer('jar', 'water', 1000);

    expect(jar.tryGetAction('drink', agent)?.unmetRequirement()).toBeUndefined();
    expect(jar.tryGetAction('drink', agent)?.tryExecute() === true).toBe(true);

    expect(agent.tryGetProperty(hydrationId)?.number ?? 0, 'あふれる分は飲まない').toBe(hydrationMax);
    // 空きは4 tick分。移送元の単位へ割り戻すと 4 × 250 / 10 = 100mL しか出ない（9.5節）。
    expect(amountIn(jar), '入る分だけ減る').toBe(900);
  });

  it('残りを飲み切ると、中身のインスタンスごと消えて空の容器へ戻る', () => {
    const agent = spawn(SAMPLE_CHARACTER);
    agent.getProperty(hydrationId).setNumberWithoutEvents(0);
    const jar = spawnContainer('jar', 'water', 100); // 1回分(250)より少ない

    expect(jar.tryGetAction('drink', agent)?.tryExecute() === true).toBe(true);

    expect(agent.tryGetProperty(hydrationId)?.number ?? 0, '残っている分だけ飲む（100mL = 4 tick分）').toBe(
      4,
    );
    expect(contentOf(jar), 'tickを待たずに空へ戻る（0mLの水は存在しない）').toBeUndefined();
  });

  it('お茶を飲むと追加の効果も適用できる', () => {
    const agent = spawn(SAMPLE_CHARACTER);
    agent.getProperty(hydrationId).setNumberWithoutEvents(0);
    agent.getProperty(wakefulnessId).setNumberWithoutEvents(0);
    const jar = spawnContainer('jar', 'tea', 1000);

    expect(jar.tryGetAction('drink', agent)?.tryExecute() === true).toBe(true);

    expect(agent.tryGetProperty(hydrationId)?.number ?? 0).toBe(10);
    expect(agent.tryGetProperty(wakefulnessId)?.number ?? 0).toBe(2);
  });

  it('お茶のwakefulness効果は飲んだ量に比例する', () => {
    const agent = spawn(SAMPLE_CHARACTER);
    agent.getProperty(hydrationId).setNumberWithoutEvents(0);
    agent.getProperty(wakefulnessId).setNumberWithoutEvents(0);
    const jar = spawnContainer('jar', 'tea', 125); // 1回分(250)の半分しか無い

    expect(jar.tryGetAction('drink', agent)?.tryExecute() === true).toBe(true);

    expect(agent.tryGetProperty(hydrationId)?.number ?? 0, '在庫の分だけ飲む（125mL = 5 tick分）').toBe(5);
    expect(agent.tryGetProperty(wakefulnessId)?.number ?? 0, 'linked_addは実際に移った量に比例する').toBe(1);
  });

  it('油にはdrinkアクションが無い', () => {
    const agent = spawn(SAMPLE_CHARACTER);
    const jar = spawnContainer('jar', 'oil', 1000);

    expect(jar.tryGetAction('drink', agent)?.tryExecute() === true, '飲用不可の液体はdrinkを持たない').toBe(
      false,
    );
  });

  /**
   * 中身のバーの色は液体自身が宣言する（CardView.md 8節 カードの状態バー）。宣言し忘れた液体は
   * 灰色で出るだけで画面を見ても気付けないため、ここで全ての液体が持っていることを検査する。
   */
  it('液体はすべて自分の色を宣言している', () => {
    const colorId = codex.propertyNames.getId('color');
    // 中身入りの変種も液体のtraitを配られてliquidタグを持つので、配る側の束だけを見る。
    const liquids = codex
      .objectDefNamesWithTag(codex.tagNames.getId('liquid'))
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

  // 正午のambient_brightnessは cloudy 11 / clear 14 / sunny 15 / scorching 16。
  it.each([
    ['cloudy', -1],
    ['clear', -2],
    ['scorching', -3],
  ])('coconut_bowlの正午の蒸発量は日差しの強さ(%s)で決まる', (weather, expectedDelta) => {
    const world = spawnWorld(weather);
    const bowl = spawnContainerUnderWorld('coconut_bowl', 'water', 100, world);

    bowl.tick();

    expect(amountIn(bowl)).toBe(100 + expectedDelta);
  });

  it.each([
    ['cloudy', -2],
    ['clear', -6],
    ['scorching', -8],
  ])('jarの正午の蒸発量は日差しの強さ(%s)で決まる', (weather, expectedDelta) => {
    const world = spawnWorld(weather);
    const jar = spawnContainerUnderWorld('jar', 'water', 200, world);

    jar.tick();

    expect(amountIn(jar)).toBe(200 + expectedDelta);
  });

  it.each([
    ['coconut_bowl', -1],
    ['jar', -2],
  ])('夜(%s)は日射の上乗せが消え、基礎の蒸発だけが残る', (containerName, expectedDelta) => {
    const world = spawnWorld('scorching', 0); // 夜は明るさが底（-6）へ均される
    const container = spawnContainerUnderWorld(containerName, 'water', 200, world);

    container.tick();

    expect(amountIn(container)).toBe(200 + expectedDelta);
  });

  it.each([
    ['coconut_bowl', -1],
    ['jar', -4],
  ])('日の出直後(%s)の日差しは正午より弱い', (containerName, expectedDelta) => {
    const world = spawnWorld('scorching', 7); // 太陽高度22.5°で明るさ13（最も低いしきい値だけを超える）
    const container = spawnContainerUnderWorld(containerName, 'water', 200, world);

    container.tick();

    expect(amountIn(container)).toBe(200 + expectedDelta);
  });

  // 上乗せが読むのは器の居る場所の明るさなので、樹冠と地面の反射が段を動かす（6節）。
  it.each([
    ['coconut_bowl', -1],
    ['jar', -2],
  ])('日陰の土地(%s)は、雲の無い空の正午でも上乗せが消える', (containerName, expectedDelta) => {
    // 森（-5）。世界は+16でも器の居る場所は+11で、最も低いしきい値(+12)に1段届かない。
    const world = spawnWorld('scorching');
    const container = spawnContainerUnderWorld(containerName, 'water', 200, world, 'test_shaded_ground');

    container.tick();

    expect(amountIn(container)).toBe(200 + expectedDelta);
  });

  it('明るい地面は、開けた土地より1段ぶん早く上乗せが効く', () => {
    // 砂浜(+1)。曇りの正午は開けた土地なら+11で上乗せゼロだが、反射のぶん最も低いしきい値へ届く。
    const world = spawnWorld('cloudy');
    const jar = spawnContainerUnderWorld('jar', 'water', 200, world, 'test_bright_ground');

    jar.tick();

    expect(amountIn(jar)).toBe(200 - 4); // 基礎2 + 上乗せ2（開けた土地では基礎2だけ）
  });

  it('据え付けの光源は蒸発を変えない', () => {
    // 焚き火のそばの水が余分に減ってはいけない（6節）。光源はhand_brightnessにしか届かず、
    // 蒸発が読むambient_brightnessには入らない。
    const world = spawnWorld('scorching');
    const land = spawnLandUnderWorld(world);
    const jar = spawnContainer('jar', 'water', 200);
    expect(jar.moveIntoFirstAcceptingSlot(land)).toBe(true);
    expect(spawn('test_fixture_light').moveIntoFirstAcceptingSlot(land)).toBe(true);

    jar.tick();

    expect(land.getProperty(handBrightnessId).getEffectiveValue(), '光源は手元へは届いている').toBe(16 + 11);
    expect(amountIn(jar), '光源が無いときと同じ').toBe(200 - 8);
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
    const agent = spawn(SAMPLE_CHARACTER);
    const world = spawnWorld('light_rain');
    const bowl = spawnEmptyUnderWorld('coconut_bowl', world);

    expect(bowl.tryGetAction('collect_rain', agent)?.unmetRequirement()).toBeUndefined();
    expect(bowl.tryGetAction('collect_rain', agent)?.tryExecute() === true).toBe(true);

    expect(contentOf(bowl)?.name, '溜まるのは水').toBe('water_liquid');
    expect(amountIn(bowl), '最少の量で始まり、以後は降っている間に増える').toBe(1);
  });

  it('貯め始めた雨は、そのまま降り続けるぶんだけ増える', () => {
    const agent = spawn(SAMPLE_CHARACTER);
    const world = spawnWorld('light_rain');
    const bowl = spawnEmptyUnderWorld('coconut_bowl', world);

    bowl.tryGetAction('collect_rain', agent)?.tryExecute();
    bowl.tick();

    expect(amountIn(bowl)).toBe(1 + 10);
  });

  it('雨が降っていなければ貯められず、理由not_rainingを返す', () => {
    const agent = spawn(SAMPLE_CHARACTER);
    const world = spawnWorld('clear');
    const bowl = spawnEmptyUnderWorld('coconut_bowl', world);

    expect(bowl.tryGetAction('collect_rain', agent)?.unmetRequirement()?.reasonName).toBe('not_raining');
    expect(bowl.tryGetAction('collect_rain', agent)?.tryExecute() === true).toBe(false);
    expect(contentOf(bowl), '空のまま').toBeUndefined();
  });

  it('中身の入った容器では雨を貯めるアクションが出ない（操作が中身へ委譲されるため）', () => {
    const agent = spawn(SAMPLE_CHARACTER);
    const world = spawnWorld('light_rain');
    const bowl = spawnContainerUnderWorld('coconut_bowl', 'water', 100, world);

    expect(bowl.tryGetAction('collect_rain', agent)?.tryExecute() === true).toBe(false);

    expect(amountIn(bowl), '溜まり続けるのはpassiveの仕事で、操作は要らない').toBe(100);
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
    const empty = spawn('jar');
    const jar = spawnContainer('jar', 'water', 800);

    // 宣言を持つのは中身入りの側だけなので、selfは注ぎ元・instrumentは空の容器（12.3節）。
    expect(
      jar
        .combinationsWith(empty, undefined)
        .find((c) => c.name === 'pour_into_empty')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(amountIn(empty), '全量が移る').toBe(800);
    expect(jar.def.name, '注ぎ切った側は空の容器へ戻る').toBe('jar');
  });

  it('同じ種類の中身が入った容器へ注ぐと継ぎ足される', () => {
    const from = spawnContainer('jar', 'water', 400);
    const to = spawnContainer('jar', 'water', 500);

    expect(
      to
        .combinationsWith(from, undefined)
        .find((c) => c.name === 'pour_into_filled')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(amountIn(to)).toBe(900);
    expect(from.def.name, '注ぎ切った側は空の容器へ戻る').toBe('jar');
  });

  it('capacityに入りきらない量は注ぎ元に残る', () => {
    const bowl = spawn('coconut_bowl'); // capacity 250
    const jar = spawnContainer('jar', 'water', 1000);

    expect(
      jar
        .combinationsWith(bowl, undefined)
        .find((c) => c.name === 'pour_into_empty')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(amountIn(bowl), '入る分だけ入る').toBe(250);
    expect(amountIn(jar), '残りは注ぎ元に留まる').toBe(750);
  });

  it('異なる種類の中身が入った容器へは注げない', () => {
    const tea = spawnContainer('jar', 'tea', 400);
    const water = spawnContainer('jar', 'water', 500);

    expect(water.combinationsWith(tea, undefined), '混ぜる組み合わせがそもそも現れない').toEqual([]);
    water
      .combinationsWith(tea, undefined)
      .find((c) => c.name === 'pour_into_filled')
      ?.tryExecute();

    expect(amountIn(tea), '混ざらない（種類ごとのタグに合致しない）').toBe(400);
    expect(amountIn(water)).toBe(500);
  });
});
