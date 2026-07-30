import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/defs/ObjectDef';
import type { PropertyDef } from '../../src/domain/defs/PropertyDef';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlFile, worldCodexPath } from '../support/worldCodexFiles';

describe('characters.yamlのcharacter定義', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    const loader = new WorldCodexYamlLoader();
    loadYamlFile(loader, worldCodexPath('core.yaml'));
    loadYamlFile(loader, worldCodexPath('characters.yaml'));
    codex = loader.build();
  });

  function propOf(def: ObjectDef, propertyName: string): PropertyDef {
    const prop = def.getPropertyDef(codex.propertyNames.getId(propertyName));
    if (prop === undefined) throw new Error(`'${def.name}' はプロパティ'${propertyName}'を持ちません。`);
    return prop;
  }

  it('characterはシングルトンで、期待されるデフォルトプロパティ値を持つ', () => {
    const character = codex.objects.get(codex.objectNames.getId('character'));
    expect(character.isSingleton).toBe(true);

    // 初期値は実行時インスタンスの現在値として観測する（DefaultNumberは非公開）。
    const instance = new WorldObject(1, character, new WorldSession(codex));
    // satiety: 1日(96 tick)分、-100/tickでmax=9600。
    expect(instance.getNumber(codex.propertyNames.getId('satiety'))).toBe(9600);
    // hydration: 3日(288 tick)分、-25/tick(=1日2400mL)でmax=7200。
    expect(instance.getNumber(codex.propertyNames.getId('hydration'))).toBe(7200);
    // body_fat: 標準体型を想定した初期値=15日分(1440 tick)、-100/tickで144000。
    expect(instance.getNumber(codex.propertyNames.getId('body_fat'))).toBe(144000);
    // wakefulness: 強制的に起こされ続けない自然な限界=24時間(96 tick)分、-100/tickでmax=9600。
    expect(instance.getNumber(codex.propertyNames.getId('wakefulness'))).toBe(9600);
    expect(instance.getNumber(codex.propertyNames.getId('stamina'))).toBe(100);
  });

  it('characterは固定6枠の手持ちスロットを持ち、itemタグのものだけを受け入れる', () => {
    const character = codex.objects.get(codex.objectNames.getId('character'));
    const hand = character.getSlotDef(codex.slotNames.getId('hand'));

    expect(hand, 'characterはhandスロットを持つ').toBeDefined();
    expect(hand?.fixedPositions, '手持ちは枠の位置が動かない固定型').toBe(true);
    expect(hand?.unitCapacity, '手持ちは6枠').toBe(6);
    expect(hand?.accepts.map((rule) => rule.targetKind)).toEqual(['tag']);
  });

  it.each([
    ['satiety', 0, 9600],
    ['hydration', 0, 7200],
    ['body_fat', 0, 576000], // 最大限に肥満した状態=60日分(5760 tick)、-100/tick。
    ['wakefulness', 0, 9600],
    ['stamina', 0, 100],
  ])('%sは期待されるrange[%i, %i]を持つ', (name, expectedMin, expectedMax) => {
    const character = codex.objects.get(codex.objectNames.getId('character'));
    const prop = propOf(character, name);
    expect(prop.range, `${name}にはrangeが必要`).toBeDefined();
    expect(prop.range?.min).toBe(expectedMin);
    expect(prop.range?.max).toBe(expectedMax);
  });

  // statusはステータスエリアへ常時出すものに付ける（ScreenLayout.md）。カテゴリのタグと重ねて付く。
  it.each([
    ['satiety', ['status', 'nutrition']],
    ['hydration', ['status', 'nutrition']],
    ['wakefulness', ['status', 'health']],
    ['stamina', ['status', 'health']],
    ['body_fat', ['nutrition']],
    ['vegetable_nutrition', ['nutrition']],
    ['meat_nutrition', ['nutrition']],
    ['grain_tuber_nutrition', ['nutrition']],
  ])('%sは期待されるプロパティタグを持つ', (name, expectedTags) => {
    const character = codex.objects.get(codex.objectNames.getId('character'));
    const tagNames = propOf(character, name).tags.map((id) => codex.propertyTagNames.getName(id));

    expect(tagNames.sort()).toEqual([...expectedTags].sort());
  });

  it('ステータスエリアに出るのは4件で、残りはプロパティウィンドウでだけ見られる', () => {
    const character = codex.objects.get(codex.objectNames.getId('character'));
    const instance = new WorldObject(1, character, new WorldSession(codex));

    const status = instance.readPropertiesWithTag(codex.propertyTagNames.getId('status'));
    const nutrition = instance.readPropertiesWithTag(codex.propertyTagNames.getId('nutrition'));

    expect(status.map((reading) => reading.name)).toEqual(['satiety', 'hydration', 'wakefulness', 'stamina']);
    expect(nutrition.map((reading) => reading.name)).toContain('body_fat');
  });

  // 域の区分（GameElementDefinition.md 6.4節のalert）。満タンはどれも安全域で、ステータスエリアには
  // 何も出ない状態から始まる（ScreenLayout.md ステータスエリア節）。
  it.each([
    ['satiety', 9600, 'safe'],
    ['satiety', 7679, 'watch'],
    ['satiety', 4799, 'caution'],
    ['satiety', 0, 'danger'],
    ['hydration', 7200, 'safe'],
    ['hydration', 5759, 'watch'],
    ['hydration', 4799, 'caution'],
    ['hydration', 2399, 'danger'],
    ['hydration', 0, 'fatal'],
    ['wakefulness', 9600, 'safe'],
    ['wakefulness', 7679, 'watch'],
    ['wakefulness', 4799, 'caution'],
    ['wakefulness', 0, 'danger'],
    ['stamina', 100, 'safe'],
    ['stamina', 79, 'watch'],
    ['stamina', 59, 'caution'],
    ['stamina', 0, 'danger'],
  ])('%sが%iのときは%sの域に入る', (name, value, expectedAlert) => {
    const character = codex.objects.get(codex.objectNames.getId('character'));

    expect(propOf(character, name).alertLevelOf(value)).toBe(expectedAlert);
  });

  // ステータスエリアへ出始めるところを揃えておく（ScreenLayout.md ステータスエリア節）。
  it.each(['satiety', 'hydration', 'wakefulness', 'stamina'])(
    '%sは最大値の80%%を下回ると安全域から外れる',
    (name) => {
      const character = codex.objects.get(codex.objectNames.getId('character'));
      const prop = propOf(character, name);
      const max = prop.range!.max;

      expect(prop.alertLevelOf(Math.trunc(max * 0.8)), '80%ちょうどはまだ安全域').toBe('safe');
      expect(prop.alertLevelOf(Math.trunc(max * 0.8) - 1)).not.toBe('safe');
    },
  );

  it('致命的域を持つのは、放置すると死に至る水分だけ', () => {
    const character = codex.objects.get(codex.objectNames.getId('character'));
    const instance = new WorldObject(1, character, new WorldSession(codex));

    const fatal = instance
      .readPropertiesWithTag(codex.propertyTagNames.getId('status'))
      .filter((reading) => propOf(character, reading.name).alertLevelOf(0) === 'fatal');

    expect(fatal.map((reading) => reading.name)).toEqual(['hydration']);
  });

  // hydrationだけは実単位のmLに載るため-25/tick（LiquidContainerSystem.md 5節）。
  it.each([
    ['satiety', 100],
    ['hydration', 25],
    ['body_fat', 100],
    ['wakefulness', 100],
  ])('%sはtickごとに%iずつ減衰する', (name, expectedDecay) => {
    const session = new WorldSession(codex);
    const character = codex.objects.get(codex.objectNames.getId('character'));
    const instance = new WorldObject(1, character, session);
    const propId = codex.propertyNames.getId(name);
    const before = instance.getNumber(propId);

    instance.tick(session);

    expect(instance.getNumber(propId)).toBe(before - expectedDecay);
  });
});
