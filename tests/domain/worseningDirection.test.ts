import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 「増えるほど悪いか」（`PropertyDef.worsensUpward`、GameElementDefinition.md 6.8節）の決まり方。
 *
 * 向きは複数の宣言が述べうる（`worsens`・`gauge`の両端・`stages`のalert）が、**どれも同じ1つの事実を
 * 言う**。どれも述べていなければ既定の「減ると悪い」で、2つ以上が述べていて食い違えばロード時に弾く。
 */
describe('PropertyDef.worsensUpward（値がどちらへ動くと悪いか）', () => {
  function load(yaml: string): WorldCodex {
    return new WorldCodexYamlLoader().load('test.yaml', yaml).buildAndReset();
  }

  function worsensUpwardOf(codex: WorldCodex, defName: string, propName: string): boolean {
    return codex.objects
      .get(codex.objectNames.getId(defName))
      .tryGetPropertyDef(codex.propertyNames.getId(propName))!.worsensUpward;
  }

  it('バーにも段にもしない量は、worsensで向きを名乗れる', () => {
    // rangeが無いのでgaugeを書けず、段も無いのでalertからも導けない（歩みの遅れがこの形）。
    const codex = load(`
object_defs:
  walker:
    props:
      travel_delay: {value: 0, worsens: up}
      stride: {value: 0, worsens: down}
      unstated: {value: 0}
`);

    expect(worsensUpwardOf(codex, 'walker', 'travel_delay')).toBe(true);
    expect(worsensUpwardOf(codex, 'walker', 'stride')).toBe(false);
    expect(worsensUpwardOf(codex, 'walker', 'unstated'), '述べなければ「減ると悪い」').toBe(false);
  });

  it('alertを1つも書いていない段は、向きを何も述べていない', () => {
    // 段はあるが域を分けていない量（風速の calm/gale など）。段があることを「減ると悪いと述べた」と
    // 数えると、worsensで名乗れなくなる。
    const codex = load(`
object_defs:
  walker:
    props:
      mess:
        value: 0
        worsens: up
        stages:
          - {name: tidy}
          - {name: messy, min: 5}
      weather:
        value: clear
        worsens: up
        stages:
          - {name: clear}
          - {name: storm}
`);

    expect(worsensUpwardOf(codex, 'walker', 'mess')).toBe(true);
    expect(worsensUpwardOf(codex, 'walker', 'weather'), 'シンボル型の段も並びを持たない').toBe(true);
  });

  it('両端がneutralのgaugeは向きを述べないので、段のalertが決める', () => {
    // 工程の進捗のように良し悪しを言わないバー。持ち主が向きを持てないわけではない。
    const codex = load(`
object_defs:
  kiln:
    props:
      heat:
        value: 0
        range: {min: 0, max: 100}
        gauge: {min: neutral, max: neutral}
        stages:
          - {name: cool}
          - {name: scorching, min: 80, alert: danger}
`);

    expect(worsensUpwardOf(codex, 'kiln', 'heat')).toBe(true);
  });

  it('worsensがgaugeの両端と食い違うとエラーになる', () => {
    const yaml = `
object_defs:
  torch:
    props:
      fuel:
        value: 30
        range: {min: 0, max: 30}
        gauge: {min: bad, max: good}
        worsens: up
`;
    expect(() => load(yaml)).toThrowError(/worsensの向き（up）とgaugeの向き（max: good）が食い違って/);
  });

  it('worsensがstagesのalertの向きと食い違うとエラーになる', () => {
    const yaml = `
object_defs:
  hiker:
    props:
      load:
        value: 0
        stages:
          - {name: light}
          - {name: heavy, min: 50, alert: caution}
        worsens: down
`;
    expect(() => load(yaml)).toThrowError(/worsensの向き（down）とstagesのalertの向きが食い違って/);
  });

  it('同じ向きを二度述べるのは通る', () => {
    const codex = load(`
object_defs:
  hiker:
    props:
      load:
        value: 0
        range: {min: 0, max: 100}
        gauge: {min: good, max: bad}
        worsens: up
        stages:
          - {name: light}
          - {name: heavy, min: 50, alert: caution}
`);

    expect(worsensUpwardOf(codex, 'hiker', 'load')).toBe(true);
  });

  it('worsensに未知の向きを書くとエラーになる', () => {
    expect(() =>
      load(`
object_defs:
  walker:
    props:
      travel_delay: {value: 0, worsens: sideways}
`),
    ).toThrowError(/未知の 'sideways'/);
  });
});
