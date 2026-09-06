import { describe, expect, it } from 'vitest';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 操作が宣言する持続効果（`interactions` の `passives`、GameElementDefinition.md 11.7節）のうち、
 * **書けないもの**の検証。書ける役は11.5節の表そのものなので、そちらは interactionRoles が受け持つ。
 *
 * どちらも「書けてしまうが効かない」を作らないための門。持続効果は物の宣言と同じ文法を共有するので、
 * 物だからこそ効くもの（子を持つこと・tickが回ること）はここで落とす。
 */
describe('操作が宣言する持続効果（11.7節）', () => {
  const load = (yaml: string) => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();

  it('tick毎の輸送は書けない——走らせる時点を持つのは物だけ', () => {
    expect(() =>
      load(`
object_defs:
  cistern:
    props:
      water: {value: 0, range: {min: 0, max: 100}}
      spilled: {value: 0, range: {min: 0, max: 100}}
    interactions:
      tip:
        trigger: menu
        duration: 60
        passives:
          - transfer: {from_prop: water, to_prop: spilled, amount: 1}
`),
    ).toThrow(/物のpassivesにしか書けません/);
  });

  it('子への配りは書けない——子を持つのは物だけ', () => {
    expect(() =>
      load(`
object_defs:
  oven:
    slots:
      tray: {cell: {}}
    interactions:
      heat:
        trigger: menu
        duration: 60
        passives:
          - add: {child: {warmth: 1}}
`),
    ).toThrow(/'child'は使えません/);
  });

  it('時間を消費しない操作には書けない——1 tickも効かない', () => {
    expect(() =>
      load(`
object_defs:
  survivor:
    props:
      stamina: {value: 100, range: {min: 0, max: 100}}
    interactions:
      brace:
        trigger: menu
        passives:
          - add: {self: {stamina: 1}}
`),
    ).toThrow(/'duration'を持つ操作だけです/);
  });
});
