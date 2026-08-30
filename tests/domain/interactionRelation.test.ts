import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

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
      # 道の長さに、今歩いている人の遅れを継ぐ。誰も歩いていなければ60のまま。
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

    expect(path.tryGetAction('travel', undefined)?.executionMinutes(), '誰も歩いていなければ60分').toBe(60);
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
        .combinationsWith(chisel, undefined)
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
});
