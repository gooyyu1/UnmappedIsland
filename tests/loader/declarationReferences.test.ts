import { describe, expect, it } from 'vitest';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 宣言が名前で名指しした別の宣言（GameElementDefinition.md 3.6節）の検査。
 *
 * **綴りを間違えた名指しは、実行時には「持っていない」「その段に居ない」と読まれるだけ**なので、
 * ロードで落とさない限り、宣言は残ったまま一度も効かない。ここは**実際に綴りを崩して落ちること**を
 * 見る場所で、正しく書いた版が通ることと対で置く。
 */
describe('宣言が名指しする別の宣言', () => {
  const load = (yaml: string) => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();

  /** 腕とその段を宣言する作り手。名指しの相手はここに在る。 */
  const CRAFTER = `
  crafter:
    props:
      skill_cordage:
        value: 0
        stages:
          - {name: novice}
          - {name: skilled, min: 30}
`;

  const ropeWith = (deftness: string): string => `
object_defs:${CRAFTER}
  rope:
    recipes:
      twisted:
        deftness: ${deftness}
        steps:
          - requires: []
            duration: 60
`;

  it('deftnessのskillとfrom_stageは、正しく綴れば通る', () => {
    expect(() => load(ropeWith('{skill: skill_cordage, from_stage: skilled, minutes: -15}'))).not.toThrow();
  });

  it('deftnessのskillの綴り違いはロード時に落ちる', () => {
    expect(() => load(ropeWith('{skill: skill_codage, from_stage: skilled, minutes: -15}'))).toThrowError(
      /'skill_codage'というプロパティは、どの型も宣言していません/,
    );
  });

  it('deftnessのfrom_stageの綴り違いはロード時に落ちる', () => {
    expect(() => load(ropeWith('{skill: skill_cordage, from_stage: skiled, minutes: -15}'))).toThrowError(
      /プロパティ'skill_cordage'に'skiled'という段はありません/,
    );
  });

  it('条件のpropと段も同じ検査を受ける', () => {
    const conditionOn = (prop: string, stage: string): string => `
object_defs:${CRAFTER}
  rope:
    interactions:
      twist:
        trigger: menu
        conditions:
          - {subject: agent, prop: ${prop}, in_stage_or_above: ${stage}}
`;

    expect(() => load(conditionOn('skill_cordage', 'skilled'))).not.toThrow();
    expect(() => load(conditionOn('skill_cordge', 'skilled'))).toThrowError(
      /'skill_cordge'というプロパティは、どの型も宣言していません/,
    );
    expect(() => load(conditionOn('skill_cordage', 'skilld'))).toThrowError(/'skilld'という段はありません/);
  });

  it('土台（base）が引くプロパティも同じ検査を受ける', () => {
    const trailWith = (prop: string): string => `
object_defs:${CRAFTER}
  trail:
    props:
      travel_minutes: {value: 30, base: {subject: agent, prop: ${prop}}}
`;

    expect(() => load(trailWith('skill_cordage'))).not.toThrow();
    expect(() => load(trailWith('skill_cordag'))).toThrowError(/どの型も宣言していません/);
  });

  it('段を宣言しているのが名指した相手とは別の型でも通る（誰が持つかは実行時にしか決まらない）', () => {
    // 見るのは「どこかの型が宣言しているか」まで（3.6節）。作り手が腕を持たない世界は在りうるので、
    // 指した相手がその段を持つかまでは踏み込めない。
    expect(() =>
      load(`
object_defs:${CRAFTER}
  apprentice:
    props:
      skill_cordage: {value: 0}
  rope:
    interactions:
      twist:
        trigger: menu
        conditions:
          - {subject: agent, prop: skill_cordage, in_stage_or_above: skilled}
`),
    ).not.toThrow();
  });

  it('エラーは、名指しが書かれた場所を名乗る', () => {
    expect(() => load(ropeWith('{skill: skill_codage, from_stage: skilled, minutes: -15}'))).toThrowError(
      /'rope'\.recipes\.'twisted'\.deftness\.skill/,
    );
  });
});
