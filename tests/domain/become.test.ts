import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { inProgressObjectName } from '../../src/loader/inProgressObjects';
import type { WorldCodex } from '../../src/domain/WorldCodex';

/**
 * 同じ個体のまま型を差し替える（GameElementDefinition.md 9.9節）。行き先は座標で指す（3.5節）ので、
 * 今ある唯一の生成器であるレシピの軸（製作中オブジェクト → 完成品）でひととおり確かめる。
 */
describe('become（同じ個体のまま型を差し替える）', () => {
  const YAML = `
object_defs:
  ground:
    tags: [location]
    slots:
      items:
        cell: {accept: {tag: item}}
  stick:
    tags: [item]
    combinations:
      # 行き先の座標に型が居ない宣言。候補にならないことの確認用。
      nowhere:
        with: {tag: item}
        become: {subject: dragged, recipe: missing}
  # 作りかけと同じ名前のプロパティ・スロットを持つ完成品。値も中身も引き継がれる。
  axe:
    tags: [item]
    props:
      progress:
        value: 0
        range: {min: 0, max: 5}
        on_overflow:
          destroy: self
    slots:
      materials:
        cell: {accept: {tag: item}}
    recipes:
      basic:
        steps:
          - requires:
              - {object: stick, count: 1, consume: true}
            duration: 30
  # 作りかけと名前の重なるスロットを持たない完成品。中身は行き場を失う。
  torch:
    tags: [item]
    recipes:
      basic:
        steps:
          - requires:
              - {object: stick, count: 1, consume: true}
            duration: 30
`;

  let codex: WorldCodex;
  let session: WorldSession;
  let ground: WorldObject;

  const idOf = (name: string): number => codex.objectNames.getId(name);
  const itemsId = (): number => codex.slotNames.getId('items');
  const materialsId = (): number => codex.slotNames.getId('materials');
  const toBase = new Map([['recipe', 'none']]);

  /** groundの上に置いた、そのレシピの製作中オブジェクト。 */
  const wipOn = (product: string): WorldObject => {
    const wip = session.spawn(idOf(inProgressObjectName(product, 'basic')));
    wip.moveToSlot(ground, itemsId());
    return wip;
  };

  beforeEach(() => {
    codex = new WorldCodexYamlLoader().load('become.test', YAML).build();
    session = new WorldSession(codex);
    ground = session.spawn(idOf('ground'));
  });

  it('個体も居場所も変わらず、型だけが変わる', () => {
    const wip = wipOn('axe');
    const instanceId = wip.instanceId;

    wip.becomeAlong(toBase, session);

    expect(wip.def.name, 'レシピの軸を落とした座標＝完成品そのもの').toBe('axe');
    expect(wip.instanceId, '同じ個体が続く').toBe(instanceId);
    expect(wip.parent, '居場所も変わらない').toBe(ground);
    expect(ground.getSlotByLocalId(ground.def.slotLayout.toLocal(itemsId())).contents).toEqual([wip]);
  });

  it('同じ名前のプロパティは値を引き継ぎ、新しいrangeの外はクランプするだけで反応させない', () => {
    const wip = wipOn('axe');
    const progressId = codex.propertyNames.getId('progress');
    wip.setProperty(progressId, 30);

    wip.becomeAlong(toBase, session);

    expect(wip.getNumber(progressId), '完成品のrange（0〜5）の上端へ丸める').toBe(5);
    expect(wip.parent, 'クランプでon_overflowは起きない（器が変わっただけ）').toBe(ground);
  });

  it('新しい型にしか無いプロパティは初期値から始まる', () => {
    const wip = wipOn('axe');
    // 作りかけは1工程なのでfinished_stepsを持たない（RecipeSystem.md 1節）。
    expect(wip.getNumber(codex.propertyNames.getId('progress')), '作りかけの初期値').toBe(0);

    wip.becomeAlong(toBase, session);

    expect(wip.def.name).toBe('axe');
  });

  it('同じ名前のスロットの中身はそのまま残る', () => {
    const wip = wipOn('axe');
    const material = session.spawn(idOf('stick'));
    material.moveToSlot(wip, materialsId());

    wip.becomeAlong(toBase, session);

    expect(material.parent, '完成品も同じ名前のスロットを持つので、中身は動かない').toBe(wip);
  });

  it('新しい型が持たないスロットの中身は親へこぼれる', () => {
    const wip = wipOn('torch');
    const material = session.spawn(idOf('stick'));
    material.moveToSlot(wip, materialsId());

    wip.becomeAlong(toBase, session);

    expect(wip.def.name).toBe('torch');
    expect(material.parent, '行き場を失った中身はdestroyと同じ規則で親へ出る').toBe(ground);
  });

  it('行き先の座標に型が居なければ何も起きない', () => {
    const wip = wipOn('axe');

    wip.becomeAlong(new Map([['recipe', 'missing']]), session);

    expect(wip.def.name, '座標が空なので変わらない').toBe(inProgressObjectName('axe', 'basic'));
    expect(wip.canBecomeAlong(new Map([['recipe', 'missing']]))).toBe(false);
    expect(wip.canBecomeAlong(toBase), '素の型は軸を落とした座標に居る').toBe(true);
  });

  it('素の型は、軸を落とした座標では自分自身のまま', () => {
    const stick = session.spawn(idOf('stick'));

    stick.becomeAlong(toBase, session);

    expect(stick.def.name, '軸を1つも持たない座標＝自分自身').toBe('stick');
  });

  it('行き先の座標に型が居ない組み合わせは、候補にならない', () => {
    const stick = session.spawn(idOf('stick'));
    stick.moveToSlot(ground, itemsId());
    const other = session.spawn(idOf('stick'));
    other.moveToSlot(ground, itemsId());

    expect(stick.combinationsWith(other, undefined)).toEqual([]);
  });

  it('型が変われば、同種のまとまりも判定し直される', () => {
    const axe = session.spawn(idOf('axe'));
    axe.moveToSlot(ground, itemsId());
    const wip = wipOn('axe');
    const items = ground.getSlotByLocalId(ground.def.slotLayout.toLocal(itemsId()));
    expect(
      items.cells.filter((cell) => cell !== undefined),
      '作りかけは別の枠に並ぶ',
    ).toHaveLength(2);

    wip.becomeAlong(toBase, session);

    expect(
      items.cells.filter((cell) => cell !== undefined),
      '完成品になったので既にある斧と同じ枠へまとまる',
    ).toHaveLength(1);
  });
});
