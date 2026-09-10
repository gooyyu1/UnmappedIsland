import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { makeBrightEnoughForAnyAction } from '../support/illumination';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';

/**
 * 限界に達した値が起こす、強制的な時間経過（docs/world/Characters.md 限界節）を、実ファイルの
 * 定義だけで検証する。
 *
 * **時間を進める操作の最中に限界へ達するところを通す。** 道を歩く60分のあいだに手番が配られ、
 * それが操作の切れ目まで待たされる、というのが仕組みの要（GameElementDefinition.md 11.5節）で、
 * 値を0に置いて眺めるだけでは1つも動かない。
 */
describe('限界に達した値が起こす、強制的な時間経過', () => {
  /** 道1本を歩く時間（locations.yamlのtravel_minutes。空身なので遅れは足されない）。 */
  const TRAVEL_MINUTES = 60;

  /**
   * 3つの限界。**違うのは見る値・長さ・戻る量だけ**なので、同じ表に並ぶ（player_character.yaml）。
   *
   * `after` は強制の時間が過ぎ切った時点の値。戻しはtick毎なので、**強制の間の減りを引いた正味**に
   * なる——空身で痛みも無いこの状態で減るのは眠気だけ（-1/tick）で、眠り込みの +3/tick は差し引き
   * +2/tick、6時間で +48 になる。
   */
  const LIMITS = [
    { prop: 'stamina', turn: 'collapse', minutes: 120, after: 20, announces: 'exhausted' },
    { prop: 'wakefulness', turn: 'fall_asleep', minutes: 360, after: 48, announces: 'dozed_off' },
    { prop: 'happiness', turn: 'despair', minutes: 120, after: 20, announces: 'disheartened' },
  ] as const;

  let codex: WorldCodex;
  let session: WorldSession;
  let world: WorldObject;
  let jungle: WorldObject;
  let grassland: WorldObject;
  let player: WorldObject;

  beforeAll(() => {
    codex = bundledCodex();
  });

  beforeEach(() => {
    open();
  });

  /** 道1本で繋いだ2つの土地と、密林に立つプレイヤー。 */
  function open(): void {
    session = new WorldSession(codex);
    world = new WorldObject(0, codex.objects.get(codex.objectNames.getId('world')), session);
    session.adoptWorld(new World(world, codex));
    jungle = spawnInto('jungle', world, 'locations');
    grassland = spawnInto('grassland', world, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, jungle, 'characters');
    // 道は暗ければ歩けない（IlluminationSystem.md 5節）。見たいのは限界の側なので、時刻や光源を
    // 組み立てずに作業者の側で明るさを満たす。
    makeBrightEnoughForAnyAction(player, codex);

    const path = spawnInto('path', jungle, 'fixtures');
    path
      .getProperty(codex.propertyNames.getId('destination_id'))
      .setNumberWithoutEvents(grassland.instanceId);
  }

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  function valueOf(propertyName: string): number {
    return player.getProperty(codex.propertyNames.getId(propertyName)).number;
  }

  function drain(propertyName: string): void {
    player.getProperty(codex.propertyNames.getId(propertyName)).setNumber(0);
  }

  /** 密林から草原へ歩く。戻り値は、その1回で実際に過ぎたゲーム内時間（分）。 */
  function travel(): number {
    const before = session.world!.totalMinutes;
    const path = jungle.getSlot(codex.slotNames.getId('fixtures')).contents[0];
    expect(path.tryGetAction('travel', player)?.tryExecute()).toBe(true);
    return session.world!.totalMinutes - before;
  }

  it.each(LIMITS)(
    '$prop が尽きると、$turn で $minutes 分が強制的に過ぎ、その間に戻る',
    ({ prop, minutes, after }) => {
      drain(prop);

      expect(travel(), '歩いた分に、強制の時間が続く').toBe(TRAVEL_MINUTES + minutes);
      expect(valueOf(prop)).toBe(after);
    },
  );

  /** bodyの実行中に告げられた出来事を、bodyを始めてから何分の時点で告げられたかと一緒に集める。 */
  function announcementsDuring(body: () => void): ReadonlyArray<{ name: string; after: number }> {
    const startedAt = session.world!.totalMinutes;
    const heard: { name: string; after: number }[] = [];
    session.observeSignals((signal) => {
      expect(signal.object, '告げる先はプレイヤーの札').toBe(player);
      heard.push({ name: signal.name, after: session.world!.totalMinutes - startedAt });
    }, body);
    return heard;
  }

  it.each(LIMITS)('$turn は、強制の $minutes 分が過ぎる前に $announces を告げる', ({ prop, announces }) => {
    // 過ぎ切ってから告げる効果（signal）では、飛んだ理由を最大6時間あとに言うことになる。
    drain(prop);

    // 歩き終わった時点＝強制の時間がまだ1分も過ぎていない時点で告げる。
    expect(announcementsDuring(travel)).toEqual([{ name: announces, after: TRAVEL_MINUTES }]);
  });

  it('限界に居ない間は、何も告げない', () => {
    expect(announcementsDuring(travel)).toEqual([]);
  });

  it('切れ目までに限界を抜けていれば、告げもしない', () => {
    // 待たせた手番は要件を引き直して落ちる。告げるのはその後なので、落ちた手番は何も言わない。
    drain('stamina');

    expect(announcementsDuring(() => player.tryGetAction('wait', player)?.tryExecute())).toEqual([]);
  });

  it('進行中の操作は中断しない——歩き終わってから倒れる', () => {
    // 中断しないという答え（GameElementDefinition.md 11.5節）が、行き先に着いていることに出る。
    drain('stamina');

    travel();

    expect(player.parent).toBe(grassland);
  });

  it('待たせた手番が起きるのは、操作の効果を適用し終えてから', () => {
    // 操作をまるごと囲わないと、内側の時間経過（WorldSession.advanceWorldTime）自身の切れ目が深さ0で
    // 開き、効果を適用する前に手番が走る。**倒れるのが歩いている本人なら例外で止まる**（まだ外れて
    // いないクレームへ同じagentの再クレームが走る、11.5節）が、動作主が別なら誰も止めないまま順序
    // だけが崩れるので、そちらで見る——歩き手が着く前に、留守番が倒れることになる。
    const camp = spawnInto('grassland', world, 'locations');
    const companion = spawnInto(SAMPLE_CHARACTER, camp, 'characters');
    companion.getProperty(codex.propertyNames.getId('stamina')).setNumber(0);

    let walkerStandingAt: WorldObject | undefined;
    session.observeSignals((signal) => {
      expect(signal.object, '倒れるのは留守番のほう').toBe(companion);
      walkerStandingAt = player.parent;
    }, travel);

    expect(walkerStandingAt, '留守番が倒れるのは、歩き手が草原へ着いた後').toBe(grassland);
  });

  it('切れ目までに限界を抜けていれば、待たせた手番は起きない', () => {
    // 待たせた手番の要件は切れ目で引き直される。待機は15分で体力を+2戻すので、切れ目に着いた
    // 時点では下限に居ない。
    drain('stamina');
    const before = session.world!.totalMinutes;

    expect(player.tryGetAction('wait', player)?.tryExecute()).toBe(true);

    expect(session.world!.totalMinutes - before, '待機の15分だけ').toBe(15);
    expect(valueOf('stamina')).toBe(2);
  });

  it('2つ同時に尽きれば、同じ切れ目で続けて起きる', () => {
    drain('stamina');
    drain('happiness');

    expect(travel()).toBe(TRAVEL_MINUTES + 120 + 120);
    expect(valueOf('stamina')).toBe(20);
    expect(valueOf('happiness')).toBe(20);
  });

  it('強制の最中に別の限界へ落ちても、同じ切れ目では続けない', () => {
    // 強制の時間経過そのものが時間を進めるので、その最中にまた手番が挙がりうる。ここで受け取ると
    // 切れ目から抜けられないので、次に時間が動いたときの待ちとして拾い直す。
    //
    // 眠気は歩く4 tickでは尽きず（5→1）、倒れ込む8 tickの途中で尽きる。
    drain('stamina');
    player.getProperty(codex.propertyNames.getId('wakefulness')).setNumber(5);

    expect(travel(), '倒れ込む120分だけで、眠り込む360分は続かない').toBe(TRAVEL_MINUTES + 120);
    expect(valueOf('wakefulness'), '眠気は尽きたまま').toBe(0);

    expect(travel(), '次に時間が動いたときに眠り込む').toBe(TRAVEL_MINUTES + 360);
  });

  it('戻り切らずにまた尽きれば、次に時間が動いたときにまた起きる', () => {
    drain('happiness');
    expect(travel()).toBe(TRAVEL_MINUTES + 120);

    drain('happiness');
    expect(travel(), '一度きりではない').toBe(TRAVEL_MINUTES + 120);
  });

  it('限界に居ない間は、何も起きない', () => {
    // 見張りが常に強制していないことの裏取り。満タンのまま歩けば、歩いた分しか過ぎない。
    expect(travel()).toBe(TRAVEL_MINUTES);
  });

  /**
   * 限界の戻りは、**強制の間の減りを引いた正味**になる（issue #1548）。戻しを経過し終えてから
   * 足していたころは、下限に張り付いた値の減りを既定のクランプが吸い、宣言した量がまるごと残って
   * いた——荷を担いだまま倒れ込むほうが、同じ時間を休むより得だった。
   */
  describe('強制の間の減りは、戻しから引かれる', () => {
    /** 丸太2本（20,000g×2）。医師の too_heavy（27,500g）を越えるので、体力が-2/tickで削られる。 */
    function carryTooMuch(): void {
      spawnInto('log', player, 'hand');
      spawnInto('log', player, 'hand');
      expect(player.getProperty(codex.propertyNames.getId('load')).isInStage('too_heavy')).toBe(true);
    }

    /** 押して休む（自発の休息）。 */
    function rest(): void {
      expect(player.tryGetAction('rest', player)?.tryExecute()).toBe(true);
    }

    it('too_heavy を担いだまま倒れ込んでも、同じ2時間を rest で休むより得にならない', () => {
      carryTooMuch();

      // 自発の休息は、休んでいる間も荷が削るので、2時間で戻るのは宣言（+2.5/tick）から荷の削り
      // （-2/tick）を引いたぶん。
      player.getProperty(codex.propertyNames.getId('stamina')).setNumber(50);
      const beforeResting = valueOf('stamina');
      rest();
      rest();
      const byResting = valueOf('stamina') - beforeResting;
      expect(byResting, '2時間の休憩で戻る量').toBe(4);

      // 倒れ込みも同じ形。時間だけを進めれば、その切れ目で手番が起きる。
      drain('stamina');
      session.advanceWorldTime(15);

      expect(valueOf('stamina'), '倒れ込みで戻る量').toBe(byResting);
    });

    it('痛みが深いほど、打ちひしがれても戻らない', () => {
      // 骨折は1枚で痛みを危険域（unbearable）へ届かせ、幸福度を-0.5/tickで削る（injuries.yaml）。
      spawnInto('fracture', player, 'injuries');
      expect(player.getProperty(codex.propertyNames.getId('pain')).isInStage('unbearable')).toBe(true);

      drain('happiness');
      session.advanceWorldTime(15);

      // 宣言（+2.5/tick）から痛みの削り（-0.5/tick）を引いた +2/tick が、2時間ぶん。
      expect(valueOf('happiness'), '痛みの無いときの +20 より薄い').toBe(16);
    });

    /**
     * 画面に出る回復の粒（`WorldSession.observeGains`、docs/ui/CardInteraction.md 10.1節）が示すのは、
     * その操作がそのtickで実際に動かした量。宣言した量をそのまま出すと、荷を担いだまま倒れ込んだ
     * プレイヤーは +20 の粒を見ながら +4 しか戻っていない。
     */
    describe('粒が示す量も、同じ正味', () => {
      /** bodyの間にプレイヤーの値が増えた量を、プロパティ名から引ける形にする。 */
      function gainsDuring(body: () => void): Map<string, number> {
        const amounts = new Map<string, number>();
        session.observeGains((observed) => {
          for (const gain of observed.gains)
            if (gain.object === player) amounts.set(gain.property.name, gain.amount);
        }, body);
        return amounts;
      }

      it('荷が削っている間の倒れ込みは、引いたぶんの粒を出す', () => {
        carryTooMuch();
        drain('stamina');

        const amounts = gainsDuring(() => session.advanceWorldTime(15));

        expect(valueOf('stamina'), '倒れ込みで実際に戻った量').toBe(4);
        expect(amounts.get('stamina'), '粒もその量').toBe(4);
      });

      it('荷が削っている間の休息は、引いたぶんの粒を出す', () => {
        carryTooMuch();
        player.getProperty(codex.propertyNames.getId('stamina')).setNumber(50);

        const amounts = gainsDuring(rest);

        expect(valueOf('stamina') - 50, '1時間の休憩で実際に戻った量').toBe(2);
        expect(amounts.get('stamina'), '粒もその量').toBe(2);
      });

      /** 幸福度を削る側（player_character.yaml）。ここで使う危険域の段は、どれも-0.5/tick。 */
      const HAPPINESS_DRAINS = [
        { name: '痛み', deepen: (): void => void spawnInto('fracture', player, 'injuries') },
        {
          name: '里心',
          deepen: (): void => player.getProperty(codex.propertyNames.getId('homesickness')).setNumber(100),
        },
      ] as const;

      it.each(HAPPINESS_DRAINS)(
        '$name が削っている間の打ちひしがれは、引いたぶんの粒を出す',
        ({ deepen }) => {
          deepen();
          drain('happiness');

          const amounts = gainsDuring(() => session.advanceWorldTime(15));

          expect(valueOf('happiness'), '打ちひしがれで実際に戻った量').toBe(16);
          expect(amounts.get('happiness'), '粒もその量').toBe(16);
        },
      );

      it('削っているのが自分自身でも同じ——眠り込みの粒は、眠気の減りを引いた量', () => {
        // 眠気は誰にも担がれず、自分で-1/tick減り続ける（player_character.yaml）。眠り込みの
        // +3/tick から引いた +2/tick が、6時間ぶん。
        drain('wakefulness');

        const amounts = gainsDuring(() => session.advanceWorldTime(15));

        expect(valueOf('wakefulness'), '眠り込みで実際に戻った量').toBe(48);
        expect(amounts.get('wakefulness'), '粒もその量').toBe(48);
      });
    });
  });
});
