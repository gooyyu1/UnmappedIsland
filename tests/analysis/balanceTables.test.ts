import { describe, expect, it } from 'vitest';
import type { PropertyRoute } from '../../src/analysis/balanceTables';
import { buildBalanceTables, WHOLE_ISLAND } from '../../src/analysis/balanceTables';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 収支解析（balanceTables）が「自分を材料にして自分を生む閉路」をその土地の作り方として採らないこと
 * （issue #734）。
 *
 * 焼け石を水へ落とすと石が戻るが、その焼け石は石を焼いたものなので、この経路は正味で何も生まない。
 * 石を産まない土地では石に他の作り方が無いため、これを作り方と数えると、持ち込みより高い値段が
 * その土地の唯一の作り方になる。
 */
describe('入手経路の解決（Acquisition）', () => {
  const YAML = `
object_defs:
  medic:
    tags: [character]
    props:
      hydration:
        value: 96
        range: {min: 0, max: 96}
        passives:
          - add: {self: {hydration: -1}}

  rocky_field:
    tags: [location]
    props:
      exploration_progress: {value: 0, range: {min: 0, max: 100}}
    interactions:
      explore:
        trigger: menu
        duration: 60
        spawn: {object: stone, into: self}

  sandy_beach:
    tags: [location]
    props:
      exploration_progress: {value: 0, range: {min: 0, max: 100}}
    interactions:
      explore:
        trigger: menu
        duration: 15
        spawn: {object: coconut, into: self}

  stone:
    tags: [item]
    interactions:
      heat:
        trigger: menu
        duration: 30
        destroy: self
        spawn: {object: hot_stone}

  hot_stone:
    tags: [item]
    interactions:
      quench:
        trigger: {drag: {object: coconut_water}}
        duration: 5
        destroy: [self, dragged]
        spawn:
          - {object: stone}
          - {object: warm_water}

  coconut:
    tags: [item]
    interactions:
      crack:
        trigger: {drag: {object: stone}}
        duration: 10
        destroy: self
        spawn: {object: coconut_water}

  coconut_water:
    tags: [item]
    interactions:
      drink:
        trigger: menu
        duration: 5
        destroy: self
        add: {actor: {hydration: 96}}

  warm_water:
    tags: [item]
    interactions:
      drink:
        trigger: menu
        duration: 5
        destroy: self
        add: {actor: {hydration: 96}}
`;

  const tables = buildBalanceTables(
    new WorldCodexYamlLoader().load('test.yaml', YAML).buildAndReset(),
    'medic',
  );

  /** その土地でhydrationを埋める経路のうち、末尾の工程が指定の型のもの。 */
  const routeEndingAt = (placeName: string, objectName: string): PropertyRoute => {
    const place = tables.places.find((candidate) => candidate.name === placeName)!;
    const chains = place.properties.find((candidate) => candidate.propertyName === 'hydration')!;
    return chains.routes.find((route) => route.route.steps.at(-1)?.objectName === objectName)!;
  };

  const prerequisiteNamed = (route: PropertyRoute, label: string) =>
    route.route.prerequisites.find((prerequisite) => prerequisite.label === label);

  const costOf = (objectName: string) => tables.objectCosts.find((cost) => cost.objectName === objectName)!;

  it('石を産まない土地では、閉路ではなく持ち込みが石の値段になる', () => {
    // 探索60分で採れる石を持ち込む。閉路（焼け石を持ち込んで冷ます）で数えると120分になる。
    const stone = prerequisiteNamed(routeEndingAt('sandy_beach', 'coconut_water'), 'stone');
    expect(stone).toMatchObject({ objectName: 'stone', minutes: 60, imported: true });
  });

  it('閉路で戻ってくる石は、その経路が自前で用意した石にはならない', () => {
    // 焼け石を冷ませば石が戻るが、その焼け石が石から作られている以上、石を割る道具は別に要る。
    const route = routeEndingAt('sandy_beach', 'warm_water');
    expect(route.route.steps.map((step) => step.stepName)).toContain('quench');
    expect(prerequisiteNamed(route, 'stone')).toMatchObject({ minutes: 60, imported: true });
  });

  it('石を産む土地では、探索がそのまま石の作り方になる', () => {
    expect(prerequisiteNamed(routeEndingAt(WHOLE_ISLAND, 'coconut_water'), 'stone')).toMatchObject({
      minutes: 60,
      imported: false,
    });
    expect(costOf('stone')).toMatchObject({ minutes: 60, exploreMinutes: 60 });
  });

  it('閉路を外しても、閉路を通らない産物は作れるままになる', () => {
    // 焼け石は石を焼いたもの（60+30）。石が戻る側だけを外すので、こちらは値段が付く。
    expect(costOf('hot_stone')).toMatchObject({ minutes: 90 });
  });
});
