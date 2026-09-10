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
  weary:
    tags: [weary]
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
  # 焼いている者（agent）を温める窯。宣言元ではなく相手のプロパティへ登録が載る。
  kiln:
    interactions:
      bake:
        trigger: menu
        duration: 30
        passives:
          - add: {agent: {heat: 1}}
  # 焼いている間に自分の手番で型が変わる窯。手番は時間を要さないので、bakeの関係の内側で起きる。
  shifting_kiln:
    props:
      heat: {value: 0}
    interactions:
      bake:
        trigger: menu
        duration: 30
        passives:
          - add: {agent: {heat: 1}}
      settle:
        trigger: tick
        become: {state: fired_clay}
    variation_axes:
      state: {of: {tag: fired}}
  baker:
    props:
      heat: {value: 0}
  # 焼いている途中で自分の型が変わる者。
  potter:
    props:
      progress: {value: 0, range: {min: 0, max: 1}, on_max: {become: {mood: weary_mood}}}
      heat: {value: 0}
    passives:
      - add: {self: {progress: 1}}
    variation_axes:
      mood: {of: {tag: weary}}
  weary_mood:
    traits: [weary]
`;

  /** 世界を1つ組み、その`stuff`枠へ型を置ける場面。tickが回るのは世界の木に繋がっている物だけ。 */
  function buildWorld(): {
    codex: WorldCodex;
    session: WorldSession;
    place: (objectName: string) => WorldObject;
    heat: (object: WorldObject) => number | undefined;
  } {
    const codex = new WorldCodexYamlLoader()
      .load('clay.yaml', YAML)
      .load('agent.yaml', AGENT_YAML)
      .buildAndReset();
    const bootstrap = new WorldSession(codex);
    const instance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('world')), bootstrap);
    const world = new World(instance, codex);
    const session = new WorldSession(codex, world);

    return {
      codex,
      session,
      place: (objectName) => {
        const object = session.createObject(codex.objectNames.getId(objectName));
        expect(
          object.moveToSlotOrRejection(instance.getSlot(codex.slotNames.getId('stuff'))),
        ).toBeUndefined();
        return object;
      },
      heat: (object) => object.tryGetProperty(codex.propertyNames.getId('heat'))?.number,
    };
  }

  it('経過の間、宣言元へ毎tick積まれ、終われば外れる', () => {
    const { session, place, heat } = buildWorld();
    const sand = place('sand');

    expect(sand.tryGetAction('harden', createAgent(session))?.tryExecute()).toBe(true);
    expect(heat(sand), '30分＝2 tickぶん').toBe(2);

    session.advanceWorldTime(60);
    expect(heat(sand), '経過を終えれば外れるので、その後の時間では積まれない').toBe(2);
  });

  /**
   * 積まれるのが`sand`より1 tick少ないのは、**becomeを起こしたtickのぶんが落ちるため**——積分は
   * 差し替え前のプロパティの配列を回り続けるので、宣言順で`become`より後ろにある`heat`は、新しい
   * プロパティのほうが積分されないまま次のtickへ行く。ここで見るのは載り直したかどうかで、そちらは別。
   */
  describe('経過の途中でbecomeしても、作り直されたプロパティへ載り直す', () => {
    it('変わったのが宣言元（selfを対象にした宣言）', () => {
      const { session, place, heat } = buildWorld();
      const clay = place('clay');

      expect(clay.tryGetAction('harden', createAgent(session))?.tryExecute()).toBe(true);

      expect(clay.def.name, '1 tick目の途中で素焼きへ変わっている').not.toBe('clay');
      expect(heat(clay), '残りの1 tickぶんが、新しいプロパティへ積まれている').toBe(1);

      session.advanceWorldTime(60);
      expect(heat(clay), '新しいプロパティからも、経過の終わりに外れている').toBe(1);
    });

    it('変わったのが対象の側（役を対象にした宣言）', () => {
      const { session, place, heat } = buildWorld();
      const kiln = place('kiln');
      const potter = place('potter');

      expect(kiln.tryGetAction('bake', potter)?.tryExecute()).toBe(true);

      expect(potter.def.name, '1 tick目の途中で型が変わっている').not.toBe('potter');
      expect(heat(potter), '宣言元は変わっていないが、載る先が作り直されている').toBe(1);

      session.advanceWorldTime(60);
      expect(heat(potter), '新しいプロパティからも、経過の終わりに外れている').toBe(1);
    });

    /**
     * 宣言元が**入れ子の関係の内側で**変わっても、載る先は外側の関係の役から解ける（11.5節）。
     * 内側の関係で解き直すと、agentを宣言元自身へ向けた登録が残り、経過が終わっても誰も外せない。
     */
    it('変わったのが宣言元で、それが入れ子の関係の内側だったとき', () => {
      const { session, place, heat } = buildWorld();
      const kiln = place('shifting_kiln');
      const baker = place('baker');

      expect(kiln.tryGetAction('bake', baker)?.tryExecute()).toBe(true);

      expect(kiln.def.name, '経過中の手番で型が変わっている').not.toBe('shifting_kiln');
      expect(heat(baker), '焼いている者が温まる').toBe(2);
      expect(heat(kiln), '窯自身は温まらない（agentは窯ではない）').toBe(0);

      session.advanceWorldTime(60);
      expect(heat(kiln), '経過を終えた後も、窯へ載った登録は残っていない').toBe(0);
    });
  });
});
