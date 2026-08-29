import { describe, expect, it } from 'vitest';
import { rangeCyclesOf } from '../../src/analysis/rangeCycles';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * tick毎に動く値がrangeの端へ届くまでの周期（`src/analysis/rangeCycles.ts`）の検証。
 *
 * 見るのは**条件つきの増減（`GameElementDefinition.md` 8.2節）をどう組み合わせるか**——問いは
 * 「合算するか」ではなく「どの組み合わせが同時に成立しうるか」で、成立しえない組み合わせを1つの
 * 場合として数えると、増減が打ち消し合って周期そのものが消える。
 *
 * 形はどれも同梱の定義から採っているが、宣言はここに置く（tests/architecture/testKinds.test.ts）。
 */
describe('rangeの端へ届くまでの周期（rangeCycles）', () => {
  const YAML = `
object_defs:
  # 祖先が名乗る環境。条件の相手として要るだけで、値そのものは読まれない。
  world:
    props:
      ambient_temperature: {value: 26, range: {min: -10, max: 45}}
      ambient_brightness: {value: 0, range: {min: -6, max: 17}}
      wetness: {value: 0, range: {min: 0, max: 1}}

  # 凍死する者（characters/player_character.yamlのwarmth）。気温を同じ境目の逆向きの演算子で
  # 見ている3ブロックは、どの2つも同時には成立しない。
  camper:
    tags: [item]
    props:
      chill_point: {value: 16}
      sheltered: {value: 0}
      warmth:
        value: 700
        range: {min: 0, max: 700}
        on_min: {destroy: self}
        passives:
          - conditions:
              - {subject: ancestor, prop: ambient_temperature, lt: {prop: chill_point}}
              - any:
                  - {prop: sheltered, gte: 1}
                  - {subject: ancestor, prop: wetness, lt: 1}
            add: {self: {warmth: -2}}
          - conditions:
              - {subject: ancestor, prop: ambient_temperature, lt: {prop: chill_point}}
              - {prop: sheltered, eq: 0}
              - {subject: ancestor, prop: wetness, gte: 1}
            add: {self: {warmth: -6}}
          - conditions:
              - {subject: ancestor, prop: ambient_temperature, gte: {prop: chill_point}}
            add: {self: {warmth: 8}}

  # 塩田（salt.yaml）。常時効く増減を持たず、晴れて乾く分と雨で戻る分だけが動かす。
  salt_pan:
    tags: [fixture]
    props:
      drying_remaining:
        value: 24
        range: {min: 0, max: 24}
        on_min:
          add: {self: {drying_remaining: 24}}
          spawn: {object: salt, into: self}
        passives:
          - conditions: [{subject: ancestor, prop: ambient_brightness, gte: 14}]
            add: {self: {drying_remaining: -1}}
          - conditions: [{subject: ancestor, prop: wetness, gte: 1}]
            add: {self: {drying_remaining: 2}}
    slots:
      salt:
        cell_count: 4
        cell: {accept: {tag: item}}

  salt:
    tags: [item]

  # 閉じ込められた獣（TrapSystem.md 5.4節）。渇くのも飲むのも同じゲートの下だが、飲めるのは
  # 囲いの水が残っている間だけなので、渇きだけが効く場合がある。
  pen:
    tags: [fixture]
    slots:
      catch:
        cell_count: 1
        cell: {accept: {tag: quarry}}
    props:
      drinking_water: {value: 0, range: {min: 0, max: 4000}}

  beast:
    tags: [item, quarry]
    props:
      hydration:
        value: 336
        range: {min: 0, max: 336}
        on_min: {destroy: self}
        passives:
          - conditions: [{in_slot: catch}]
            add: {self: {hydration: -1}}
          - conditions: [{in_slot: catch}]
            transfer:
              from: parent
              from_prop: drinking_water
              to_prop: hydration
              amount: 25
              to_amount: 1
`;

  const codex = new WorldCodexYamlLoader().load('rangeCycles.yaml', YAML).buildAndReset();

  /** その型の、そのプロパティが持つ周期（1つだけのはず）。 */
  function cycleOf(codex: WorldCodex, objectName: string, propertyName: string) {
    const def = [...codex.objects].find((candidate) => candidate.name === objectName);
    return rangeCyclesOf(def!).filter(
      (cycle) => codex.propertyNames.getName(cycle.propertyGlobalId) === propertyName,
    );
  }

  it('同じ値を逆向きの演算子で見ているブロックは、同時に成立しない場合として数える', () => {
    // -2・-6・+8のどの2つも同時には成立しない。全部を1つの場合として足すと0になり、下端へ向かう
    // 周期が丸ごと消える（凍死が日をまたぐ長さの列から落ちていた）。
    // 最も遅いのは寒い所に居る-2で700/2=350 tick、最も速いのは雨の野ざらしの-6で116.67 tick。
    expect(cycleOf(codex, 'camper', 'warmth')).toMatchObject([
      { minutes: 350 * 15, shortestMinutes: (700 / 6) * 15, destroysSelf: true, repeats: false },
    ]);
  });

  it('常時効く増減が無く、条件つきが逆を向いていても、下端へ向かう場合が残る', () => {
    // -1と+2は同時にも起こりうるが、乾く-1だけが効く場合もある。合計（+1）の向きだけで見ると
    // 上端へ向かうものとして読まれ、塩を生むon_minが1つも立たなくなる。
    const [cycle] = cycleOf(codex, 'salt_pan', 'drying_remaining');
    expect(cycle).toMatchObject({ minutes: 24 * 15, repeats: true });
    expect(cycle.step.outputs).toHaveLength(1);
  });

  it('在庫から流れ込む輸送は、それが止まって渇く場合も数える', () => {
    // 渇く-1と飲む+1は同じゲートを持つが、飲めるのは囲いの水が残っている間だけ。両方を必ず
    // 重なるものとして足すと0になり、渇きの期限が消える。
    expect(cycleOf(codex, 'beast', 'hydration')).toMatchObject([
      { minutes: 336 * 15, shortestMinutes: 336 * 15, destroysSelf: true },
    ]);
  });
});
