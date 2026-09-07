import { describe, expect, it } from 'vitest';
import { InteractionRelation } from '../../src/domain/ReferenceRoot';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { putIntoSlot } from '../../src/domain/slotEntry';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { AGENT_YAML, createAgent } from '../support/agent';

/**
 * 操作の関係（GameElementDefinition.md 11.5節）の実行時の振る舞い。
 *
 * **関係は世界に刻まれる**ので、参加者の`props`（`base`・`passives`）から役を指せる。ここで見るのは
 * その帰結——道の所要時間が今歩いている人の遅れを継ぐこと、時間が起こす操作にも`agent`が居ること、
 * そして同じ物が2つの操作の`agent`になったらその場で止まること。
 */
describe('操作の関係', () => {
  const worldYaml = `
object_defs:
  world:
    singleton: true
    props:
      minutes_per_tick:
        value: 15
      minute:
        value: 0
        range: {min: 0, max: 60}
        on_max:
          add:
            self:
              minute: -60
              hour: 1
      hour:
        value: 0
        range: {min: 0, max: 24}
      day:
        value: 1
    slots:
      stuff: {}
`;

  function buildWorldSession(extraYaml: string): { codex: WorldCodex; session: WorldSession; world: World } {
    const codex = new WorldCodexYamlLoader()
      .load('world.yaml', worldYaml)
      .load('extra.yaml', extraYaml)
      .load('agent.yaml', AGENT_YAML)
      .buildAndReset();
    const bootstrap = new WorldSession(codex);
    const instance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('world')), bootstrap);
    const world = new World(instance, codex);
    return { codex, session: new WorldSession(codex, world), world };
  }

  /** 世界の直下（`stuff`枠）へ置く。tick操作が配られるのは世界の木に繋がっている物だけ。 */
  function placeInWorld(codex: WorldCodex, world: World, object: WorldObject): WorldObject {
    expect(
      object.moveToSlotOrRejection(world.instance.getSlot(codex.slotNames.getId('stuff'))),
    ).toBeUndefined();
    return object;
  }

  it('道の所要時間は、今歩いている人の遅れを土台にする（11.5節の例）', () => {
    const { codex, session, world } = buildWorldSession(`
object_defs:
  character:
    props:
      travel_delay: {value: 20}
  path:
    props:
      # 道の長さに、今歩いている人の遅れを継ぐ。遅れを持たない者が歩けば60のまま。
      travel_minutes:
        value: 60
        base: {subject: agent, prop: travel_delay}
    interactions:
      travel:
        trigger: menu
        duration: {prop: travel_minutes}
`);
    const path = placeInWorld(codex, world, session.createObject(codex.objectNames.getId('path')));
    const walker = session.createObject(codex.objectNames.getId('character'));

    expect(
      path.tryGetAction('travel', createAgent(session))?.executionMinutes(),
      '遅れを持たない者が歩けば60分',
    ).toBe(60);
    expect(path.tryGetAction('travel', walker)?.executionMinutes(), '歩く人の遅れを継いで80分').toBe(80);

    expect(path.tryGetAction('travel', walker)?.tryExecute()).toBe(true);
    expect(world.minute + world.hour * 60, '見せた分数と、実際に進む分数は同じ').toBe(80);
  });

  it('関係を外した後は、土台も元へ戻る（1つずつ張って外す）', () => {
    const { codex, session, world } = buildWorldSession(`
object_defs:
  character:
    props:
      travel_delay: {value: 20}
  path:
    props:
      travel_minutes:
        value: 60
        base: {subject: agent, prop: travel_delay}
    interactions:
      travel:
        trigger: menu
        duration: {prop: travel_minutes}
`);
    const path = placeInWorld(codex, world, session.createObject(codex.objectNames.getId('path')));
    const walker = session.createObject(codex.objectNames.getId('character'));
    const travelMinutes = () =>
      path.tryGetProperty(codex.propertyNames.getId('travel_minutes'))?.getEffectiveValue();

    expect(travelMinutes(), '関係を張る前').toBe(60);
    path.tryGetAction('travel', walker)?.executionMinutes();
    expect(travelMinutes(), '問い合わせが終われば関係は外れている').toBe(60);
  });

  it('参加者のpropsからpatientも指せる（宣言元がどの役に就くかは静的に決まらない）', () => {
    const { codex, session, world } = buildWorldSession(`
object_defs:
  chisel:
    tags: [chisel]
    props:
      # 刃が食い込むのにかかる時間は、相手の硬さで伸びる。
      bite_minutes:
        value: 5
        base: {subject: patient, prop: hardness}
  block:
    props:
      hardness: {value: 7}
    interactions:
      carve:
        trigger: {drag: {tag: chisel}}
        duration: {subject: instrument, prop: bite_minutes}
`);
    const block = placeInWorld(codex, world, session.createObject(codex.objectNames.getId('block')));
    const chisel = placeInWorld(codex, world, session.createObject(codex.objectNames.getId('chisel')));

    expect(
      block
        .combinationsWith(chisel, createAgent(session))
        .find((c) => c.name === 'carve')
        ?.executionMinutes(),
      'ノミの食い込みが、彫る相手の硬さを土台にする',
    ).toBe(12);
  });

  it('役が宣言元自身へ解決しても、外すときに他の寄与を巻き添えにしない', () => {
    // 自分に対する行動（tickの1手）ではagentが宣言元自身になるので、同じプロパティへ同じ宣言元から
    // 2件登録される。解除を宣言元だけで同定すると、手番のたびに常時の寄与まで消える。
    const { codex, session, world } = buildWorldSession(`
object_defs:
  beast:
    props:
      stamina: {value: 10, range: {min: 0, max: 10}}
    passives:
      - modify: {self: {stamina: -1}}
      - modify: {agent: {stamina: -2}}
    interactions:
      turn:
        trigger: tick
`);
    const beast = placeInWorld(codex, world, session.createObject(codex.objectNames.getId('beast')));
    const stamina = () => beast.tryGetProperty(codex.propertyNames.getId('stamina'))?.getEffectiveValue();

    expect(stamina(), '手番の外ではagent対象は解決しない').toBe(9);
    session.advanceWorldTime(15);
    expect(stamina(), '手番を終えても、常時の寄与は残っている').toBe(9);
  });

  /**
   * 関係の内側で型が変わっても、物が宣言した`passives`のうち役を対象にしたもの（11.5節）は、新しい型の
   * 宣言で張り直される。張り直さないと、**宣言した側が変わったとき**は旧型の宣言のまま相手に残り
   * （関係を抜けるときの解除はそのときのdefのpassivesを辿るので、新しい型からは見つからない）、
   * **寄与を受けている側が変わったとき**は作り直されたプロパティに載らないまま消える。
   */
  describe('関係の内側で型が変わったとき', () => {
    const CLAY = `
traits:
  fired:
    tags: [fired]
  weary:
    tags: [weary]
object_defs:
  hauler:
    props:
      strength: {value: 10, range: {min: 0, max: 10}}
    variation_axes:
      mood: {of: {tag: weary}}
  weary_mood:
    traits: [weary]
  clay:
    passives:
      # 捏ねている間だけ動作主の力を削ぐ（agentを見る）。
      - modify: {agent: {strength: -3}}
    interactions:
      harden:
        trigger: menu
        duration: 30
        become: {state: fired_clay}
    variation_axes:
      state: {of: {tag: fired}}
  fired_clay:
    traits: [fired]
`;

    /** 素焼き前の粘土と、それを捏ねる者。粘土は世界の木に繋いである。 */
    function buildClayWorld(): {
      clay: WorldObject;
      hauler: WorldObject;
      strength: () => number | undefined;
    } {
      const { codex, session, world } = buildWorldSession(CLAY);
      const clay = placeInWorld(codex, world, session.createObject(codex.objectNames.getId('clay')));
      const hauler = session.createObject(codex.objectNames.getId('hauler'));
      return {
        clay,
        hauler,
        strength: () => hauler.tryGetProperty(codex.propertyNames.getId('strength'))?.getEffectiveValue(),
      };
    }

    it('宣言した側が変わっても、寄与は新しい型のものへ張り替わる', () => {
      const { clay, hauler, strength } = buildClayWorld();

      new InteractionRelation(clay, hauler, undefined).during(() => {
        expect(strength(), '関係を張れば効いている').toBe(7);

        clay.becomeAlong(new Map([['state', 'fired_clay']]));

        expect(strength(), '同じ宣言を持つ型になったので、効き目は変わらない').toBe(7);
      });

      expect(strength(), '関係を抜ければ、旧型で張った寄与も残らない').toBe(10);
    });

    it('寄与を受けている側が変わっても、寄与は作り直されたプロパティへ載り直す', () => {
      const { clay, hauler, strength } = buildClayWorld();

      new InteractionRelation(clay, hauler, undefined).during(() => {
        hauler.becomeAlong(new Map([['mood', 'weary_mood']]));

        expect(strength(), '値と同じく、寄与も新しいプロパティへ移る').toBe(7);
      });

      expect(strength(), '関係を抜ければ外れる').toBe(10);
    });

    it('becomeを効果に持つ操作を通しても残らない', () => {
      const { clay, hauler, strength } = buildClayWorld();

      expect(clay.tryGetAction('harden', hauler)?.tryExecute()).toBe(true);

      expect(clay.def.name, '素焼きの変種になっている').not.toBe('clay');
      expect(strength(), '操作を終えれば、削がれた力は戻る').toBe(10);
    });
  });

  it('ゲートの役は、辺の子側ではなく宣言元から解ける（child対象と併せて書いたとき）', () => {
    // ゲートのselfは辺の子側（child対象なら子）だが、役を指せるのは参加者からだけで、ここでの
    // 参加者は宣言を持つ側（11.5節）。まとめて子から引くと、宣言元が操作に参加していても解決しない。
    const { codex, session, world } = buildWorldSession(`
object_defs:
  hauler:
    props:
      strength: {value: 5}
  crate:
    slots:
      contents: {}
    passives:
      # 担ぎ手が居る間だけ、中身が擦れて減る。宣言は箱にあり、辺の子側は中身。
      - conditions: [{subject: agent, prop: strength, gt: 0}]
        add: {child: {wear: 1}}
    interactions:
      lift:
        trigger: menu
        duration: 15
  stone:
    props:
      wear: {value: 0, range: {min: 0, max: 100}}
`);
    const crate = placeInWorld(codex, world, session.createObject(codex.objectNames.getId('crate')));
    const stone = session.createObject(codex.objectNames.getId('stone'));
    const hauler = session.createObject(codex.objectNames.getId('hauler'));
    expect(stone.moveToSlotOrRejection(crate.getSlot(codex.slotNames.getId('contents')))).toBeUndefined();

    const wear = () => stone.tryGetProperty(codex.propertyNames.getId('wear'))?.number;

    session.advanceWorldTime(15);
    expect(wear(), '誰も担いでいない1tickでは、agentが解決しないのでゲートは閉じている').toBe(0);

    // 持ち上げの15分（＝1tick）は関係を張ったまま進む。石（辺の子側）は参加していないので、
    // 役を子から引くとここでもゲートが開かない。
    expect(crate.tryGetAction('lift', hauler)?.tryExecute()).toBe(true);
    expect(wear(), '宣言元（箱）が参加していれば、担ぎ手をagentとしてゲートが開く').toBe(1);
  });

  it('trigger: tick の操作にもagentが居て、それは自分自身', () => {
    const { codex, session, world } = buildWorldSession(`
object_defs:
  beast:
    props:
      steps: {value: 0}
    interactions:
      turn:
        trigger: tick
        add: {agent: {steps: 1}}
`);
    const beast = placeInWorld(codex, world, session.createObject(codex.objectNames.getId('beast')));

    session.advanceWorldTime(15);

    expect(
      beast.tryGetProperty(codex.propertyNames.getId('steps'))?.number,
      '時間が配るのは手番で、動くのはその物自身',
    ).toBe(1);
  });

  it('同じ物が2つの操作のagentになったら、その場で止まる', () => {
    // 30分かけて眠る間にtickが回り、同じ個体の手番が始まる。中断の仕組みはまだ無い（17節）。
    const { codex, session, world } = buildWorldSession(`
object_defs:
  restless_beast:
    props:
      steps: {value: 0}
    interactions:
      sleep:
        trigger: menu
        duration: 30
      turn:
        trigger: tick
        add: {agent: {steps: 1}}
`);
    const beast = placeInWorld(codex, world, session.createObject(codex.objectNames.getId('restless_beast')));

    expect(() => beast.tryGetAction('sleep', beast)?.tryExecute()).toThrowError(/2つの操作のagent/);
  });

  it('押す前の問い合わせは、実行中の操作の傍らでも止まらない（数えるのは張られている関係）', () => {
    const { codex, session, world } = buildWorldSession(`
object_defs:
  walker:
    interactions:
      rest:
        trigger: menu
  path:
    interactions:
      travel:
        trigger: menu
        duration: 30
`);
    const path = placeInWorld(codex, world, session.createObject(codex.objectNames.getId('path')));
    const walker = placeInWorld(codex, world, session.createObject(codex.objectNames.getId('walker')));

    const travel = path.tryGetAction('travel', walker)!;
    let restMinutesDuringTravel: number | undefined;
    let executed = false;
    session.observeTicks(
      () => {
        restMinutesDuringTravel = walker.tryGetAction('rest', walker)?.executionMinutes();
      },
      () => {
        executed = travel.tryExecute();
      },
    );

    expect(executed).toBe(true);
    expect(restMinutesDuringTravel, '移動中に別の候補の分数を引いても、それは動作ではない').toBe(0);
  });

  /**
   * 枠へ入れる操作（`put_in`、7.10節）も11.5節の表に並ぶ操作の1つ。**時間の経過も入れることそのものも
   * 同じ関係の内側**で、`interactions`と挙動が分かれない（slotEntry.putIntoSlot）。
   */
  describe('枠へ入れる操作', () => {
    /** 30分（＝2 tick）かけて入る枠を持つ箱と、それを運ぶ者・入れる物を世界へ置く。 */
    function buildPutInWorld(extraYaml: string) {
      const built = buildWorldSession(extraYaml);
      const { codex, session, world } = built;
      const crate = placeInWorld(codex, world, session.createObject(codex.objectNames.getId('crate')));
      const stone = placeInWorld(codex, world, session.createObject(codex.objectNames.getId('stone')));
      const hauler = placeInWorld(codex, world, session.createObject(codex.objectNames.getId('hauler')));
      const slot = crate.getSlot(codex.slotNames.getId('contents'));
      const put = (): void => {
        putIntoSlot(stone, slot, hauler, session, () => {
          expect(stone.moveToSlotOrRejection(slot)).toBeUndefined();
        });
      };
      return { ...built, crate, stone, hauler, put };
    }

    it('入れている間の tick でも、参加者のpropsから3役とも解ける', () => {
      // 入れている30分のあいだ、参加者はそれぞれ自分以外の役を見て数える。関係を張らずに時間を
      // 進めると、どの役も解決先を持たないままtickだけが過ぎる。
      const { codex, session, crate, stone, hauler, put } = buildPutInWorld(`
object_defs:
  hauler:
    props:
      strength: {value: 5}
      # 運んでいる物の重さで疲れる（instrumentを見る）。
      fatigue: {value: 0, range: {min: 0, max: 100}}
    passives:
      - conditions: [{subject: instrument, prop: weight, gt: 0}]
        add: {self: {fatigue: 1}}
  crate:
    props:
      hardness: {value: 7}
      # 入れている者が居る間だけ埃が立つ（agentを見る）。
      dust: {value: 0, range: {min: 0, max: 100}}
    passives:
      - conditions: [{subject: agent, prop: strength, gt: 0}]
        add: {self: {dust: 1}}
    slots:
      contents:
        put_in: {duration: 30}
  stone:
    props:
      weight: {value: 3}
      # 入れられる先の硬さで擦れる（patientを見る）。
      scuff: {value: 0, range: {min: 0, max: 100}}
    passives:
      - conditions: [{subject: patient, prop: hardness, gt: 0}]
        add: {self: {scuff: 1}}
`);
      const counted = () => ({
        dust: crate.tryGetProperty(codex.propertyNames.getId('dust'))?.number,
        scuff: stone.tryGetProperty(codex.propertyNames.getId('scuff'))?.number,
        fatigue: hauler.tryGetProperty(codex.propertyNames.getId('fatigue'))?.number,
      });

      session.advanceWorldTime(15);
      expect(counted(), '入れる前の1 tickでは、どの役も解決しない').toEqual({
        dust: 0,
        scuff: 0,
        fatigue: 0,
      });

      put();

      expect(stone.parent, '入れ終えている').toBe(crate);
      expect(counted(), '30分＝2 tickぶん、3役とも解ける').toEqual({ dust: 2, scuff: 2, fatigue: 2 });

      session.advanceWorldTime(15);
      expect(counted(), '入れ終えれば関係は外れている').toEqual({ dust: 2, scuff: 2, fatigue: 2 });
    });

    it('入れている間に配られた、時間を要する手番は、入れ終えた切れ目で起きる', () => {
      // プレイヤーの限界（collapse・fall_asleep・despair、player_character.yaml）と同じ形の手番。
      // **クレームの外側で切れ目を閉じる**ので、入れている者を動作主とする手番でも排他に触れない。
      const { codex, world, hauler, stone, crate, put } = buildPutInWorld(`
object_defs:
  hauler:
    props:
      stamina: {value: 0}
    interactions:
      collapse:
        trigger: tick
        conditions:
          - {prop: stamina, lte: 0}
        duration: 120
        add: {self: {stamina: 20}}
  crate:
    slots:
      contents:
        put_in: {duration: 30}
  stone:
    props:
      weight: {value: 3}
`);

      put();

      expect(stone.parent, '入れ終えている').toBe(crate);
      expect(
        hauler.tryGetProperty(codex.propertyNames.getId('stamina'))?.number,
        '待たされた手番も起きている',
      ).toBe(20);
      expect(world.minute + world.hour * 60, '入れる30分の後に、手番の120分が続く').toBe(150);
    });

    it('入れている間に、入れている者が世界から失われたら入らない', () => {
      // 関与オブジェクトが1つでも失われたら打ち切る（ActionSystem.md 6.1節）。動作主も関与の1つで、
      // actions/combinationsが見ているのと同じ顔ぶれ。
      const { world, hauler, stone, crate, put } = buildPutInWorld(`
object_defs:
  hauler:
    props:
      water:
        value: 1
        range: {min: 0, max: 10}
        on_min:
          destroy: {subject: self, reason: dehydrated}
    passives:
      - add: {self: {water: -1}}
  crate:
    slots:
      contents:
        put_in: {duration: 30}
  stone:
    props:
      weight: {value: 3}
`);

      put();

      expect(hauler.parent, '入れ終える前に尽きる').toBeUndefined();
      expect(stone.parent, '入れる側が居なくなったので入らない').not.toBe(crate);
      expect(world.minute + world.hour * 60, '時間だけは経過している').toBe(30);
    });

    it('入れている間、入れている者は別の操作のagentになれない', () => {
      // 30分かけて入れる間にtickが回り、同じ個体の手番が始まる（眠るのと同じ形、11.5節の不変条件）。
      const { codex, hauler, put } = buildPutInWorld(`
object_defs:
  hauler:
    props:
      steps: {value: 0}
    interactions:
      turn:
        trigger: tick
        add: {agent: {steps: 1}}
  crate:
    slots:
      contents:
        put_in: {duration: 30}
  stone:
    props:
      weight: {value: 3}
`);

      expect(put).toThrowError(/2つの操作のagent/);
      expect(
        hauler.tryGetProperty(codex.propertyNames.getId('steps'))?.number,
        '止まるので手番も起きない',
      ).toBe(0);
    });
  });
});
