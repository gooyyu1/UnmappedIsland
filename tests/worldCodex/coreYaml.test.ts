import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/defs/ObjectDef';
import type { PropertyDef } from '../../src/domain/defs/PropertyDef';
import type { SlotDef } from '../../src/domain/defs/SlotDef';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { World } from '../../src/domain/runtime/views/World';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlFile, worldCodexPath } from '../support/worldCodexFiles';

function load(yamlText: string): WorldCodex {
  return new WorldCodexYamlLoader().load('core.yaml', yamlText).build();
}

describe('core.yamlのworld定義', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlFile(new WorldCodexYamlLoader(), worldCodexPath('core.yaml')).build();
  });

  function propOf(def: ObjectDef, propertyName: string): PropertyDef {
    const prop = def.getPropertyDef(codex.propertyNames.getId(propertyName));
    if (prop === undefined) throw new Error(`'${def.name}' はプロパティ'${propertyName}'を持ちません。`);
    return prop;
  }

  function slotOf(def: ObjectDef, slotName: string): SlotDef {
    const slot = def.getSlotDef(codex.slotNames.getId(slotName));
    if (slot === undefined) throw new Error(`'${def.name}' はスロット'${slotName}'を持ちません。`);
    return slot;
  }

  it('property_tagsは宣言順にIDが振られる（UIのタブの並び順になる）', () => {
    const declared = [...Array(codex.propertyTagNames.count).keys()].map((id) =>
      codex.propertyTagNames.getName(id),
    );

    expect(declared).toEqual(['status', 'health', 'nutrition', 'gauge']);
  });

  it('worldはシングルトンで、期待されるデフォルトプロパティ値を持つ', () => {
    const world = codex.objects.get(codex.objectNames.getId('world'));
    expect(world.isSingleton).toBe(true);

    // 初期値は実行時インスタンスの現在値として観測する（DefaultNumberは非公開）。
    const instance = new WorldObject(1, world, new WorldSession(codex));
    expect(instance.getNumber(codex.propertyNames.getId('tick'))).toBe(0);
    expect(instance.getNumber(codex.propertyNames.getId('minutes_per_tick'))).toBe(15);
    expect(instance.getNumber(codex.propertyNames.getId('minute'))).toBe(0);
    expect(instance.getNumber(codex.propertyNames.getId('hour'))).toBe(0);
    expect(instance.getNumber(codex.propertyNames.getId('day'))).toBe(1);
    expect(instance.getNumber(codex.propertyNames.getId('ambient_temperature'))).toBe(20);
  });

  it('minuteとhourには折り返し用のrangeが設定されている', () => {
    const world = codex.objects.get(codex.objectNames.getId('world'));

    const minute = propOf(world, 'minute');
    expect(minute.range?.max).toBe(59);

    const hour = propOf(world, 'hour');
    expect(hour.range?.max).toBe(23);
  });

  it('tickは毎tick加算されるが、minuteはtick駆動では変化しない', () => {
    // minuteはtick駆動のpassivesを持たない。「1tick進める」たびにminutes_per_tick分だけ加算する
    // 処理自体をWorldSession（ゲーム側）が担うため（WorldClockTests参照）、core.yaml単体で
    // tick()を直接呼んでもminuteは変化しないことをここで確認する。
    const world = codex.objects.get(codex.objectNames.getId('world'));
    const tickId = codex.propertyNames.getId('tick');
    const minuteId = codex.propertyNames.getId('minute');

    const session = new WorldSession(codex);
    const worldInstance = new WorldObject(1, world, session);
    worldInstance.tick(session);
    worldInstance.tick(session);
    worldInstance.tick(session);

    expect(worldInstance.getNumber(tickId)).toBe(3);
    expect(worldInstance.getNumber(minuteId)).toBe(0);
  });

  it('minuteの繰り上がりはhourへ、さらにdayへ連鎖する', () => {
    const world = codex.objects.get(codex.objectNames.getId('world'));
    const minuteId = codex.propertyNames.getId('minute');
    const hourId = codex.propertyNames.getId('hour');
    const dayId = codex.propertyNames.getId('day');

    const worldInstance = new WorldObject(1, world, new WorldSession(codex));
    const worldView = new World(worldInstance, codex.propertyNames, codex.symbolNames);
    const session = new WorldSession(codex, worldView);

    session.advanceWorldTime(60); // 60分 -> minuteが折り返し、hourへ+1

    expect(worldInstance.getNumber(minuteId)).toBe(0);
    expect(worldInstance.getNumber(hourId)).toBe(1);

    session.advanceWorldTime(60 * 23); // 残り23時間分進め、hourもdayへ折り返させる

    expect(worldInstance.getNumber(minuteId)).toBe(0);
    expect(worldInstance.getNumber(hourId)).toBe(0);
    expect(worldInstance.getNumber(dayId)).toBe(2);
  });

  it('sunlightがambient_temperatureを補正する', () => {
    const world = codex.objects.get(codex.objectNames.getId('world'));
    const hourId = codex.propertyNames.getId('hour');
    const weatherId = codex.propertyNames.getId('weather');
    const ambientTemperatureId = codex.propertyNames.getId('ambient_temperature');

    const worldInstance = new WorldObject(1, world, new WorldSession(codex));

    function assertAmbientTemperatureAt(
      weather: string,
      hour: number,
      expectedEffective: number,
      because: string,
    ): void {
      worldInstance.setProperty(weatherId, codex.symbolNames.intern(weather));
      worldInstance.setProperty(hourId, hour);
      expect(worldInstance.getEffectiveValue(ambientTemperatureId), because).toBe(expectedEffective);
    }

    // 夜はweatherによらずsunlight=0のため、常にやや涼しい（hourを直接見ず、sunlight経由で補正）
    assertAmbientTemperatureAt('storm', 2, 17, '暴風雨の深夜でもsunlightは0なのでやや涼しい');
    assertAmbientTemperatureAt('heavy_rain', 23, 17, '大雨の夜もやや涼しい');

    // sunlightが中間(1-6)の時間帯は補正なし
    assertAmbientTemperatureAt('cloudy', 6, 20, '曇りの朝(sunlight=2+2=4)は補正なし');
    assertAmbientTemperatureAt('heavy_rain', 12, 20, '大雨の昼(sunlight=5+0=5)も補正なし');

    // sunlightが7以上ならやや暑い
    assertAmbientTemperatureAt('clear', 12, 23, '晴れた昼(sunlight=5+5=10)はやや暑い');
    assertAmbientTemperatureAt('clear', 6, 23, '晴れの朝(sunlight=2+5=7)もやや暑い');
    assertAmbientTemperatureAt('cloudy', 12, 23, '曇りの昼(sunlight=5+2=7)もやや暑い');
    assertAmbientTemperatureAt('sunny', 12, 23, '快晴の昼(sunlight=5+7=12)もbright帯のまま');
    assertAmbientTemperatureAt('scorching', 12, 23, '最上級の晴れの昼(sunlight=5+10=15)もbright帯のまま');
  });

  it('weatherとhourがsunlightを補正する', () => {
    const world = codex.objects.get(codex.objectNames.getId('world'));
    const hourId = codex.propertyNames.getId('hour');
    const weatherId = codex.propertyNames.getId('weather');
    const sunlightId = codex.propertyNames.getId('sunlight');

    const worldInstance = new WorldObject(1, world, new WorldSession(codex));

    function assertSunlightAt(
      weather: string,
      hour: number,
      expectedEffective: number,
      because: string,
    ): void {
      worldInstance.setProperty(weatherId, codex.symbolNames.intern(weather));
      worldInstance.setProperty(hourId, hour);
      expect(worldInstance.getEffectiveValue(sunlightId), because).toBe(expectedEffective);
    }

    // 夜: hour側の最低限の寄与が0であり、weather側の追加ボーナスもconditionsで無効化されるため、
    // weatherによらず常に0（晴れていても夜であれば日差しは強くない、という設計意図）
    assertSunlightAt('scorching', 2, 0, '最上級の晴れの深夜でも0');
    assertSunlightAt('heavy_rain', 23, 0, '大雨の夜は0');

    // 昼(10-17時): hour側の最低限の寄与(5)に、weather側の追加ボーナスが加算される
    assertSunlightAt('storm', 12, 5, '暴風雨の昼はweatherの追加ボーナスがなくhour(5)の最低限の寄与のみ');
    assertSunlightAt('heavy_rain', 12, 5, '大雨の昼も同様');
    assertSunlightAt('light_rain', 12, 6, '小雨の昼はhour(5)+weather(1)');
    assertSunlightAt('cloudy', 12, 7, '曇りの昼はhour(5)+weather(2)');
    assertSunlightAt('clear', 12, 10, '晴れた昼はhour(5)+weather(5)');
    assertSunlightAt('sunny', 12, 12, '快晴の昼はhour(5)+weather(7)');
    assertSunlightAt('scorching', 12, 15, '最上級の晴れの昼はhour(5)+weather(10)で最大');

    // 朝(6-9時)・夕方(18-21時): hour側の最低限の寄与(2)は昼より弱いが、weather側のボーナスは昼と同じ
    assertSunlightAt('clear', 7, 7, '晴れの朝はhour(2)+weather(5)');
    assertSunlightAt('clear', 20, 7, '晴れの夕方は朝と同じ強さ');
    assertSunlightAt(
      'storm',
      8,
      2,
      '暴風雨の朝でもhour側の最低限の寄与(2)は残る（雨でも昼は夜より明るいはず、という設計意図）',
    );
  });

  it('locationsスロットはlocationタグを持つオブジェクトだけを受け入れる', () => {
    const world = codex.objects.get(codex.objectNames.getId('world'));
    expect(
      slotOf(world, 'locations').cellCount,
      '枠数は決めない（島に土地がいくつ生まれるかは地形生成が決める）',
    ).toBeUndefined();

    // locationタグを、traitを経由して持つobject_defと、traitを介さず直接tagsで持つobject_def、
    // どちらも同じように受け入れられることを確認する。
    const yaml = `
traits:
  location: {tags: [location]}
object_defs:
  test_world:
    slots:
      locations:
        cell: {accept: {tag: location}}
  test_forest:
    traits: [location]
  test_beach:
    tags: [location]
  test_rock: {}
`;
    const testCodex = load(yaml);

    const locationsSlotId = testCodex.slotNames.getId('locations');
    const session = new WorldSession(testCodex);
    const worldInstance = new WorldObject(
      1,
      testCodex.objects.get(testCodex.objectNames.getId('test_world')),
      session,
    );
    const forestInstance = new WorldObject(
      2,
      testCodex.objects.get(testCodex.objectNames.getId('test_forest')),
      session,
    );
    const beachInstance = new WorldObject(
      3,
      testCodex.objects.get(testCodex.objectNames.getId('test_beach')),
      session,
    );
    const rockInstance = new WorldObject(
      4,
      testCodex.objects.get(testCodex.objectNames.getId('test_rock')),
      session,
    );

    expect(
      forestInstance.moveToSlot(worldInstance, locationsSlotId),
      'traitを経由してlocationタグを持つオブジェクトは受け入れられる',
    ).toBeUndefined();
    expect(
      beachInstance.moveToSlot(worldInstance, locationsSlotId),
      'traitを介さず直接tagsでlocationタグを持つオブジェクトも、同一traitでなくても受け入れられる',
    ).toBeUndefined();
    expect(
      rockInstance.moveToSlot(worldInstance, locationsSlotId),
      'locationタグを持たないオブジェクトは拒否される',
    ).toBeDefined();
  });

  it('location traitだけでitems/fixtures/charactersスロットを持ち、探索は伴わない', () => {
    // location trait（本ファイル）は「場所である」ことに付随する構造（items/fixtures/
    // charactersの3スロット）だけを配る。探索（exploration_progressプロパティ・
    // undiscovered_fixturesスロット）はexplorable trait（locations.yaml）側の役割であり、
    // location単体を実装するオブジェクト（家のような、探索を伴わない場所）はそれらを持たない
    // （ExplorationSystem.md参照）。
    const yaml = `
object_defs:
  test_hut:
    traits: [location]
`;
    const loader = new WorldCodexYamlLoader();
    loadYamlFile(loader, worldCodexPath('core.yaml'));
    loader.load('hut.yaml', yaml);
    const testCodex = loader.build();

    const hut = testCodex.objects.get(testCodex.objectNames.getId('test_hut'));

    expect(hut.getSlotDef(testCodex.slotNames.getId('items'))).toBeDefined();
    expect(hut.getSlotDef(testCodex.slotNames.getId('fixtures'))).toBeDefined();

    const characters = hut.getSlotDef(testCodex.slotNames.getId('characters'));
    expect(characters).toBeDefined();
    expect(characters?.cellCount, 'キャラクタスロットは1枠').toBe(1);

    expect(
      testCodex.propertyNames.tryGetId('exploration_progress'),
      'explorableを実装していないため、探索進捗プロパティはこのCodexに一切登場しない',
    ).toBeUndefined();
  });
});
