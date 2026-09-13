import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { characterDefNames } from '../../src/domain/generation/NewGame';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction } from '../support/illumination';
import type { PropertyGlobalId } from '../../src/domain/GlobalId';

/**
 * bedding.yamlの寝床とハンモックを、実ファイルの定義だけで検証する。
 *
 * 見たいのは、**差した部品が回復量を動かすこと**（docs/world/Bedding.md 4節。段ごとのブロックが
 * 重なる形）と、**その差が頭打ちに呑まれずに観測できること**（同節。一晩ぶんが体力の上限を下回る
 * 位置に置いてある）、**支点を持たない土地ではハンモックを吊れないこと**（同6.1節）、それに
 * **吊ったハンモックを畳んで次の土地へ持ち出せること**（同6.2節）。
 *
 * **部品を差す前後を同じ物差しで測る。** 差しても量が動かない書き方——上積みのブロックを落とす・
 * ゲートが枠の中身を見ない——なら、2つの数が並ぶ。
 */

// describe.eachへ渡すため、beforeAllを待たずに読み込み時から引ける形で持つ（組み上げは使い回される）。
const characters = characterDefNames(bundledCodex());

describe('bedding.yamlの寝床とハンモック', () => {
  let codex: WorldCodex;
  let staminaId: PropertyGlobalId;
  let wakefulnessId: PropertyGlobalId;

  /** 1日のtick数（1 tick = 15分）。 */
  const TICKS_PER_DAY = 96;

  beforeAll(() => {
    codex = bundledCodex();
    staminaId = codex.propertyNames.getId('stamina');
    wakefulnessId = codex.propertyNames.getId('wakefulness');
  });

  /** その土地にプレイヤーが立っている世界。 */
  function open(landName: string, characterName: string = SAMPLE_CHARACTER) {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    const session = new WorldSession(codex, new World(worldInstance, codex));
    const land = spawnInto(session, landName, worldInstance, 'locations');
    const player = spawnInto(session, characterName, land, 'characters');
    makeBrightEnoughForAnyAction(player, codex);
    return { session, world: worldInstance, land, player };
  }

  function spawnInto(
    session: WorldSession,
    objectName: string,
    parent: WorldObject,
    slotName: string,
  ): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  /**
   * その寝床でその休息を1回取ったときに、実際に戻った体力と眠気。
   *
   * **空身・無痛の個体で測る**ので、受け取る量は宣言そのまま（charactersYaml.test.tsのtakeRestと
   * 同じ足場）。眠気だけは誰も担がなくても-1/tickで減るので、経過ぶんを差し引く。頭打ちに掛からない
   * よう、体力は空から、眠気は経過ぶん＋1だけ残した位置から始める。
   */
  function restOn(
    bed: WorldObject,
    player: WorldObject,
    actionName: string,
  ): { stamina: number; wakefulness: number } {
    const SPARE = 1;
    const action = () => bed.tryGetAction(actionName, player);
    const spent = (action()?.executionMinutes() ?? 0) / 15;

    player.getProperty(staminaId).setNumber(0);
    player.getProperty(wakefulnessId).setNumber(spent + SPARE);

    expect(action()?.tryExecute(), actionName).toBe(true);

    return {
      stamina: player.getProperty(staminaId).number,
      wakefulness: player.getProperty(wakefulnessId).number - spent - SPARE,
    };
  }

  /** その休息が動かした tick 数。 */
  function ticksOf(bed: WorldObject, player: WorldObject, actionName: string): number {
    return (bed.tryGetAction(actionName, player)?.executionMinutes() ?? 0) / 15;
  }

  /**
   * その休息だけで眠気の釣り合いを取る1日のうち、眠っているほうの tick 数
   * （docs/world/Bedding.md 4.1節。地面の仮眠だけなら8時間、寝床の睡眠なら6時間）。
   *
   * **測った正味から出す。** 起きている間は -1/tick なので、眠るぶんの正味との比がそのまま割り振りに
   * なる——地面の8時間・寝床の6時間をここへ書き写すと、宣言を動かしたときに古い割り振りのまま通る。
   */
  function ticksAsleepPerDay(netWakefulness: number, ticks: number): number {
    return TICKS_PER_DAY / (netWakefulness / ticks + 1);
  }

  /** 砂浜に据えた寝床。部品を差すなら`withFrame`。 */
  function bedOnBeach(withFrame: boolean, characterName: string = SAMPLE_CHARACTER) {
    const { session, land, player } = open('sandy_beach', characterName);
    const bed = spawnInto(session, 'bed', land, 'fixtures');
    if (withFrame) spawnInto(session, 'bed_frame', bed, 'structure');
    return { bed, player };
  }

  it('骨組みを差すと、同じ睡眠で戻る体力が増える', () => {
    // docs/world/Bedding.md 4節の段2。上積みのブロックが、枠の中身を見て重なる。
    //
    // **測るのは通しの睡眠のほう。** 段の差がいちばん効くのがここで、一晩ぶんが体力の上限を越える
    // 位置にあると、空から測っても2つの数が上限で並んでしまう。
    const bare = bedOnBeach(false);
    const framed = bedOnBeach(true);

    expect(restOn(framed.bed, framed.player, 'sleep').stamina).toBeGreaterThan(
      restOn(bare.bed, bare.player, 'sleep').stamina,
    );
  });

  describe.each(characters)('%s の体力に対して', (characterName) => {
    /** そのキャラクタの体力の上限。 */
    function staminaMax(): number {
      const range = codex.objects
        .get(codex.objectNames.getId(characterName))
        .tryGetPropertyDef(staminaId)?.range;
      if (range === undefined) throw new Error(`'${characterName}' の体力がrangeを持ちません。`);
      return range.max;
    }

    it.each([
      ['敷物だけの寝床', () => bedOnBeach(false, characterName)],
      ['骨組みを差した寝台', () => bedOnBeach(true, characterName)],
    ])('%s は、通しで眠っても体力を満タンにしない', (_label, set) => {
      // docs/world/Bedding.md 4節。**段の差が観測できるのは、一晩ぶんが上限を下回るときだけ**
      // ——越えていると、空から通しで眠れば段によらず満タンになり、骨組みを差した意味が消える。
      const { bed, player } = set();

      expect(restOn(bed, player, 'sleep').stamina).toBeLessThan(staminaMax());
    });

    it('吊ったハンモックも、通しで眠って体力を満タンにしない', () => {
      const { session, land, player } = open('sandy_beach', characterName);
      const slung = spawnInto(session, 'slung_hammock', land, 'fixtures');

      expect(restOn(slung, player, 'sleep').stamina).toBeLessThan(staminaMax());
    });
  });

  it('骨組みを差した一晩が、重い荷を担ぎ通した1日ぶんとちょうど釣り合う', () => {
    // docs/world/Characters.md 荷重の効き方節。**削る側を動かさずに回復の側を置いた**位置なので、
    // load の段の削りと寝床の宣言のどちらを動かしても、ここが落ちる。
    const framed = bedOnBeach(true);
    const sleepTicks = ticksOf(framed.bed, framed.player, 'sleep');
    const restored = restOn(framed.bed, framed.player, 'sleep').stamina;

    expect(restored).toBe(heavyDrainPerTick() * (TICKS_PER_DAY - sleepTicks));
  });

  it('敷物を敷けば、1日に戻る体力が地面の上を上回る', () => {
    // docs/world/Bedding.md 4節。**1時間あたりで上回るだけでは足りない**——寝床の上は眠る時間が
    // 2時間短いので、割が地面の 2/3 まで下がると1日の合計で逆転し、敷物を敷くほど損になる。
    const { bed, player } = bedOnBeach(false);

    expect(perDay(bed, player, 'sleep')).toBeGreaterThan(perDay(player, player, 'nap'));
  });

  /** その休息だけで夜を回したときに、1日で戻る体力。休息の主は寝床でもキャラクタ自身でもよい。 */
  function perDay(host: WorldObject, player: WorldObject, actionName: string): number {
    const ticks = ticksOf(host, player, actionName);
    const rest = restOn(host, player, actionName);
    return (rest.stamina / ticks) * ticksAsleepPerDay(rest.wakefulness, ticks);
  }

  /** `heavy` を担いでいる間に、1 tickで削られる体力（characters/medic.yaml の load の段）。 */
  function heavyDrainPerTick(): number {
    const { session, player } = open('sandy_beach');
    const hand = player.getSlot(codex.slotNames.getId('hand'));
    // 石は1つ1000gで束ねられるので枠は1つで足りる。医師のheavyは16500gから。
    for (let i = 0; i < 17; i++)
      expect(
        session.createObject(codex.objectNames.getId('stone')).moveToSlotOrRejection(hand),
      ).toBeUndefined();
    expect(player.getProperty(codex.propertyNames.getId('load')).isInStage('heavy')).toBe(true);

    const before = player.getProperty(staminaId).number;
    player.tick();
    return before - player.getProperty(staminaId).number;
  }

  it('骨組みを差しても、戻る眠気は変わらない', () => {
    // 同4節。**眠気が戻る量は段によらない**——18時間起きて6時間眠るという釣り合いを、寝床の段が
    // 動かさないため。
    const bare = bedOnBeach(false);
    const framed = bedOnBeach(true);

    expect(restOn(framed.bed, framed.player, 'sleep').wakefulness).toBe(
      restOn(bare.bed, bare.player, 'sleep').wakefulness,
    );
  });

  it('寝床の上では、仮眠2回と睡眠1回がちょうど同じだけ戻る', () => {
    // 同4節。**段ごとに1つの定数なので、寝床のぶんは長さに正比例する**——キャラクタ側が持つ
    // 「まとめて休むほど得」が効くのは地面の上だけ（charactersYaml.test.tsの単調性）。
    const napped = bedOnBeach(false);
    const slept = bedOnBeach(false);
    const nap = restOn(napped.bed, napped.player, 'nap');
    const sleep = restOn(slept.bed, slept.player, 'sleep');

    expect(nap.wakefulness * 2).toBe(sleep.wakefulness);
    expect(nap.stamina * 2).toBe(sleep.stamina);
  });

  it('吊ったハンモックは、骨組みを差した寝台と同じだけ戻す', () => {
    // 同6節。**寝台の上位ではなく別系統**なので、回復量では上に立たない。差は置ける場所
    // （支点が要る）・伸ばしろ（詰め物を足す先が無い）・持ち出し（畳んで次の土地へ運べる）のほう。
    const hammock = open('sandy_beach');
    const framed = bedOnBeach(true);
    const slung = spawnInto(hammock.session, 'slung_hammock', hammock.land, 'fixtures');

    expect(restOn(slung, hammock.player, 'nap').stamina).toBe(
      restOn(framed.bed, framed.player, 'nap').stamina,
    );
  });

  it('支点の無い土地では、ハンモックを吊れない', () => {
    // 同6節。支点は土地の宣言（locations.yamlのhanging_anchor）で、見るのは`ancestor`なので
    // 手に持っていても足元に置いていても同じに読める。
    const { session, land, player } = open('wasteland');
    const hammock = spawnInto(session, 'hammock', player, 'hand');

    expect(hammock.tryGetAction('hang', player)?.unmetRequirement()?.reasonName).toBe('no_anchor');
    expect(land.getSlot(codex.slotNames.getId('fixtures')).contents).toHaveLength(0);
  });

  it('支点のある土地なら吊れて、吊ったものがその場に残る', () => {
    const { session, land, player } = open('forest');
    const hammock = spawnInto(session, 'hammock', player, 'hand');

    expect(hammock.tryGetAction('hang', player)?.tryExecute()).toBe(true);

    // 吊った物は設置物なので手持ちの枠に入らず、agentの親＝今いる土地へこぼれる（9.4節）。
    const fixtures = land.getSlot(codex.slotNames.getId('fixtures')).contents;
    expect(fixtures.map((fixture) => fixture.def.name)).toContain('slung_hammock');
    expect(player.getSlot(codex.slotNames.getId('hand')).contents, '網は手元から消える').toHaveLength(0);
  });

  it('吊ったハンモックを畳むと、網が手元に戻る', () => {
    // 同6.2節。**吊る一度きりでは「遠出へ持っていける寝床」にならない**——この経路が消えると、
    // 置ける場所でも伸ばしろでも寝台に劣るだけの寝床になる（同6節の表）。
    const { session, land, player } = open('forest');
    const slung = spawnInto(session, 'slung_hammock', land, 'fixtures');

    expect(slung.tryGetAction('take_down', player)?.tryExecute()).toBe(true);

    expect(heldNames(player), '網は手元へ返る').toContain('hammock');
    expect(land.getSlot(codex.slotNames.getId('fixtures')).contents, '吊ったものは残らない').toHaveLength(0);
  });

  it('畳んだ網は、次の土地で吊り直せる', () => {
    // 同6.2節。**持ち出せることがハンモックの取り分**なので、吊った先から回収して別の土地で
    // もう一度吊れなければ、ja.yamlの「巻けば遠出の荷に混ぜられる」が嘘になる。
    const { session, world, land, player } = open('forest');
    const hammock = spawnInto(session, 'hammock', player, 'hand');
    expect(hammock.tryGetAction('hang', player)?.tryExecute()).toBe(true);
    expect(slungIn(land)?.tryGetAction('take_down', player)?.tryExecute()).toBe(true);

    // 網を担いだまま、支点のある別の土地へ移る。
    const next = spawnInto(session, 'forest', world, 'locations');
    expect(player.moveToSlotOrRejection(next.getSlot(codex.slotNames.getId('characters')))).toBeUndefined();

    expect(heldHammock(player)?.tryGetAction('hang', player)?.tryExecute()).toBe(true);
    expect(slungIn(next)?.def.name).toBe('slung_hammock');
  });

  /** その土地に吊ってあるハンモック。 */
  function slungIn(land: WorldObject): WorldObject | undefined {
    return land
      .getSlot(codex.slotNames.getId('fixtures'))
      .contents.find((fixture) => fixture.def.name === 'slung_hammock');
  }

  /** 手に持っている物の型名。 */
  function heldNames(player: WorldObject): string[] {
    return player.getSlot(codex.slotNames.getId('hand')).contents.map((held) => held.def.name);
  }

  /** 手に持っている、巻いたままのハンモック。 */
  function heldHammock(player: WorldObject): WorldObject | undefined {
    return player.getSlot(codex.slotNames.getId('hand')).contents.find((held) => held.def.name === 'hammock');
  }
});
