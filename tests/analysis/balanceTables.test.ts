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

/**
 * 海区にしか湧かないものを、島の表が1つも数えないこと（issue #921）。
 *
 * 海区に湧く漁り場は、島から見れば入手経路が無い。それでも工程として数えると、その物の代表経路が
 * 海のほうへ決まり、**島に在る経路が表から押し出される**——落とされるのは入手経路の無い海の経路だけで、
 * 押し出された島の経路は戻ってこない。海区に湧く土地（小島）は、それ自身が島の土地の行にもなる。
 *
 * `sea`タグを持つのは海区だけで、そこに湧く物は持たない。湧き元を辿って外すのが
 * `islandLocations`の役目で、ここが見るのはその結果を収支表が使えているか。
 */
describe('海でしか手に入らないもの', () => {
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

  spring_field:
    tags: [location]
    props:
      exploration_progress: {value: 0, range: {min: 0, max: 100}}
    interactions:
      explore:
        trigger: menu
        duration: 60
        spawn: {object: gourd, into: self}

  # 海区。探索でき、探索を重ねると漁り場と小島が湧く。
  coastal_waters:
    tags: [sea, location]
    props:
      exploration_progress:
        value: 0
        range: {min: 0, max: 3}
        on_max:
          spawn: {object: offshore_islet, into: self}
    interactions:
      watch:
        trigger: menu
        duration: 15
        add: {self: {exploration_progress: 1}}
        spawn: {object: fish_shoal, into: self}

  # 海区に湧く漁り場。島の泉より速く水を返すので、外さないと代表経路がこちらに決まる。
  fish_shoal:
    tags: [fixture]
    interactions:
      net_water:
        trigger: menu
        duration: 5
        spawn: {object: gourd, into: actor}

  # 海区に湧く土地。sea タグは持たない。
  offshore_islet:
    tags: [fixture, location]
    props:
      exploration_progress: {value: 0, range: {min: 0, max: 100}}
    interactions:
      explore:
        trigger: menu
        duration: 15
        spawn: {object: gourd, into: self}

  gourd:
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

  /** 島全体の文脈で、需要を埋める経路すべて（`工程 → 工程`の字面）。 */
  const routeTexts = tables.places
    .find((place) => place.name === WHOLE_ISLAND)!
    .properties.flatMap((chains) =>
      chains.routes.map(({ route }) =>
        route.steps.map((step) => `${step.objectName}.${step.stepName}`).join(' → '),
      ),
    );

  it('海に湧くものの経路が、島の経路を押し出さない', () => {
    expect(routeTexts).toEqual(['spring_field.explore → gourd.drink']);
  });

  it('海区に湧く土地は、島の土地の行にならない', () => {
    expect(tables.places.map((place) => place.name)).toEqual([WHOLE_ISLAND, 'spring_field']);
  });

  it('海に湧くものは、供給表にも総コスト表にも出ない', () => {
    expect(tables.supply.map((row) => row.ownerName)).not.toContain('fish_shoal');
    expect(tables.supply.map((row) => row.ownerName)).not.toContain('offshore_islet');
    expect(tables.objectCosts.map((cost) => cost.objectName)).not.toContain('fish_shoal');
  });
});

/**
 * 総コストの出ない行が、「島のどこにも入手経路が無い」と「朽ちない設備の待ち生産でしか得られない」を
 * 区別すること（issue #1175）。
 *
 * 朽ちない設備は1周期ぶんを按分できない（「待って得る生産の数え方」）ので、その産物には値段が
 * 付かない。それを入手経路の無いものと同じ`undefined`で出すと、**工程も設備も在るのに内容の穴と
 * 読める**。
 */
describe('総コストが出ない理由', () => {
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

  stone:
    tags: [item]

  # 朽ちない設備。干し上がるたびに塩を返すが、寿命が無いので按分の分母が取れない。
  salt_pan:
    tags: [fixture]
    slots:
      catch:
        cell_count: 1
        cell: {accept: {tag: item}}
        placement: [auto]
    props:
      drying_remaining:
        value: 24
        range: {min: 0, max: 24}
        passives:
          - add: {self: {drying_remaining: -1}}
        on_min:
          add: {self: {drying_remaining: 24}}
          spawn: {object: salt, into: self}
    recipes:
      laid:
        steps:
          - requires:
              - {object: stone, count: 1, consume: true}
            duration: 60

  # 朽ちる設備。耐久が尽きると消えるので、周期÷寿命が産物1個ぶんの値段になる。
  snare:
    tags: [fixture]
    slots:
      catch:
        cell_count: 1
        cell: {accept: {tag: item}}
        placement: [auto]
    props:
      catch_remaining:
        value: 12
        range: {min: 0, max: 12}
        passives:
          - add: {self: {catch_remaining: -1}}
        on_min:
          add: {self: {catch_remaining: 12}}
          spawn: {object: rat, into: self}
      wear:
        value: 100
        range: {min: 0, max: 100}
        passives:
          - add: {self: {wear: -1}}
        on_min:
          destroy: self
    recipes:
      woven:
        steps:
          - requires:
              - {object: stone, count: 1, consume: true}
            duration: 60

  salt:
    tags: [item]

  rat:
    tags: [item]

  # 作る工程も見つけ方も無いもの。
  spear:
    tags: [item]
`;

  const tables = buildBalanceTables(
    new WorldCodexYamlLoader().load('test.yaml', YAML).buildAndReset(),
    'medic',
  );

  const costOf = (objectName: string) => tables.objectCosts.find((cost) => cost.objectName === objectName)!;

  it('朽ちない設備の産物は、値段が付かないまま入手経路のあるものとして印が付く', () => {
    expect(costOf('salt')).toMatchObject({ minutes: undefined, onlyFromEverlastingDevice: true });
  });

  it('その印が指す先（待ち生産表）に、産物の周期が在る', () => {
    const wholeIsland = tables.places.find((place) => place.name === WHOLE_ISLAND)!;

    expect(wholeIsland.devices.find((device) => device.productName === 'salt')).toMatchObject({
      deviceName: 'salt_pan',
      lifetimeDays: undefined,
    });
  });

  it('朽ちる設備の産物には印が付かず、按分を含んだ総コストが出る', () => {
    // 罠は石1つ（60分）と製作60分の120分で、寿命1500分のうち180分を1周期で使う。
    expect(costOf('rat').onlyFromEverlastingDevice).toBe(false);
    expect(costOf('rat').minutes).toBeCloseTo(14.4);
  });

  it('作る工程そのものが無いものには、印が付かない', () => {
    expect(costOf('spear')).toMatchObject({ minutes: undefined, onlyFromEverlastingDevice: false });
  });
});
