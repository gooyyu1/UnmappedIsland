import { describe, expect, it } from 'vitest';
import type { PropertyDef } from '../../src/domain/PropertyDef';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 名指した段が値の並びの上で占める位置（`PropertyDef.lowerBoundOfStage`／`upperBoundOfStage`、
 * GameElementDefinition.md 6.4節）。
 *
 * 段の並びを知っているのはPropertyDefだけで、**下端を書かなかった受け皿を値の並びの上のどこへ置くか**と
 * **すぐ上に来る段をどう選ぶか**は、バーの刻み（`stageReading`）も定義から周期を読む側（src/analysis）も
 * ここから引く。読む側が自分で書き写すと、片方だけが違う段を上と見ても気付けない。
 */
describe('名指した段の下端と上端', () => {
  function propertyDefOf(yaml: string, defName: string, propName: string): PropertyDef {
    const codex = new WorldCodexYamlLoader().load('test.yaml', yaml).buildAndReset();
    const objectDef = codex.objects.get(codex.objectNames.getId(defName));
    const propertyDef = objectDef.tryGetPropertyDef(codex.propertyNames.getId(propName));
    if (propertyDef === undefined) throw new Error(`'${defName}'に'${propName}'がありません。`);
    return propertyDef;
  }

  /** 受け皿・rangeの下限ちょうどに置いた段・その上の段・rangeの外の段が並ぶ形。 */
  const water = propertyDefOf(
    `
object_defs:
  vessel:
    props:
      water:
        value: 0
        range: {min: 0, max: 100}
        stages:
          - {name: empty}
          - {name: film, min: 0}
          - {name: some, min: 25}
          - {name: unreachable, min: 150}
`,
    'vessel',
    'water',
  );

  it('下端を書かなかった受け皿は、値の並びの上では負の無限大', () => {
    expect(water.lowerBoundOfStage('empty')).toBe(Number.NEGATIVE_INFINITY);
    expect(water.lowerBoundOfStage('film')).toBe(0);
    expect(water.lowerBoundOfStage('some')).toBe(25);
  });

  it('宣言に無い名前は位置を持たない', () => {
    expect(water.lowerBoundOfStage('sone')).toBeUndefined();
    expect(water.upperBoundOfStage('sone')).toBeUndefined();
  });

  it('段の上端は、すぐ上に来る段の下端', () => {
    expect(water.upperBoundOfStage('film')).toBe(25);
  });

  // 受け皿の上端は、下端を書いた段のうち最も低いもの。rangeの下限そのものに置いた段もそこに含まれる
  // ——受け皿が居るのはそれより下で、rangeの下限から数え始めるのではない。
  it('受け皿の上端は、rangeの下限に置いた段でも数える', () => {
    expect(water.upperBoundOfStage('empty')).toBe(0);
  });

  it('rangeの上限より上に下端を置いた段は、上に無いものとして数える', () => {
    expect(water.upperBoundOfStage('some'), '値が取れない位置は行き着く先にならない').toBeUndefined();
  });

  it('完全一致で決まる段（シンボル型）は、値の並びの上に位置を持たない', () => {
    const weather = propertyDefOf(
      `
object_defs:
  world:
    props:
      weather:
        value: clear
        stages:
          - {name: clear}
          - {name: rain}
`,
      'world',
      'weather',
    );

    expect(weather.lowerBoundOfStage('clear')).toBeUndefined();
    expect(weather.upperBoundOfStage('clear')).toBeUndefined();
  });
});
