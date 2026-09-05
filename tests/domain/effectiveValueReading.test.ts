import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';

/**
 * 実効値（GameElementDefinition.md 8.3節）と段（6.4節）は、同じ問いを1 tickに何度も訊かれるため
 * 答えを控えている（EffectiveValueReading・PropertyDef.stageAt）。**控えは、読み取り1回を跨いだ
 * 時点で使われなくなる**——ここはその一点だけを見る。
 */
describe('実効値と段の控え', () => {
  const yaml = `
object_defs:
  lamp:
    props:
      fuel:
        value: 0
        range: {min: 0, max: 10}
        stages:
          - {name: dry}
          - {name: wet, min: 5}
      brightness:
        value: 1
    passives:
      - conditions: [{prop: fuel, in_stage: wet}]
        modify:
          self:
            brightness: 4
`;

  function load(): WorldCodex {
    return new WorldCodexYamlLoader().load('test.yaml', yaml).buildAndReset();
  }

  function lamps(count: number): { codex: WorldCodex; lamps: readonly WorldObject[] } {
    const codex = load();
    const session = new WorldSession(codex);
    const id = codex.objectNames.getId('lamp');
    return { codex, lamps: Array.from({ length: count }, () => session.createObject(id)) };
  }

  it('寄与のゲートが見ている値を動かすと、次に訊いた実効値がその場で変わる', () => {
    const { codex, lamps: made } = lamps(1);
    const lamp = made[0];
    const fuel = lamp.getProperty(codex.propertyNames.getId('fuel'));
    const brightness = lamp.getProperty(codex.propertyNames.getId('brightness'));

    // 一度読んで控えを作らせてから、ゲートが見ている別のプロパティだけを動かす。
    expect(brightness.getEffectiveValue()).toBe(1);
    fuel.setNumber(5);
    expect(brightness.getEffectiveValue()).toBe(5);

    fuel.setNumber(0);
    expect(brightness.getEffectiveValue()).toBe(1);
  });

  it('同じ型の別の個体を交互に訊いても、それぞれ自分の値で答える', () => {
    const { codex, lamps: made } = lamps(2);
    const [dry, wet] = made;
    const fuelId = codex.propertyNames.getId('fuel');
    const brightnessId = codex.propertyNames.getId('brightness');
    wet.getProperty(fuelId).setNumber(5);

    // 段はPropertyDefが答える（型ごとに1つ）ので、個体を跨いで答えが混ざらないことを交互に確かめる。
    for (let i = 0; i < 3; i++) {
      expect(dry.getProperty(fuelId).stage?.name).toBe('dry');
      expect(wet.getProperty(fuelId).stage?.name).toBe('wet');
      expect(dry.getProperty(brightnessId).getEffectiveValue()).toBe(1);
      expect(wet.getProperty(brightnessId).getEffectiveValue()).toBe(5);
    }
  });
});
