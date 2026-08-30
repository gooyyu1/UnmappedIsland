import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { PropertyDef } from '../../src/domain/PropertyDef';
import type { SlotDef } from '../../src/domain/SlotDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { World } from '../../src/domain/wrappers/World';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlFile, worldCodexPath } from '../support/worldCodexFiles';

function load(yamlText: string): WorldCodex {
  return new WorldCodexYamlLoader().load('core.yaml', yamlText).buildAndReset();
}

describe('core.yamlのworld定義', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlFile(new WorldCodexYamlLoader(), worldCodexPath('core.yaml')).buildAndReset();
  });

  function propOf(def: ObjectDef, propertyName: string): PropertyDef {
    const prop = def.tryGetPropertyDef(codex.propertyNames.getId(propertyName));
    if (prop === undefined) throw new Error(`'${def.name}' はプロパティ'${propertyName}'を持ちません。`);
    return prop;
  }

  function slotOf(def: ObjectDef, slotName: string): SlotDef {
    const slot = def.tryGetSlotDef(codex.slotNames.getId(slotName));
    if (slot === undefined) throw new Error(`'${def.name}' はスロット'${slotName}'を持ちません。`);
    return slot;
  }

  it('property_tagsは宣言順にIDが振られる（UIのタブの並び順になる）', () => {
    const declared = [...Array(codex.propertyTagNames.count).keys()].map((id) =>
      codex.propertyTagNames.getName(id),
    );

    expect(declared).toEqual(['status', 'health', 'nutrition', 'skill']);
  });

  it('worldはシングルトンで、期待されるデフォルトプロパティ値を持つ', () => {
    const world = codex.objects.get(codex.objectNames.getId('world'));
    expect(world.isSingleton).toBe(true);

    // 初期値は実行時インスタンスの現在値として観測する（DefaultNumberは非公開）。
    const instance = new WorldSession(codex).createObject(world.globalId);
    expect(instance.tryGetProperty(codex.propertyNames.getId('tick'))?.number ?? 0).toBe(0);
    expect(instance.tryGetProperty(codex.propertyNames.getId('minutes_per_tick'))?.number ?? 0).toBe(15);
    expect(instance.tryGetProperty(codex.propertyNames.getId('minute'))?.number ?? 0).toBe(0);
    expect(instance.tryGetProperty(codex.propertyNames.getId('hour'))?.number ?? 0).toBe(12);
    expect(instance.tryGetProperty(codex.propertyNames.getId('day'))?.number ?? 0).toBe(1);
    expect(instance.tryGetProperty(codex.propertyNames.getId('ambient_temperature'))?.number ?? 0).toBe(20);
  });

  it('minuteとhourには折り返し用のrangeが設定されている', () => {
    const world = codex.objects.get(codex.objectNames.getId('world'));

    const minute = propOf(world, 'minute');
    expect(minute.range?.max, '60分で1時間へ繰り上がる').toBe(60);

    const hour = propOf(world, 'hour');
    expect(hour.range?.max, '24時で1日へ繰り上がる').toBe(24);
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
    worldInstance.tick();
    worldInstance.tick();
    worldInstance.tick();

    expect(worldInstance.tryGetProperty(tickId)?.number ?? 0).toBe(3);
    expect(worldInstance.tryGetProperty(minuteId)?.number ?? 0).toBe(0);
  });

  it('minuteの繰り上がりはhourへ、さらにdayへ連鎖する', () => {
    const world = codex.objects.get(codex.objectNames.getId('world'));
    const minuteId = codex.propertyNames.getId('minute');
    const hourId = codex.propertyNames.getId('hour');
    const dayId = codex.propertyNames.getId('day');

    const worldInstance = new WorldSession(codex).createObject(world.globalId);
    const worldView = new World(worldInstance, codex);
    const session = new WorldSession(codex, worldView);
    // 見たいのは繰り上がりの連鎖なので、hourの既定値（正午）ではなく0:00から始める。
    worldInstance.getProperty(hourId).setNumberWithoutEvents(0);

    session.advanceWorldTime(60); // 60分 -> minuteが折り返し、hourへ+1

    expect(worldInstance.tryGetProperty(minuteId)?.number ?? 0).toBe(0);
    expect(worldInstance.tryGetProperty(hourId)?.number ?? 0).toBe(1);

    session.advanceWorldTime(60 * 23); // 残り23時間分進め、hourもdayへ折り返させる

    expect(worldInstance.tryGetProperty(minuteId)?.number ?? 0).toBe(0);
    expect(worldInstance.tryGetProperty(hourId)?.number ?? 0).toBe(0);
    expect(worldInstance.tryGetProperty(dayId)?.number ?? 0).toBe(2);
  });

  it('ambient_brightnessがambient_temperatureを補正する', () => {
    const world = codex.objects.get(codex.objectNames.getId('world'));
    const hourId = codex.propertyNames.getId('hour');
    const weatherId = codex.propertyNames.getId('weather');
    const ambientTemperatureId = codex.propertyNames.getId('ambient_temperature');

    const worldInstance = new WorldSession(codex).createObject(world.globalId);

    function assertAmbientTemperatureAt(
      weather: string,
      hour: number,
      expectedEffective: number,
      because: string,
    ): void {
      worldInstance.getProperty(weatherId).setNumberWithoutEvents(codex.symbolNames.intern(weather));
      worldInstance.getProperty(hourId).setNumberWithoutEvents(hour);
      expect(worldInstance.tryGetProperty(ambientTemperatureId)?.getEffectiveValue() ?? 0, because).toBe(
        expectedEffective,
      );
    }

    // 夜は月あかりだけで、半月では底(-6)へ均される。境目の0（陽が地平線の下）を越えないので、
    // 天気によらず常にやや涼しい（hourを直接見ず、明るさ経由で補正）。
    assertAmbientTemperatureAt('storm', 2, 17, '暴風雨の深夜は底なのでやや涼しい');
    assertAmbientTemperatureAt('scorching', 0, 17, '雲の無い真夜中もやや涼しい');

    // dim帯(0〜+10)は補正なし。日の出直後と、雨が陽を遮っている日中がここに入る。
    assertAmbientTemperatureAt('clear', 6, 20, '晴れの日の出直後(10-2=8)は補正なし');
    assertAmbientTemperatureAt('heavy_rain', 12, 20, '大雨の正午(16-8=8)も補正なし');
    assertAmbientTemperatureAt('storm', 12, 20, '嵐の正午(16-10=6)も補正なし');

    // bright帯(+11以上)はやや暑い。境目は曇りの正午（5,000 lx）。
    assertAmbientTemperatureAt('cloudy', 12, 23, '曇りの正午(16-5=11)はやや暑い');
    assertAmbientTemperatureAt('clear', 12, 23, '晴れの正午(16-2=14)もやや暑い');
    assertAmbientTemperatureAt('clear', 7, 23, '晴れの朝(13-2=11)もやや暑い');
    assertAmbientTemperatureAt('scorching', 12, 23, '雲の無い正午(16)もbright帯のまま');
  });

  it('hourとweatherがambient_brightnessを補正する', () => {
    const world = codex.objects.get(codex.objectNames.getId('world'));
    const hourId = codex.propertyNames.getId('hour');
    const weatherId = codex.propertyNames.getId('weather');
    const ambientBrightnessId = codex.propertyNames.getId('ambient_brightness');

    const worldInstance = new WorldSession(codex).createObject(world.globalId);

    function assertBrightnessAt(
      weather: string,
      hour: number,
      expectedEffective: number,
      because: string,
    ): void {
      worldInstance.getProperty(weatherId).setNumberWithoutEvents(codex.symbolNames.intern(weather));
      worldInstance.getProperty(hourId).setNumberWithoutEvents(hour);
      expect(worldInstance.tryGetProperty(ambientBrightnessId)?.getEffectiveValue() ?? 0, because).toBe(
        expectedEffective,
      );
    }

    // 夜: 月あかりは半月固定（中天でも0.025 lx = -6.6）で底を下回るので、hour側の寄与は底そのもの。
    // weather側は引く向きにしか働かないため、rangeの底が天気によらず同じ暗さへ均す。
    assertBrightnessAt('scorching', 0, -6, '雲の無い真夜中も底');
    assertBrightnessAt('heavy_rain', 23, -6, '大雨の夜も底');

    // 正午(11-12時): 太陽高度82.5°の雲のまったく無い空(+16)から、天気の透過率のぶん引かれる。
    assertBrightnessAt('scorching', 12, 16, '雲の無い正午は+16（125,000 lx）で最大');
    assertBrightnessAt('cloudy', 12, 11, '曇りの正午は+11（5,000 lx）');
    assertBrightnessAt('storm', 12, 6, '嵐の正午でも+6（約190 lx）で、真夜中とは区別が付く');

    // 太陽高度が下がるほど暗い。日の出6時・日没18時なので、17時までが昼。
    assertBrightnessAt('clear', 12, 14, '晴れの正午');
    assertBrightnessAt('clear', 15, 12, '晴れの15時は高度37.5°');
    assertBrightnessAt('clear', 17, 8, '晴れの17時は高度7.5°');
    assertBrightnessAt('clear', 18, -6, '日没後は夜');
    assertBrightnessAt('clear', 7, 11, '朝夕は正午をはさんで対称');
    assertBrightnessAt('clear', 16, 11, '朝夕は正午をはさんで対称');
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
      forestInstance.moveToSlotOrRejection(worldInstance.getSlot(locationsSlotId)),
      'traitを経由してlocationタグを持つオブジェクトは受け入れられる',
    ).toBeUndefined();
    expect(
      beachInstance.moveToSlotOrRejection(worldInstance.getSlot(locationsSlotId)),
      'traitを介さず直接tagsでlocationタグを持つオブジェクトも、同一traitでなくても受け入れられる',
    ).toBeUndefined();
    expect(
      rockInstance.moveToSlotOrRejection(worldInstance.getSlot(locationsSlotId)),
      'locationタグを持たないオブジェクトは拒否される',
    ).toBeDefined();
  });

  it('場所の気温は世界の気温を土台にし、その場だけの差を足す', () => {
    // 気温は世界だけのものではなく、あらゆる場所が持つ（ClimateSystem.md 1節）。土台は祖先＝世界の
    // 実効値（日射と季節の補正込み）なので、外が冷えれば中も冷える。
    const yaml = `
object_defs:
  test_hut:
    traits: [location]
    props:
      ambient_brightness: {value: 0}
  test_cellar:
    traits: [location]
    props:
      ambient_brightness: {value: 0}
      # 気温だけは、差のある場所が自分のvalueで上書きする（location traitの既定は0）。
      ambient_temperature: {value: -3}
`;
    const loader = new WorldCodexYamlLoader();
    loadYamlFile(loader, worldCodexPath('core.yaml'));
    loader.load('hut.yaml', yaml);
    const testCodex = loader.buildAndReset();

    const temperatureId = testCodex.propertyNames.getId('ambient_temperature');
    const session = new WorldSession(testCodex);
    const worldInstance = session.createObject(testCodex.objectNames.getId('world'));
    // 夜（陽が地平線の下）は世界の気温が-3される。土台がその実効値であることまで見たいので、
    // 既定の正午ではなく夜を作る。
    worldInstance.getProperty(testCodex.propertyNames.getId('hour')).setNumberWithoutEvents(0);
    const worldTemperature = worldInstance.getProperty(temperatureId).getEffectiveValue();
    expect(worldTemperature, '涼しい夜（20-3）').toBe(17);

    function temperatureIn(objectName: string): number {
      const location = session.createObject(testCodex.objectNames.getId(objectName));
      expect(
        location.moveToSlotOrRejection(worldInstance.getSlot(testCodex.slotNames.getId('locations'))),
      ).toBeUndefined();
      return location.getProperty(temperatureId).getEffectiveValue();
    }

    expect(temperatureIn('test_hut'), '書かない場所は世界の気温そのまま').toBe(worldTemperature);
    expect(temperatureIn('test_cellar'), '書いた場所はそのぶんだけ違う').toBe(worldTemperature - 3);
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
    props:
      # location traitのambient_brightnessはvalueを持たない（IlluminationSystem.md 2節）。
      ambient_brightness: {value: 0}
`;
    const loader = new WorldCodexYamlLoader();
    loadYamlFile(loader, worldCodexPath('core.yaml'));
    loader.load('hut.yaml', yaml);
    const testCodex = loader.buildAndReset();

    const hut = testCodex.objects.get(testCodex.objectNames.getId('test_hut'));

    expect(hut.tryGetSlotDef(testCodex.slotNames.getId('items'))).toBeDefined();
    expect(hut.tryGetSlotDef(testCodex.slotNames.getId('fixtures'))).toBeDefined();

    const characters = hut.tryGetSlotDef(testCodex.slotNames.getId('characters'));
    expect(characters).toBeDefined();
    expect(characters?.cellCount, 'キャラクタスロットは1枠').toBe(1);

    // 語彙（WorldVocabulary）は名前を先に登録するので、「Codexにその名前が無い」では確かめられない。
    // 訊くべきは、この型がそのプロパティを持つかどうか。
    expect(
      hut.tryGetPropertyDef(testCodex.vocabulary.world.explorationProgressId),
      'explorableを実装していないため、探索進捗プロパティを持たない',
    ).toBeUndefined();
    expect(
      hut.tryGetSlotDef(testCodex.vocabulary.world.undiscoveredFixturesSlotId),
      '未発見の設置物スロットも持たない',
    ).toBeUndefined();
  });
});
