import { describe, expect, it } from 'vitest';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 参照ルート（GameElementDefinition.md 14.1節）の綴りは、`subject`の値・対象キー・`transfer`の
 * `from`/`to`のどこにも書かれるが、**書ける綴りは14.1節の同じ表から選ぶ**。読み手も1つなので、
 * 綴りを間違えたときに名乗る語彙も1つ——その場所に書けないキー名（`subject`など）を名乗らない。
 */
describe('参照ルートの綴り間違い', () => {
  const load = (yaml: string): void => {
    new WorldCodexYamlLoader().load('test.yaml', yaml).buildAndReset();
  };

  const withPassive = (operation: string): string => `
object_defs:
  hut:
    props:
      warmth: {value: 0}
    passives:
      - ${operation}
`;

  it('passivesのmodifyの対象キーが、書けないキー名を名乗らない', () => {
    expect(() => load(withPassive('modify: {praent: {warmth: 1}}'))).toThrow(
      /'hut'\.passives\.modify: 未知の参照ルート 'praent' です。/,
    );
  });

  it('passivesのaddの対象キーも同じ語彙で名乗る', () => {
    expect(() => load(withPassive('add: {praent: {warmth: 1}}'))).toThrow(
      /'hut'\.passives\.add: 未知の参照ルート 'praent' です。/,
    );
  });

  it('activeの対象キーも同じ語彙で名乗る', () => {
    expect(() =>
      load(`
object_defs:
  hut:
    props:
      warmth: {value: 0}
    interactions:
      rest:
        trigger: menu
        add: {praent: {warmth: 1}}
`),
    ).toThrow(/未知の参照ルート 'praent' です。/);
  });

  it('subjectの値も同じ語彙で名乗る', () => {
    expect(() =>
      load(`
object_defs:
  hut:
    props:
      warmth: {value: 0}
    interactions:
      rest:
        trigger: menu
        conditions:
          - {subject: praent, prop: warmth, gt: 1}
        add: {self: {warmth: 1}}
`),
    ).toThrow(/未知の参照ルート 'praent' です。/);
  });

  it("対象キーに書いた'world'も、なぜ書けないかを名乗る（未知の綴りとして扱わない）", () => {
    expect(() =>
      load(`
object_defs:
  hut:
    props:
      warmth: {value: 0}
    interactions:
      rest:
        trigger: menu
        add: {world: {warmth: 1}}
`),
    ).toThrow(/参照ルート 'world' は未対応です（/);
  });
});
