import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction } from '../support/illumination';
import type { PropertyGlobalId } from '../../src/domain/GlobalId';

/**
 * bedding.yamlの寝床とハンモックを、実ファイルの定義だけで検証する。
 *
 * 見たいのは2つ。**差した部品が回復量を動かすこと**（docs/world/Bedding.md 4節。段ごとのブロックが
 * 重なる形）と、**支点を持たない土地ではハンモックを吊れないこと**（同6.1節）。
 *
 * **部品を差す前後を同じ物差しで測る。** 差しても量が動かない書き方——上積みのブロックを落とす・
 * ゲートが枠の中身を見ない——なら、2つの数が並ぶ。
 */
describe('bedding.yamlの寝床とハンモック', () => {
  let codex: WorldCodex;
  let staminaId: PropertyGlobalId;
  let wakefulnessId: PropertyGlobalId;

  beforeAll(() => {
    codex = bundledCodex();
    staminaId = codex.propertyNames.getId('stamina');
    wakefulnessId = codex.propertyNames.getId('wakefulness');
  });

  /** その土地にプレイヤーが立っている世界。 */
  function open(landName: string) {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    const session = new WorldSession(codex, new World(worldInstance, codex));
    const land = spawnInto(session, landName, worldInstance, 'locations');
    const player = spawnInto(session, SAMPLE_CHARACTER, land, 'characters');
    makeBrightEnoughForAnyAction(player, codex);
    return { session, land, player };
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

  /** 砂浜に据えた寝床。部品を差すなら`withFrame`。 */
  function bedOnBeach(withFrame: boolean) {
    const { session, land, player } = open('sandy_beach');
    const bed = spawnInto(session, 'bed', land, 'fixtures');
    if (withFrame) spawnInto(session, 'bed_frame', bed, 'structure');
    return { bed, player };
  }

  it('骨組みを差すと、同じ仮眠で戻る体力が増える', () => {
    // docs/world/Bedding.md 4節の段2。上積みのブロックが、枠の中身を見て重なる。
    //
    // **測るのは仮眠のほう。** 睡眠1回ぶん（24tick）はどのキャラクタの体力の上限も越えるので
    // （characters/*.yaml）、空から測ると段の差が頭打ちに呑まれて見えない。
    const bare = bedOnBeach(false);
    const framed = bedOnBeach(true);

    expect(restOn(framed.bed, framed.player, 'nap').stamina).toBeGreaterThan(
      restOn(bare.bed, bare.player, 'nap').stamina,
    );
  });

  it('骨組みを差しても、戻る眠気は変わらない', () => {
    // 同4節。**眠気が戻る量は段によらない**——18時間起きて6時間眠るという釣り合いを、寝床の段が
    // 動かさないため。
    const bare = bedOnBeach(false);
    const framed = bedOnBeach(true);

    expect(restOn(framed.bed, framed.player, 'sleep').wakefulness).toBe(
      restOn(bare.bed, bare.player, 'sleep').wakefulness,
    );
  });

  it('寝床の上では、仮眠2回と睡眠1回がちょうど同じだけ眠気が戻る', () => {
    // 同4節。**段ごとに1つの定数なので、寝床のぶんは長さに正比例する**——キャラクタ側が持つ
    // 「まとめて休むほど得」が効くのは地面の上だけ（charactersYaml.test.tsの単調性）。
    // 体力で見ないのは、上の仮眠の検査と同じ理由（睡眠1回が上限を越える）。
    const napped = bedOnBeach(false);
    const slept = bedOnBeach(false);

    expect(restOn(napped.bed, napped.player, 'nap').wakefulness * 2).toBe(
      restOn(slept.bed, slept.player, 'sleep').wakefulness,
    );
  });

  it('吊ったハンモックは、骨組みを差した寝台と同じだけ戻す', () => {
    // 同6節。**寝台の上位ではなく別系統**なので、回復量では上に立たない。差は置ける場所
    // （支点が要る）と伸ばしろ（詰め物を足す先が無い）のほう。
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
});
