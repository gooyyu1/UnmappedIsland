import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { PropertyInfluence } from '../../src/domain/PropertyInfluence';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * ステータス詳細ウィンドウ（docs/ui/Windows.md 8節）に並ぶ影響の出入りを、持続効果の宣言
 * （GameElementDefinition.md 8節）から導けることの自動テスト。
 */
describe('PropertyInfluence(プロパティが交わしている影響)', () => {
  let nextInstanceId: number;

  beforeEach(() => {
    nextInstanceId = 1;
  });

  function load(yaml: string): WorldCodex {
    return new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
  }

  /** 時間が進む世界。tickが回るのは、ここの`stuff`枠から下に繋がっている物だけ。 */
  const WORLD_YAML = `
object_defs:
  world:
    singleton: true
    props:
      minutes_per_tick: {value: 15}
      minute:
        value: 0
        range: {min: 0, max: 60}
        on_max:
          add: {self: {minute: -60, hour: 1}}
      hour: {value: 0, range: {min: 0, max: 24}}
      day: {value: 1}
    slots:
      stuff: {}
`;

  /** WORLD_YAMLの世界を組み、その`stuff`枠へ型を置ける場面。時間を進める操作を回す試験が使う。 */
  function loadWithWorld(yaml: string): {
    codex: WorldCodex;
    session: WorldSession;
    place: (objectName: string) => WorldObject;
  } {
    const codex = new WorldCodexYamlLoader()
      .load('world.yaml', WORLD_YAML)
      .load('extra.yaml', yaml)
      .buildAndReset();
    const worldDef = codex.objects.get(codex.objectNames.getId('world'));
    const world = new World(new WorldObject(nextInstanceId++, worldDef, new WorldSession(codex)), codex);
    const session = new WorldSession(codex, world);
    const stuff = world.instance.getSlot(codex.slotNames.getId('stuff'));

    return {
      codex,
      session,
      place: (objectName) => {
        const object = spawn(codex, objectName, session);
        expect(object.moveToSlotOrRejection(stuff)).toBeUndefined();
        return object;
      },
    };
  }

  function spawn(codex: WorldCodex, objectName: string, session = new WorldSession(codex)): WorldObject {
    const def = codex.objects.get(codex.objectNames.getId(objectName));
    return new WorldObject(nextInstanceId++, def, session);
  }

  /** 影響1件を、相手（プロパティ名かオブジェクトの型名）と記号の組で表した読みやすい形に直す。 */
  function shown(codex: WorldCodex, influences: readonly PropertyInfluence[]): readonly string[] {
    return influences.map((influence) => {
      const counterpart =
        influence.counterpart.kind === 'property'
          ? codex.propertyNames.getName(influence.counterpart.propertyGlobalId)
          : influence.counterpart.object.def.name;
      const mark = influence.reversible ? (influence.increases ? '▲' : '▼') : influence.increases ? '+' : '-';
      return `${counterpart}${mark}${influence.active ? '' : '(休)'}`;
    });
  }

  it('段で縛られた効果は、その段を持つプロパティから相手への影響になる', () => {
    // 「痛みがunbearableの段にある間だけ意識を押し下げる」（animals.yaml）と同じ形。
    const codex = load(`
object_defs:
  beast:
    props:
      pain:
        value: 90
        range: {min: 0, max: 100}
        stages:
          - {name: painless}
          - name: unbearable
            min: 83
            passives:
              - modify: {self: {consciousness: -45}}
      consciousness:
        value: 100
        range: {min: 0, max: 100}
`);
    const beast = spawn(codex, 'beast');

    const pain = beast.readInfluences(codex.propertyNames.getId('pain'));
    const consciousness = beast.readInfluences(codex.propertyNames.getId('consciousness'));

    expect(shown(codex, pain.given), '痛みが意識を押し下げている').toEqual(['consciousness▼']);
    expect(shown(codex, pain.received), '痛みを動かす宣言は無い').toEqual([]);
    expect(shown(codex, consciousness.received), '意識は痛みから受けている').toEqual(['pain▼']);
    expect(shown(codex, consciousness.given), '意識は何も動かしていない').toEqual([]);
  });

  it('段から外れている効果は、相手も記号も同じまま「効いていない」として残る', () => {
    const codex = load(`
object_defs:
  beast:
    props:
      pain:
        value: 10
        range: {min: 0, max: 100}
        stages:
          - {name: painless}
          - name: unbearable
            min: 83
            passives:
              - modify: {self: {consciousness: -45}}
      consciousness:
        value: 100
        range: {min: 0, max: 100}
`);
    const beast = spawn(codex, 'beast');

    const consciousness = beast.readInfluences(codex.propertyNames.getId('consciousness'));

    expect(shown(codex, consciousness.received), '条件が成立していない影響も並ぶ').toEqual(['pain▼(休)']);
  });

  it('段を持たない効果は、動く先そのものを原因として「受けている影響」にだけ出す', () => {
    // 「満腹度がtick毎に減る」（characters/）と同じ形。自分が自分を動かす1本を両側へ書かない。
    const codex = load(`
object_defs:
  person:
    props:
      satiety:
        value: 300
        range: {min: 0, max: 1500}
        passives:
          - add: {self: {satiety: -16}}
`);
    const person = spawn(codex, 'person');

    const satiety = person.readInfluences(codex.propertyNames.getId('satiety'));

    expect(shown(codex, satiety.received)).toEqual(['satiety-']);
    expect(shown(codex, satiety.given), '自分自身への影響は与える側には出さない').toEqual([]);
  });

  it('段ごとに宣言された同じ影響は1件にまとまり、今いる段のぶんが効いている扱いになる', () => {
    // 体脂肪の基礎代謝（characters/）と同じ形。段の数だけ宣言があっても、読み手には1件。
    const codex = load(`
object_defs:
  person:
    props:
      body_fat:
        value: 1320
        range: {min: 0, max: 5280}
        stages:
          - name: gaunt
            passives:
              - add: {self: {body_fat: -0.7}}
          - name: nourished
            min: 440
            passives:
              - add: {self: {body_fat: -1}}
          - name: stout
            min: 2640
            passives:
              - add: {self: {body_fat: -1.3}}
`);
    const person = spawn(codex, 'person');

    const bodyFat = person.readInfluences(codex.propertyNames.getId('body_fat'));

    expect(shown(codex, bodyFat.received), '3段ぶんの宣言が1件に畳まれる').toEqual(['body_fat-']);
  });

  it('輸送は両端を互いの原因として出す', () => {
    // 糖質→体脂肪（characters/）と同じ形。出す側から見れば与えていて、同時に持っていかれている。
    const codex = load(`
object_defs:
  person:
    props:
      carbohydrate:
        value: 40
        range: {min: 0, max: 120}
        passives:
          - transfer: {from_prop: carbohydrate, to_prop: body_fat, amount: 2}
      body_fat:
        value: 1320
        range: {min: 0, max: 5280}
`);
    const person = spawn(codex, 'person');

    const carbohydrate = person.readInfluences(codex.propertyNames.getId('carbohydrate'));
    const bodyFat = person.readInfluences(codex.propertyNames.getId('body_fat'));

    expect(shown(codex, carbohydrate.given), '体脂肪を増やしている').toEqual(['body_fat+']);
    expect(shown(codex, carbohydrate.received), '体脂肪へ持っていかれて減る').toEqual(['body_fat-']);
    expect(shown(codex, bodyFat.received), '糖質から流れ込んでいる').toEqual(['carbohydrate+']);
    expect(shown(codex, bodyFat.given), '受け取る側から見れば、糖質を吸い上げている').toEqual([
      'carbohydrate-',
    ]);
  });

  it('別のオブジェクトが宣言した影響は、そのオブジェクト自身を相手として出す', () => {
    // 怪我が痛みを押し上げ、当てた治療具が押し下げる（injuries.yaml・treatments.yaml）と同じ形。
    const codex = load(`
object_defs:
  person:
    props:
      pain:
        value: 0
        range: {min: 0, max: 100}
    slots:
      injuries:
        cell: {accept: {tag: injury}}
  sprain:
    tags: [injury]
    slots:
      treatment:
        cell: {accept: {tag: treatment}}
    passives:
      - modify: {parent: {pain: 40}}
  bandage:
    tags: [treatment]
    passives:
      - modify: {ancestor: {pain: -10}}
`);
    const session = new WorldSession(codex);
    const person = spawn(codex, 'person', session);
    const sprain = spawn(codex, 'sprain', session);
    const bandage = spawn(codex, 'bandage', session);
    expect(sprain.moveToSlotOrRejection(person.getSlot(codex.slotNames.getId('injuries')))).toBeUndefined();
    expect(bandage.moveToSlotOrRejection(sprain.getSlot(codex.slotNames.getId('treatment')))).toBeUndefined();

    const pain = person.readInfluences(codex.propertyNames.getId('pain'));

    expect(shown(codex, pain.received), '怪我と治療具が並ぶ').toEqual(['sprain▲', 'bandage▼']);
  });

  it('同じ型の怪我を2つ負えば、影響も2件並ぶ', () => {
    const codex = load(`
object_defs:
  person:
    props:
      pain:
        value: 0
        range: {min: 0, max: 100}
    slots:
      injuries:
        cell: {accept: {tag: injury}}
  sprain:
    tags: [injury]
    stackable: false
    passives:
      - modify: {parent: {pain: 40}}
`);
    const session = new WorldSession(codex);
    const person = spawn(codex, 'person', session);
    for (const injury of [spawn(codex, 'sprain', session), spawn(codex, 'sprain', session)])
      expect(injury.moveToSlotOrRejection(person.getSlot(codex.slotNames.getId('injuries')))).toBeUndefined();

    const pain = person.readInfluences(codex.propertyNames.getId('pain'));

    expect(shown(codex, pain.received), '影響元が別々の個体なので畳まない').toEqual(['sprain▲', 'sprain▲']);
  });

  it('担いだ物の重さは、その物自身を影響元として並ぶ', () => {
    // ContainerSystem.md 2節: 中身の重さの伝播はエンジンが生やす`modify`（containerPropagation）
    // なので、記号もmodifyと同じで、影響元は押し上げている当人になる（Windows.md 8.4節）。
    const codex = load(`
object_defs:
  person:
    props:
      load:
        value: 0
        range: {min: 0, max: 30000}
    slots:
      hand:
        cell: {accept: {tag: item}}
  stone:
    tags: [item]
    props:
      weight: {value: 500}
`);
    const session = new WorldSession(codex);
    const person = spawn(codex, 'person', session);
    const loadId = codex.propertyNames.getId('load');
    const hand = person.getSlot(codex.slotNames.getId('hand'));

    expect(shown(codex, person.readInfluences(loadId).received), '空身では押し上げる物が居ない').toEqual([]);

    const stone = spawn(codex, 'stone', session);
    expect(stone.moveToSlotOrRejection(hand)).toBeUndefined();
    expect(shown(codex, person.readInfluences(loadId).received), '担いだ石が影響元').toEqual(['stone▲']);

    const another = spawn(codex, 'stone', session);
    expect(another.moveToSlotOrRejection(hand)).toBeUndefined();
    expect(shown(codex, person.readInfluences(loadId).received), '影響元が別々の個体なので畳まない').toEqual([
      'stone▲',
      'stone▲',
    ]);
  });

  it('役を対象にした影響は、その操作が続いている間だけ相手の一覧に並ぶ', () => {
    // 道が「今歩いている人の速さを下げる」を持つ形（GameElementDefinition.md 11.5節）。宣言元（道）は
    // 歩く人から見て木の上に居ないので、集める範囲が木だけだと歩いている最中でも一覧に出ない。
    const { codex, session, place } = loadWithWorld(`
object_defs:
  walker:
    props:
      speed: {value: 100, range: {min: 0, max: 100}}
  path:
    passives:
      - modify: {agent: {speed: -30}}
    interactions:
      travel:
        trigger: menu
        duration: 30
`);
    const path = place('path');
    const walker = place('walker');

    const speedId = codex.propertyNames.getId('speed');
    const receivedSpeed = () => shown(codex, walker.readInfluences(speedId).received);
    expect(receivedSpeed(), '歩いていない間は、道は速さへ届いていない').toEqual([]);

    // 歩く30分の途中（tick）を覗く。関係が張られているのはこの間だけ。
    let whileWalking: readonly string[] = [];
    session.observeTicks(
      () => {
        whileWalking = receivedSpeed();
      },
      () => {
        expect(path.tryGetAction('travel', walker)?.tryExecute()).toBe(true);
      },
    );

    expect(whileWalking, '歩いている間は、道を影響元として並ぶ').toEqual(['path▼']);
    expect(receivedSpeed(), '歩き終えれば消える').toEqual([]);
  });

  it('操作が宣言した持続効果も、その操作が続いている間だけ相手の一覧に並ぶ', () => {
    // 窯が「焼いている間だけ焼く者の力を削ぐ」を操作の下に書いた形
    // （GameElementDefinition.md 11.7節）。宣言を持っているのは物ではなく操作なので、物のdefを
    // 辿るだけでは、効いている最中でも見つからない。
    const { codex, session, place } = loadWithWorld(`
object_defs:
  baker:
    props:
      strength: {value: 10, range: {min: 0, max: 100}}
  kiln:
    interactions:
      bake:
        trigger: menu
        duration: 30
        passives:
          - modify: {agent: {strength: -5}}
`);
    const kiln = place('kiln');
    const baker = place('baker');

    const strengthId = codex.propertyNames.getId('strength');
    const receivedStrength = () => shown(codex, baker.readInfluences(strengthId).received);
    expect(receivedStrength(), '焼いていない間は、窯は力へ届いていない').toEqual([]);

    let whileBaking: readonly string[] = [];
    session.observeTicks(
      () => {
        whileBaking = receivedStrength();
      },
      () => {
        expect(kiln.tryGetAction('bake', baker)?.tryExecute()).toBe(true);
      },
    );

    expect(whileBaking, '焼いている間は、窯を影響元として並ぶ').toEqual(['kiln▼']);
    expect(receivedStrength(), '焼き終えれば消える').toEqual([]);
  });

  it('操作が宣言元自身へ書いた持続効果は、その値が自分から受けている影響になる', () => {
    // 休憩が「休んでいる間だけ体力を戻す」を持つ形（characters/）。宣言元と相手は同じ物なので木の
    // 上には居るが、宣言が物のdefではなく操作にあるので、こちらも同じく見つからない。
    const { codex, session, place } = loadWithWorld(`
object_defs:
  survivor:
    props:
      stamina: {value: 50, range: {min: 0, max: 100}}
    interactions:
      rest:
        trigger: menu
        duration: 30
        passives:
          - add: {self: {stamina: 2.5}}
`);
    const survivor = place('survivor');

    const staminaId = codex.propertyNames.getId('stamina');
    const receivedStamina = () => shown(codex, survivor.readInfluences(staminaId).received);
    expect(receivedStamina(), '休んでいない間は、体力を戻すものが居ない').toEqual([]);

    let whileResting: readonly string[] = [];
    session.observeTicks(
      () => {
        whileResting = receivedStamina();
      },
      () => {
        expect(survivor.tryGetAction('rest', survivor)?.tryExecute()).toBe(true);
      },
    );

    expect(whileResting, '休んでいる間は、体力が戻っていることが読める').toEqual(['stamina+']);
    expect(receivedStamina(), '休み終えれば消える').toEqual([]);
  });

  it('操作が宣言した持続効果の相手は、その操作に加わっていない物のこともある', () => {
    // 操作の下に書ける対象は役だけではない（GameElementDefinition.md 11.7節。`child`以外は書ける）
    // ので、焼いている間だけ据えた先を温める窯は、その操作に加わっていない小屋を動かす。
    const { codex, session, place } = loadWithWorld(`
object_defs:
  baker: {}
  hut:
    props:
      heat: {value: 0, range: {min: 0, max: 100}}
    slots:
      fixtures: {cell: {accept: {tag: fixture}}}
  oven:
    tags: [fixture]
    interactions:
      bake:
        trigger: menu
        duration: 30
        passives:
          - add: {parent: {heat: 1}}
`);
    const hut = place('hut');
    const baker = place('baker');
    const oven = spawn(codex, 'oven', session);
    expect(oven.moveToSlotOrRejection(hut.getSlot(codex.slotNames.getId('fixtures')))).toBeUndefined();

    const heatId = codex.propertyNames.getId('heat');
    const receivedHeat = () => shown(codex, hut.readInfluences(heatId).received);
    expect(receivedHeat(), '焼いていない間は、小屋を温めるものが居ない').toEqual([]);

    let whileBaking: readonly string[] = [];
    session.observeTicks(
      () => {
        whileBaking = receivedHeat();
      },
      () => {
        expect(oven.tryGetAction('bake', baker)?.tryExecute()).toBe(true);
      },
    );

    expect(whileBaking, '焼いている間は、加わっていない小屋にも窯が影響元として並ぶ').toEqual(['oven+']);
    expect(receivedHeat(), '焼き終えれば消える').toEqual([]);
  });

  it('怪我が外れれば、その影響も一覧から消える', () => {
    const codex = load(`
object_defs:
  person:
    props:
      pain:
        value: 0
        range: {min: 0, max: 100}
    slots:
      injuries:
        cell: {accept: {tag: injury}}
  ground:
    slots:
      items:
        cell: {accept: {tag: injury}}
  sprain:
    tags: [injury]
    passives:
      - modify: {parent: {pain: 40}}
`);
    const session = new WorldSession(codex);
    const person = spawn(codex, 'person', session);
    const ground = spawn(codex, 'ground', session);
    const sprain = spawn(codex, 'sprain', session);
    expect(sprain.moveToSlotOrRejection(person.getSlot(codex.slotNames.getId('injuries')))).toBeUndefined();
    expect(sprain.moveToSlotOrRejection(ground.getSlot(codex.slotNames.getId('items')))).toBeUndefined();

    const pain = person.readInfluences(codex.propertyNames.getId('pain'));

    expect(shown(codex, pain.received)).toEqual([]);
  });
});
