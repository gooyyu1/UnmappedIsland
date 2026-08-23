import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
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
      load_rate:
        value: 1
        passives:
          - conditions: [{in_slot: hand}]
            modify: {self: {load_rate: -0.9}}
    slots:
      cargo:
        cell: {accept: {tag: item}}

  # 車輪ぶん引きやすい。
  handcart:
    tags: [item]
    props:
      weight: {value: 15000}
      load_rate:
        value: 1
        passives:
          - conditions: [{in_slot: hand}]
            modify: {self: {load_rate: -0.95}}
    slots:
      cargo:
        cell: {accept: {tag: item}}

  # 背負えば楽だが、手に提げれば軽くならない。
  backpack:
    tags: [item]
    props:
      weight: {value: 500}
      load_rate:
        value: 1
        passives:
          - conditions: [{in_slot: equipment}]
            modify: {self: {load_rate: -0.5}}
    slots:
      contents:
        cell: {accept: {tag: item}}

  # 量を抱えている物（中身入りの容器、LiquidContainerSystem.md 2節）。fill × density が自分の重さになる。
  water:
    tags: [item]
    props:
      # 量そのものが重さなので、器としての自重は持たない（fill × density が載る先）。
      weight: {value: 0}
      fill: {value: 0}
      density: {value: 1}
`;

  function build(): {
    codex: WorldCodex;
    session: WorldSession;
    weightId: number;
    loadId: number;
    make: (name: string) => WorldObject;
    put: (child: WorldObject, parent: WorldObject, slotName: string) => void;
  } {
    const codex = new WorldCodexYamlLoader().load('weights.yaml', yaml).buildAndReset();
    const session = new WorldSession(codex);
    const make = (name: string): WorldObject => session.createObject(codex.objectNames.getId(name));
    const put = (child: WorldObject, parent: WorldObject, slotName: string): void => {
      expect(child.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
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

    expect(sledge.tryGetProperty(weightId)?.getEffectiveValue() ?? 0, '自重1000 + 石100').toBe(1100);
  });

  it('石を載せたそりを引くと、体感は110になる', () => {
    const { weightId, loadId, make, put } = build();
    const character = make('character');
    const sledge = make('sledge');
    put(make('stone'), sledge, 'cargo');
    put(sledge, character, 'hand');

    expect(sledge.tryGetProperty(weightId)?.getEffectiveValue() ?? 0).toBe(1100);
    expect(character.tryGetProperty(weightId)?.getEffectiveValue() ?? 0, '自重70000 + そり1100').toBe(71100);
    expect(character.tryGetProperty(loadId)?.getEffectiveValue() ?? 0, '1100 × 0.1').toBeCloseTo(110, 6);
  });

  it('そりを台車に積むと、台車の重さはそりの重さをそのまま加えたものになる', () => {
    const { weightId, loadId, make, put } = build();
    const character = make('character');
    const cart = make('handcart');
    const sledge = make('sledge');
    put(make('stone'), sledge, 'cargo');
    put(sledge, cart, 'cargo');
    put(cart, character, 'hand');

    expect(
      cart.tryGetProperty(weightId)?.getEffectiveValue() ?? 0,
      '自重15000 + そり1100。そりの体感率は効かない',
    ).toBe(16100);
    expect(
      character.tryGetProperty(loadId)?.getEffectiveValue() ?? 0,
      '効くのは引いている台車の率だけ: 16100 × 0.05',
    ).toBeCloseTo(805, 6);
  });

  it('同じ入れ物でも、背負うか手に提げるかで体感が変わる', () => {
    const { loadId, make, put } = build();
    const character = make('character');
    const backpack = make('backpack');
    put(make('stone'), backpack, 'contents');

    put(backpack, character, 'hand');
    expect(character.tryGetProperty(loadId)?.getEffectiveValue() ?? 0, '手に提げれば軽くならない').toBe(600);

    put(backpack, character, 'equipment');
    expect(character.tryGetProperty(loadId)?.getEffectiveValue() ?? 0, '背負えば半分').toBe(300);
  });

  it('中身の重さが後から変わっても追従する', () => {
    const { codex, weightId, make, put } = build();
    const sledge = make('sledge');
    const water = make('water');
    water.tryGetProperty(codex.vocabulary.engine.fillId)?.setNumber(1000);
    put(water, sledge, 'cargo');

    expect(
      sledge.tryGetProperty(weightId)?.getEffectiveValue() ?? 0,
      '自重1000 + 水1L(1000mL × 密度1 = 1000g)',
    ).toBe(2000);

    water.tryGetProperty(codex.vocabulary.engine.fillId)?.setNumber(500);
    expect(sledge.tryGetProperty(weightId)?.getEffectiveValue() ?? 0, '蒸発しても読み直せば正しい').toBe(
      1500,
    );
  });

  it('出し入れを繰り返しても重さの帳尻が合う', () => {
    const { weightId, loadId, make, put } = build();
    const character = make('character');
    const sledge = make('sledge');
    const ground = make('character'); // 置き場所として使うだけ

    put(sledge, character, 'hand');
    expect(character.tryGetProperty(loadId)?.getEffectiveValue() ?? 0).toBeCloseTo(100, 6);

    put(sledge, ground, 'hand');
    expect(character.tryGetProperty(weightId)?.getEffectiveValue() ?? 0, '出したら自重だけに戻る').toBe(
      70000,
    );
    expect(character.tryGetProperty(loadId)?.getEffectiveValue() ?? 0).toBe(0);

    put(sledge, character, 'hand');
    expect(character.tryGetProperty(loadId)?.getEffectiveValue() ?? 0, '入れ直しても同じ値').toBeCloseTo(
      100,
      6,
    );
  });
});
