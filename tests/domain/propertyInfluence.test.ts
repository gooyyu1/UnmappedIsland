import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { PropertyInfluence } from '../../src/domain/PropertyInfluence';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
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
    return new WorldCodexYamlLoader().load('core.yaml', yaml).build();
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
