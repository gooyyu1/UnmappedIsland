import { describe, expect, it } from 'vitest';
import type { Slot } from '../../src/domain/Slot';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * resists（GameElementDefinition.md 7.13節）——条件が成立している間は持ち主を持てない物に対する
 * 自動テスト。土地以外の親へ移れないこと、成立した瞬間に最も近い土地へこぼれ出ること、見るのが
 * 実効値であること（罠の中では成立しない、TrapSystem.md 5節）の3つを確かめる。
 */
describe('resists（持ち主を持てない条件）', () => {
  const yaml = `
object_defs:
  world:
    singleton: true
    slots:
      places: {cell: {accept: {tag: location}}}

  land:
    tags: [location]
    slots:
      items: {cell: {accept: {tag: item}}}
      fixtures: {cell: {accept: {tag: fixture}}}
      characters: {cell: {accept: {tag: character}}}

  hunter:
    tags: [character]
    slots:
      hand: {cell: {accept: {tag: item}}}

  cart:
    tags: [item, fixture]
    slots:
      cargo: {cell: {accept: {tag: item}}}

  # 掛かっている間だけ中身の警戒を打ち消す罠（TrapSystem.md 5節と同じ形）。
  trap:
    tags: [fixture]
    slots:
      catch: {cell: {accept: {tag: item}}}
    passives:
      - modify:
          child:
            wariness: -100

  boar:
    tags: [item]
    resists: [{prop: wariness, gte: 1}]
    props:
      wariness: {value: 0, range: {min: 0, max: 100}}

  stone:
    tags: [item]
`;

  interface Fixture {
    readonly codex: WorldCodex;
    readonly world: WorldObject;
    readonly here: WorldObject;
    readonly hunter: WorldObject;
    readonly cart: WorldObject;
    readonly trap: WorldObject;
    readonly boar: WorldObject;

    /** その型の個体を1つ作る（どこにも属していない状態で返る）。 */
    create(defName: string): WorldObject;

    /** 名前で引いた枠。どの型が持つ枠かは呼び出し側が知っている。 */
    slotOf(owner: WorldObject, slotName: string): Slot;
  }

  /** 土地1つに、狩人・台車・罠と、落ち着いた（wariness 0）イノシシを並べた状態。 */
  const setUp = (): Fixture => {
    const loader = new WorldCodexYamlLoader();
    loader.load('resists.yaml', yaml);
    const codex = loader.buildAndReset();
    const session = new WorldSession(codex);

    const create = (defName: string): WorldObject => session.createObject(codex.objectNames.getId(defName));
    const slotOf = (owner: WorldObject, slotName: string): Slot =>
      owner.getSlot(codex.slotNames.getId(slotName));
    const put = (object: WorldObject, owner: WorldObject, slotName: string): void => {
      expect(object.moveToSlotOrRejection(slotOf(owner, slotName))).toBeUndefined();
    };

    const world = create('world');
    const here = create('land');
    put(here, world, 'places');

    const hunter = create('hunter');
    put(hunter, here, 'characters');
    const cart = create('cart');
    put(cart, here, 'fixtures');
    const trap = create('trap');
    put(trap, here, 'fixtures');
    const boar = create('boar');
    put(boar, here, 'items');

    return { codex, world, here, hunter, cart, trap, boar, create, slotOf };
  };

  /** 抵抗が成立する警戒値を、値の変更として与える（実効値を打ち消す寄与が無ければ即座に効く）。 */
  const rouse = (fixture: Fixture): void => {
    fixture.boar.getProperty(fixture.codex.propertyNames.getId('wariness')).setNumber(50);
  };

  it('条件が成立していなければ、普通に持ち主へ入る', () => {
    const fixture = setUp();

    expect(fixture.boar.moveToSlotOrRejection(fixture.slotOf(fixture.hunter, 'hand'))).toBeUndefined();
    expect(fixture.boar.parent).toBe(fixture.hunter);
  });

  it('条件が成立している間は、土地以外の親へ移れない', () => {
    const fixture = setUp();
    rouse(fixture);

    expect(fixture.boar.moveToSlotOrRejection(fixture.slotOf(fixture.hunter, 'hand'))).toContain(
      '収まりません',
    );
    expect(fixture.boar.moveToSlotOrRejection(fixture.slotOf(fixture.cart, 'cargo'))).toContain(
      '収まりません',
    );
    expect(fixture.boar.parent, '土地に残る').toBe(fixture.here);
  });

  it('土地の枠には置け、隣の土地へは自分で移れる', () => {
    const fixture = setUp();
    rouse(fixture);

    expect(
      fixture.boar.rejectionForMoveTo(fixture.slotOf(fixture.here, 'items')),
      '今居る土地は拒まない',
    ).toBeUndefined();

    const there = fixture.create('land');
    expect(there.moveToSlotOrRejection(fixture.slotOf(fixture.world, 'places'))).toBeUndefined();
    expect(fixture.boar.moveToSlotOrRejection(fixture.slotOf(there, 'items'))).toBeUndefined();
    expect(fixture.boar.parent).toBe(there);
  });

  it('入れ物の中で成立したら、最も近い土地へこぼれ出る', () => {
    const fixture = setUp();
    expect(fixture.boar.moveToSlotOrRejection(fixture.slotOf(fixture.cart, 'cargo'))).toBeUndefined();

    rouse(fixture);

    expect(fixture.boar.parent, '暴れて荷車から飛び出す').toBe(fixture.here);
  });

  it('持ち主の持ち主も持ち主なので、土地まで遡ってこぼれる', () => {
    const fixture = setUp();
    expect(
      fixture.cart.moveToSlotOrRejection(fixture.slotOf(fixture.hunter, 'hand')),
      '台車ごと担ぐ',
    ).toBeUndefined();
    expect(fixture.boar.moveToSlotOrRejection(fixture.slotOf(fixture.cart, 'cargo'))).toBeUndefined();

    rouse(fixture);

    expect(fixture.boar.parent, '狩人の手も持ち主なので、土地まで落ちる').toBe(fixture.here);
  });

  it('宣言を持たない物は、時間が経っても持ち主に留まる', () => {
    const fixture = setUp();
    const stone = fixture.create('stone');
    expect(stone.moveToSlotOrRejection(fixture.slotOf(fixture.cart, 'cargo'))).toBeUndefined();

    fixture.world.tick();

    expect(stone.parent).toBe(fixture.cart);
  });

  it('罠の中では成立せず、取り出した瞬間に成立して地面へ落ちる', () => {
    const fixture = setUp();
    expect(fixture.boar.moveToSlotOrRejection(fixture.slotOf(fixture.trap, 'catch'))).toBeUndefined();

    rouse(fixture);
    expect(fixture.boar.parent, '寄与が警戒を打ち消している間は飛び出さない').toBe(fixture.trap);

    expect(
      fixture.boar.moveToSlotOrRejection(fixture.slotOf(fixture.hunter, 'hand')),
      '掛かっている間は手に取れる',
    ).toBeUndefined();
    expect(fixture.boar.parent, '罠を出れば寄与が消えて成立し、手には持てず地面へ落ちる').toBe(fixture.here);
  });

  it('値の変更を経ずに成立した抵抗も、tickが拾う', () => {
    const fixture = setUp();
    expect(fixture.boar.moveToSlotOrRejection(fixture.slotOf(fixture.cart, 'cargo'))).toBeUndefined();
    // 値だけを静かに置く（rangeイベントもこぼれ出しの判定も走らない入口）。
    fixture.boar.getProperty(fixture.codex.propertyNames.getId('wariness')).setNumberWithoutEvents(5);

    fixture.world.tick();

    expect(fixture.boar.parent).toBe(fixture.here);
  });
});

/** resistsの宣言をtraitと混ぜたときの規則（GameElementDefinition.md 5節・7.13節）。 */
describe('resists（宣言の混ぜ方）', () => {
  const load = (yaml: string): WorldCodex =>
    new WorldCodexYamlLoader().load('resists.yaml', yaml).buildAndReset();

  it('traitが宣言した抵抗を、混ぜ込んだ型が引き継ぐ', () => {
    const codex = load(`
traits:
  wild:
    resists: [{prop: wariness, gte: 1}]
    props:
      wariness: {value: 0}
object_defs:
  boar:
    traits: [wild]
`);

    expect(codex.objects.get(codex.objectNames.getId('boar')).resists).toBeDefined();
  });

  it('複数のtraitが宣言しているとエラーになる', () => {
    expect(() =>
      load(`
traits:
  wild:
    resists: [{prop: wariness, gte: 1}]
  heavy:
    resists: [{prop: weight, gte: 100}]
object_defs:
  boar:
    traits: [wild, heavy]
    props:
      wariness: {value: 0}
      weight: {value: 0}
`),
    ).toThrowError(/resists/);
  });
});
