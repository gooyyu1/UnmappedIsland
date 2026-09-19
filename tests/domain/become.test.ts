import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { inProgressObjectName } from '../../src/loader/inProgressObjects';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { AGENT_YAML, createAgent } from '../support/agent';

/**
 * 同じ個体のまま型を差し替える（GameElementDefinition.md 9.9節）。行き先は座標で指す（3.5節）ので、
 * 今ある唯一の生成器であるレシピの軸（製作中オブジェクト → 完成品）でひととおり確かめる。
 */
describe('become（同じ個体のまま型を差し替える）', () => {
  const YAML = `
in_progress_tags: [item]
traits:
  burnt:
    tags: [burnt]
  # 変種にだけプロパティを配るtrait。素の型はcharを持たないので、becomeの後ろの命令が当たったのが
  # 変化後の型かどうかを、charが動いたかで見分けられる。
  charred:
    tags: [charred]
    props:
      char: {value: 0, range: {min: 0, max: 10}}
object_defs:
  ground:
    tags: [location]
    slots:
      items:
        cell: {accept: {tag: item}}
  stick:
    tags: [item]
    interactions:
      # 行き先の座標に型が居ない宣言。候補にならないことの確認用。
      nowhere:
        trigger: {drag: {tag: item}}
        become: {subject: instrument, recipe: missing}
  # 作りかけと同じ名前のプロパティ・スロットを持つ完成品。値も中身も引き継がれる。
  axe:
    tags: [item]
    props:
      progress:
        value: 0
        range: {min: 0, max: 5}
        on_max:
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
  # 作りかけより枠の狭い完成品。2本まで入る箱から1本しか置けない箱になるので、溢れる。
  spear:
    tags: [item]
    slots:
      materials:
        cell_count: 1
        cell: {accept: {tag: item}, max: 1}
    recipes:
      basic:
        steps:
          - requires:
              - {object: stick, count: 2, consume: true}
            duration: 30
  # 積分の途中で自分の型が変わる熾火。progressが1 tickで上限へ届き、heatはその後ろに宣言してある。
  ember:
    props:
      progress: {value: 0, range: {min: 0, max: 1}, on_max: {become: {state: burnt_ember}}}
      heat: {value: 0}
    passives:
      - add: {self: {progress: 1}}
      - add: {self: {heat: 1}}
    variation_axes:
      state: {of: {tag: burnt}}
  burnt_ember:
    traits: [burnt]
  # 輸送の途中で自分の型が変わる炉。1本目でfuelが尽きてon_minからbecomeが走り、2本目はその後ろに
  # 宣言してある（2本目が動かすashは、型が変わっても同じ名前で引き継がれる）。
  kiln:
    props:
      fuel: {value: 1, range: {min: 0, max: 10}, on_min: {become: {state: burnt_ember}}}
      heat: {value: 0, range: {min: 0, max: 10}}
      ash: {value: 5, range: {min: 0, max: 10}}
      soot: {value: 0, range: {min: 0, max: 10}}
    passives:
      - transfer: {from_prop: fuel, to_prop: heat, amount: 1}
      - transfer: {from_prop: ash, to_prop: soot, amount: 1}
    variation_axes:
      state: {of: {tag: burnt}}
  # 命令列の途中で自分の型が変わる灯心。on_minにbecomeと、その後ろのaddを並べてある。
  wick:
    props:
      wax:
        value: 1
        range: {min: 0, max: 10}
        on_min:
          become: {state: charred_wick}
          add: {self: {char: 1}}
    variation_axes:
      state: {of: {tag: charred}}
  charred_wick:
    traits: [charred]
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

  const idOf = (name: string) => codex.objectNames.getId(name);
  const itemsId = () => codex.slotNames.getId('items');
  const materialsId = () => codex.slotNames.getId('materials');
  const toBase = new Map([['recipe', 'none']]);

  /** groundの上に置いた、そのレシピの製作中オブジェクト。 */
  const wipOn = (product: string): WorldObject => {
    const wip = session.createObject(idOf(inProgressObjectName(product, 'basic')));
    wip.moveToSlotOrRejection(ground.getSlot(itemsId()));
    return wip;
  };

  beforeEach(() => {
    codex = new WorldCodexYamlLoader()
      .load('become.test', YAML)
      .load('agent.yaml', AGENT_YAML)
      .buildAndReset();
    session = new WorldSession(codex);
    ground = session.createObject(idOf('ground'));
  });

  it('個体も居場所も変わらず、型だけが変わる', () => {
    const wip = wipOn('axe');
    const instanceId = wip.instanceId;

    wip.becomeAlong(toBase);

    expect(wip.def.name, 'レシピの軸を落とした座標＝完成品そのもの').toBe('axe');
    expect(wip.instanceId, '同じ個体が続く').toBe(instanceId);
    expect(wip.parent, '居場所も変わらない').toBe(ground);
    expect(ground.tryGetSlot(itemsId())!.contents).toEqual([wip]);
  });

  it('同じ名前のプロパティは、新しいrangeの外でも値をそのまま引き継ぎ、その場では反応させない', () => {
    const wip = wipOn('axe');
    const progressId = codex.propertyNames.getId('progress');
    wip.getProperty(progressId).setNumberWithoutEvents(30);

    wip.becomeAlong(toBase);

    // rangeは実効値の端なので、実体値は丸めない（GameElementDefinition.md 6.3節）。
    expect(wip.tryGetProperty(progressId)?.number ?? 0, '実体値はそのまま').toBe(30);
    expect(
      wip.tryGetProperty(progressId)?.getEffectiveValue(),
      '実効値は完成品のrange（0〜5）で切られる',
    ).toBe(5);
    expect(wip.parent, '器が変わっただけなのでon_maxは起きない').toBe(ground);
  });

  it('新しい型にしか無いプロパティは初期値から始まる', () => {
    const wip = wipOn('axe');
    // 作りかけは1工程なのでfinished_stepsを持たない（RecipeSystem.md 1節）。
    expect(wip.tryGetProperty(codex.propertyNames.getId('progress'))?.number ?? 0, '作りかけの初期値').toBe(
      0,
    );

    wip.becomeAlong(toBase);

    expect(wip.def.name).toBe('axe');
  });

  it('同じ名前のスロットの中身はそのまま残る', () => {
    const wip = wipOn('axe');
    const material = session.createObject(idOf('stick'));
    material.moveToSlotOrRejection(wip.getSlot(materialsId()));

    wip.becomeAlong(toBase);

    expect(material.parent, '完成品も同じ名前のスロットを持つので、中身は動かない').toBe(wip);
  });

  it('新しい型が持たないスロットの中身は親へこぼれる', () => {
    const wip = wipOn('torch');
    const material = session.createObject(idOf('stick'));
    material.moveToSlotOrRejection(wip.getSlot(materialsId()));

    wip.becomeAlong(toBase);

    expect(wip.def.name).toBe('torch');
    expect(material.parent, '行き場を失った中身はdestroyと同じ規則で親へ出る').toBe(ground);
  });

  it('引き継いだスロットの枠に入りきらない中身も、同じ規則で親へこぼれる', () => {
    const wip = wipOn('spear');
    const kept = session.createObject(idOf('stick'));
    const overflowing = session.createObject(idOf('stick'));
    kept.moveToSlotOrRejection(wip.getSlot(materialsId()));
    overflowing.moveToSlotOrRejection(wip.getSlot(materialsId()));

    wip.becomeAlong(toBase);

    const materials = wip.tryGetSlot(materialsId())!;
    expect(materials.contents, '枠に収まる分だけが残る').toEqual([kept]);
    expect(overflowing.parent, '入りきらなかった分は親へ出る').toBe(ground);
  });

  it('行き先の座標に型が居なければ何も起きない', () => {
    const wip = wipOn('axe');

    wip.becomeAlong(new Map([['recipe', 'missing']]));

    expect(wip.def.name, '座標が空なので変わらない').toBe(inProgressObjectName('axe', 'basic'));
    expect(wip.canBecomeAlong(new Map([['recipe', 'missing']]))).toBe(false);
    expect(wip.canBecomeAlong(toBase), '素の型は軸を落とした座標に居る').toBe(true);
  });

  it('素の型は、軸を落とした座標では自分自身のまま', () => {
    const stick = session.createObject(idOf('stick'));

    stick.becomeAlong(toBase);

    expect(stick.def.name, '軸を1つも持たない座標＝自分自身').toBe('stick');
  });

  it('行き先の座標に型が居ない組み合わせは、候補にならない', () => {
    const stick = session.createObject(idOf('stick'));
    stick.moveToSlotOrRejection(ground.getSlot(itemsId()));
    const other = session.createObject(idOf('stick'));
    other.moveToSlotOrRejection(ground.getSlot(itemsId()));

    expect(stick.combinationsWith(other, createAgent(session)).map((c) => c.name)).toEqual([]);
  });

  it('型が変われば、同種のまとまりも判定し直される', () => {
    const axe = session.createObject(idOf('axe'));
    axe.moveToSlotOrRejection(ground.getSlot(itemsId()));
    const wip = wipOn('axe');
    const items = ground.tryGetSlot(itemsId())!;
    expect(items.stacks, '作りかけは別の枠に並ぶ').toHaveLength(2);

    wip.becomeAlong(toBase);

    expect(items.stacks, '完成品になったので既にある斧と同じ枠へまとまる').toHaveLength(1);
  });

  /**
   * 積分はプロパティを宣言順に回る（8.4節）。becomeはプロパティを作り直すので、回る先が差し替え前の
   * 顔ぶれのままだと、`become`を起こしたものより後ろのぶんがそのtickから落ちる。
   */
  it('積分の途中で型が変わっても、宣言順で後ろのプロパティはそのtickぶんを受け取る', () => {
    const ember = session.createObject(idOf('ember'));
    const heatId = codex.propertyNames.getId('heat');
    const progressId = codex.propertyNames.getId('progress');

    ember.tick();

    expect(ember.def.name, 'progressの積分でon_maxが起き、その場で型が変わっている').not.toBe('ember');
    expect(ember.tryGetProperty(heatId)?.number, '作り直された後ろのheatにも、このtickぶんが積まれる').toBe(
      1,
    );
    expect(
      ember.tryGetProperty(progressId)?.number,
      '済ませたprogressは、作り直されても二度は積まれない',
    ).toBe(1);
  });

  /**
   * 出す側の`on_min`からbecomeが走ると、受け取る側のプロパティは作り直される。掴んだままの個体へ
   * 入れると、出した分が現物のどこにも残らない（9.9.1節）。
   */
  it('出した分でbecomeが走っても、受け取る側は作り直された後のプロパティが受け取る', () => {
    const kiln = session.createObject(idOf('kiln'));
    const fuelId = codex.propertyNames.getId('fuel');
    const heatId = codex.propertyNames.getId('heat');

    kiln.tick();

    expect(kiln.def.name, '出した側が尽きて、その場で型が変わっている').not.toBe('kiln');
    expect(kiln.tryGetProperty(fuelId)?.number, '出した側は尽きている').toBe(0);
    expect(kiln.tryGetProperty(heatId)?.number, '出した分は受け取る側に残っている').toBe(1);
  });

  /**
   * 輸送も宣言順に走る（8.4.1節）。型が変われば、宣言順で後ろの輸送は「もうその型でない物」への
   * 宣言になるので、そこで打ち切る（9.9.1節）。
   */
  it('輸送の途中で型が変わったら、宣言順で後ろの輸送はそのtickには走らない', () => {
    const kiln = session.createObject(idOf('kiln'));
    const ashId = codex.propertyNames.getId('ash');
    const sootId = codex.propertyNames.getId('soot');

    kiln.tick();

    expect(kiln.def.name, '1本目の輸送でfuelが尽き、on_minから型が変わっている').not.toBe('kiln');
    expect(kiln.tryGetProperty(ashId)?.number, '2本目の輸送は走らないので、出どころは減らない').toBe(5);
    expect(kiln.tryGetProperty(sootId)?.number, '受け先も動かない').toBe(0);
  });

  /**
   * 命令列は輸送と逆で、型が変わっても打ち切らない（9.9.1節）。当たる先が変化後の型であることを、
   * 変種にしか無いcharで見る——打ち切れば0のまま、変化前の型へ当たっていても行き先が無い。
   */
  it('命令列の途中で型が変わっても、後ろの命令は変化後の型の物へ当たる', () => {
    const wick = session.createObject(idOf('wick'));
    const charId = codex.propertyNames.getId('char');
    expect(wick.tryGetProperty(charId), '素の型はcharを持たない').toBeUndefined();

    wick.getProperty(codex.propertyNames.getId('wax')).add(-1);

    expect(wick.def.name, 'on_minに並べた1つ目のbecomeで型が変わっている').not.toBe('wick');
    expect(wick.tryGetProperty(charId)?.number, '後ろのaddは、変化後の型に生えたcharへ当たる').toBe(1);
  });
});
