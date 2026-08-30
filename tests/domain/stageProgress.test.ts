import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';

// 今いる段の中での進み（PropertyValue.stageReadingのprogress、docs/engine/SkillSystem.md 5節）。
// 値が指数的に増えるプロパティ（腕前）を、最大値に対する割合ではなく段の中の位置で見せるための読み。
describe('PropertyValue.stageReading の段内進捗', () => {
  function load(yaml: string): WorldCodex {
    return new WorldCodexYamlLoader().load('test.yaml', yaml).buildAndReset();
  }

  /** そのプロパティをvalueにしたときの、今いる段の読み。 */
  function reading(codex: WorldCodex, defName: string, propName: string, value: number) {
    const session = new WorldSession(codex);
    const object = new WorldObject(1, codex.objects.get(codex.objectNames.getId(defName)), session);
    const property = object.tryGetProperty(codex.propertyNames.getId(propName));
    property?.setNumber(value);
    return property?.stageReading;
  }

  /** 腕前と同じ形（rangeを持たず、段だけを持つ）。最下段も下端を名乗る。 */
  const SKILL = `
object_defs:
  islander:
    props:
      skill_cordage:
        value: 0
        stages:
          - {name: novice, min: 0}
          - {name: basic, min: 20}
          - {name: skilled, min: 60}
          - {name: expert, min: 180}
`;

  const skillAt = (codex: WorldCodex, value: number) => reading(codex, 'islander', 'skill_cordage', value);

  it('rangeを持たなくても、今の段と次の段の境目から進みが決まる', () => {
    const codex = load(SKILL);

    expect(skillAt(codex, 0)?.name).toBe('novice');
    expect(skillAt(codex, 0)?.progress?.nextName).toBe('basic');
    expect(skillAt(codex, 0)?.progress?.ratio, '段に入った直後は0').toBeCloseTo(0);
    expect(skillAt(codex, 10)?.progress?.ratio, 'novice 0〜20 の半分').toBeCloseTo(0.5);
    expect(skillAt(codex, 19)?.progress?.ratio).toBeCloseTo(19 / 20);
  });

  it('段が上がると0へ戻り、同じ加算で進む量が減る', () => {
    const codex = load(SKILL);

    expect(skillAt(codex, 20)?.name).toBe('basic');
    expect(skillAt(codex, 20)?.progress?.ratio, '段の境目を越えた直後は0').toBeCloseTo(0);
    // 同じ+10でも、段の幅が20→40→120と広がるので進み方が鈍る（SkillSystem.md 5節）。
    expect(skillAt(codex, 30)?.progress?.ratio).toBeCloseTo(10 / 40);
    expect(skillAt(codex, 70)?.progress?.ratio).toBeCloseTo(10 / 120);
  });

  it('次の段が無い最上段では進みを言わない', () => {
    const codex = load(SKILL);

    expect(skillAt(codex, 200)?.name).toBe('expert');
    expect(skillAt(codex, 200)?.progress, '満ちる先が無いので0でも1でもない').toBeUndefined();
  });

  it('下端を名乗らない最下段は、rangeがあればその下限から数える', () => {
    const codex = load(`
object_defs:
  vessel:
    props:
      water:
        value: 0
        range: {min: 0, max: 100}
        stages:
          - {name: empty}
          - {name: some, min: 25}
`);

    const stage = reading(codex, 'vessel', 'water', 10);
    expect(stage?.name).toBe('empty');
    expect(stage?.progress?.nextName).toBe('some');
    expect(stage?.progress?.ratio, 'range.minが下端（0〜25の10）').toBeCloseTo(0.4);
  });

  it('rangeの外へminを置いた段は、区間の上端にも進みの分母にもならない', () => {
    // 値が取れない位置なので到達できない。**上端と分母は同じ1つの値**（PropertyDef.stageAbove）
    // なので、片方だけがその段を数えると区間と進みが食い違う。
    const codex = load(`
object_defs:
  vessel:
    props:
      water:
        value: 0
        range: {min: 0, max: 100}
        stages:
          - {name: empty, min: 0}
          - {name: unreachable, min: 150}
`);

    const stage = reading(codex, 'vessel', 'water', 50);
    expect(stage?.name).toBe('empty');
    expect(stage?.span?.end, '上端はrangeの上限').toBeCloseTo(1);
    expect(stage?.progress, '分母も同じく決まらないので、進みを言わない').toBeUndefined();
  });

  it('下端もrangeも無い最下段では進みを言わない', () => {
    const codex = load(`
object_defs:
  islander:
    props:
      skill_cordage:
        value: 0
        stages:
          - {name: novice}
          - {name: basic, min: 20}
`);

    expect(
      skillAt(codex, 10)?.progress,
      '受け皿は「それより下の残り全部」で、下端の無い区間では進みが決まらない',
    ).toBeUndefined();
  });
});
