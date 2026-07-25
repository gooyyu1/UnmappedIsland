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
    // hydration: 3日(288 tick)分、-100/tickでmax=28800。
    expect(instance.getNumber(codex.propertyNames.getId('hydration'))).toBe(28800);
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
    ['hydration', 0, 28800],
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

  it.each(['satiety', 'hydration', 'body_fat', 'wakefulness'])(
    '%sはtickごとに100ずつ減衰する',
    (name) => {
      const session = new WorldSession(codex);
      const character = codex.objects.get(codex.objectNames.getId('character'));
      const instance = new WorldObject(1, character, session);
      const propId = codex.propertyNames.getId(name);
      const before = instance.getNumber(propId);

      instance.tick(session);

      expect(instance.getNumber(propId)).toBe(before - 100);
    },
  );
});
