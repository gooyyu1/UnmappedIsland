import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { AGENT_YAML, createAgent } from '../support/agent';

/**
 * 操作が宣言した持続効果（GameElementDefinition.md 11.7節）が効いている間の振る舞い。書けない宣言を
 * 落とす門は`tests/loader/interactionPassives.test.ts`が持つので、ここは登録が実際に載る/外れることを見る。
 *
 * **物の宣言と違い、この登録を辿れるのはセッションだけ**（宣言しているのは操作で、物のdefには居ない）
 * ので、宣言元の型が経過の途中で変わったときに載り直せるかが要点になる。
 */
describe('操作が宣言した持続効果（11.7節）', () => {
  const YAML = `
traits:
  fired:
    tags: [fired]
object_defs:
  world:
    singleton: true
    props:
      minutes_per_tick: {value: 15}
      minute: {value: 0, range: {min: 0, max: 60}, on_max: {add: {self: {minute: -60, hour: 1}}}}
      hour: {value: 0, range: {min: 0, max: 24}}
      day: {value: 1}
    slots:
      stuff: {}
  # 経過の途中で型が変わらない粘土。積まれる量の基準。
  sand:
    props:
      heat: {value: 0}
    interactions:
      harden:
        trigger: menu
        duration: 30
        passives:
          - add: {self: {heat: 1}}
  clay:
    props:
      # 1 tickで上限へ届き、そこで型が変わる（経過の途中でbecomeを起こす仕掛け）。
      progress: {value: 0, range: {min: 0, max: 1}, on_max: {become: {state: fired_clay}}}
      heat: {value: 0}
    passives:
      - add: {self: {progress: 1}}
    interactions:
      harden:
        trigger: menu
        duration: 30
        passives:
          - add: {self: {heat: 1}}
    variation_axes:
      state: {of: {tag: fired}}
  fired_clay:
    traits: [fired]
`;

  /** 世界の`stuff`枠へその型を1つ置いた場面。tickが回るのは世界の木に繋がっている物だけ。 */
  function place(objectName: string): {
    codex: WorldCodex;
    session: WorldSession;
    object: WorldObject;
    heat: () => number | undefined;
  } {
    const codex = new WorldCodexYamlLoader()
      .load('clay.yaml', YAML)
      .load('agent.yaml', AGENT_YAML)
      .buildAndReset();
    const bootstrap = new WorldSession(codex);
    const instance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('world')), bootstrap);
    const world = new World(instance, codex);
    const session = new WorldSession(codex, world);

    const object = session.createObject(codex.objectNames.getId(objectName));
    expect(object.moveToSlotOrRejection(instance.getSlot(codex.slotNames.getId('stuff')))).toBeUndefined();
    return {
      codex,
      session,
      object,
      heat: () => object.tryGetProperty(codex.propertyNames.getId('heat'))?.number,
    };
  }

  it('経過の間、宣言元へ毎tick積まれ、終われば外れる', () => {
    const { session, object, heat } = place('sand');

    expect(object.tryGetAction('harden', createAgent(session))?.tryExecute()).toBe(true);
    expect(heat(), '30分＝2 tickぶん').toBe(2);

    session.advanceWorldTime(60);
    expect(heat(), '経過を終えれば外れるので、その後の時間では積まれない').toBe(2);
  });

  it('経過の途中で宣言元がbecomeしても、作り直されたプロパティへ載り直す', () => {
    const { session, object, heat } = place('clay');

    expect(object.tryGetAction('harden', createAgent(session))?.tryExecute()).toBe(true);

    expect(object.def.name, '1 tick目の途中で素焼きへ変わっている').not.toBe('clay');
    // 型が変わったtickのぶんは入らない——becomeが作り直したプロパティは、そのtickの積分をもう済ませた
    // 古いプロパティの代わりに置かれるので、次のtickから積まれる。
    expect(heat(), '残りの1 tickぶんが、新しいプロパティへ積まれている').toBe(1);

    session.advanceWorldTime(60);
    expect(heat(), '新しいプロパティからも、経過の終わりに外れている').toBe(1);
  });
});
