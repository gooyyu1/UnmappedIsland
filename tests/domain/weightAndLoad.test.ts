import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import type { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * weight（物の重さ）とload（担いだ人が感じる負荷）の実効値導出に対する自動テスト（ContainerSystem.md）。
 * weightは率をかけない純粋な合算で、軽減は接触点であるキャラクターのloadにだけ現れる。
 */
describe('weightとloadの導出', () => {
  const yaml = `
object_defs:
  character:
    props:
      weight: {value: 70000}
      load: {value: 0}
    slots:
      hand:
        cell: {accept: {tag: item}}
      equipment:
        cell: {accept: {tag: item}}

  stone:
    tags: [item]
    props:
      weight: {value: 100}

  # 引きずるので、handにある間だけ9割軽く感じる。
  sledge:
    tags: [item]
    props:
      weight: {value: 1000}
      load_reduction_rate:
        value: 0
        passives:
          - conditions: [{in_slot: hand}]
            modify: {self: {load_reduction_rate: 90}}
    slots:
      cargo:
        cell: {accept: {tag: item}}

  # 車輪ぶん引きやすい。
  handcart:
    tags: [item]
    props:
      weight: {value: 15000}
      load_reduction_rate:
        value: 0
        passives:
          - conditions: [{in_slot: hand}]
            modify: {self: {load_reduction_rate: 95}}
    slots:
      cargo:
        cell: {accept: {tag: item}}

  # 背負えば楽だが、手に提げれば軽くならない。
  backpack:
    tags: [item]
    props:
      weight: {value: 500}
      load_reduction_rate:
        value: 0
        passives:
          - conditions: [{in_slot: equipment}]
            modify: {self: {load_reduction_rate: 50}}
    slots:
      contents:
        cell: {accept: {tag: item}}

  water:
    tags: [item]
    quantitative: true
    props:
      size: {value: 0}
      density: {value: 100}
`;

  function build(): {
    codex: WorldCodex;
    session: WorldSession;
    weightId: number;
    loadId: number;
    make: (name: string) => WorldObject;
    put: (child: WorldObject, parent: WorldObject, slotName: string) => void;
  } {
    const codex = new WorldCodexYamlLoader().load('weights.yaml', yaml).build();
    const session = new WorldSession(codex);
    const make = (name: string): WorldObject => session.spawn(codex.objectNames.getId(name));
    const put = (child: WorldObject, parent: WorldObject, slotName: string): void => {
      expect(child.moveToSlot(parent, codex.slotNames.getId(slotName), codex.wellKnown)).toBeUndefined();
    };
    return {
      codex,
      session,
      weightId: codex.propertyNames.getId('weight'),
      loadId: codex.propertyNames.getId('load'),
      make,
      put,
    };
  }

  it('weightは中身をそのまま足す（率はかからない）', () => {
    const { weightId, make, put } = build();
    const sledge = make('sledge');
    put(make('stone'), sledge, 'cargo');

    expect(sledge.getEffectiveValue(weightId), '自重1000 + 石100').toBe(1100);
  });

  it('石を載せたそりを引くと、体感は110になる', () => {
    const { weightId, loadId, make, put } = build();
    const character = make('character');
    const sledge = make('sledge');
    put(make('stone'), sledge, 'cargo');
    put(sledge, character, 'hand');

    expect(sledge.getEffectiveValue(weightId)).toBe(1100);
    expect(character.getEffectiveValue(weightId), '自重70000 + そり1100').toBe(71100);
    expect(character.getEffectiveValue(loadId), '1100 × (100-90) ÷ 100').toBe(110);
  });

  it('そりを台車に積むと、台車の重さはそりの重さをそのまま加えたものになる', () => {
    const { weightId, loadId, make, put } = build();
    const character = make('character');
    const cart = make('handcart');
    const sledge = make('sledge');
    put(make('stone'), sledge, 'cargo');
    put(sledge, cart, 'cargo');
    put(cart, character, 'hand');

    expect(cart.getEffectiveValue(weightId), '自重15000 + そり1100。そりの軽減率は効かない').toBe(16100);
    expect(character.getEffectiveValue(loadId), '効くのは引いている台車の率だけ: 16100 × 5 ÷ 100').toBe(805);
  });

  it('同じ入れ物でも、背負うか手に提げるかで体感が変わる', () => {
    const { loadId, make, put } = build();
    const character = make('character');
    const backpack = make('backpack');
    put(make('stone'), backpack, 'contents');

    put(backpack, character, 'hand');
    expect(character.getEffectiveValue(loadId), '手に提げれば軽くならない').toBe(600);

    put(backpack, character, 'equipment');
    expect(character.getEffectiveValue(loadId), '背負えば半分').toBe(300);
  });

  it('中身の重さが後から変わっても追従する', () => {
    const { codex, session, weightId, make, put } = build();
    const sledge = make('sledge');
    const water = make('water');
    water.setNumber(codex.wellKnown.sizeId, 1000, session);
    put(water, sledge, 'cargo');

    expect(sledge.getEffectiveValue(weightId), '自重1000 + 水1L(1000mL × 密度100 ÷ 100 = 1000g)').toBe(2000);

    water.setNumber(codex.wellKnown.sizeId, 500, session);
    expect(sledge.getEffectiveValue(weightId), '蒸発しても読み直せば正しい').toBe(1500);
  });

  it('出し入れを繰り返しても重さの帳尻が合う', () => {
    const { weightId, loadId, make, put } = build();
    const character = make('character');
    const sledge = make('sledge');
    const ground = make('character'); // 置き場所として使うだけ

    put(sledge, character, 'hand');
    expect(character.getEffectiveValue(loadId)).toBe(100);

    put(sledge, ground, 'hand');
    expect(character.getEffectiveValue(weightId), '出したら自重だけに戻る').toBe(70000);
    expect(character.getEffectiveValue(loadId)).toBe(0);

    put(sledge, character, 'hand');
    expect(character.getEffectiveValue(loadId), '入れ直しても同じ値').toBe(100);
  });
});
