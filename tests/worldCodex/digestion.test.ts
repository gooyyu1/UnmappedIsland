import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 胃→腸→蓄えの配管（docs/engine/DigestionSystem.md）を、実ファイルの定義だけで検証する。
 *
 * 見るのは文書が挙げた数値そのもの——胃が空になるまでの時間・1日3食で体脂肪が横ばいになること・
 * 絶食して死ぬまでの日数。配分を刻み直したら必ずここが落ちる。
 */
describe('消化（胃→腸→蓄え）', () => {
  /** 1日 = 96 tick（1 tick = 15分）。 */
  const DAY = 96;

  let codex: WorldCodex;
  let session: WorldSession;
  let player: WorldObject;
  let stomachId: number;
  let intestineId: number;
  let satietyId: number;
  let bodyFatId: number;
  let hydrationId: number;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    stomachId = codex.propertyNames.getId('stomach');
    intestineId = codex.propertyNames.getId('intestine');
    satietyId = codex.propertyNames.getId('satiety');
    bodyFatId = codex.propertyNames.getId('body_fat');
    hydrationId = codex.propertyNames.getId('hydration');
  });

  beforeEach(() => {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    session = new WorldSession(codex, undefined, fixedRng(0));
    const beach = spawn('sandy_beach');
    expect(beach.moveToSlot(worldInstance, codex.slotNames.getId('locations'))).toBeUndefined();
    player = spawn(SAMPLE_CHARACTER);
    expect(player.moveToSlot(beach, codex.slotNames.getId('characters'))).toBeUndefined();
  });

  function spawn(objectName: string): WorldObject {
    return session.spawn(codex.objectNames.getId(objectName));
  }

  function valueOf(propertyId: number): number {
    return player.getNumber(propertyId);
  }

  /** 満腹感は実効値なので、実体値ではなく寄与を畳んだ値で読む（DigestionSystem.md 2節）。 */
  function satietyNow(): number {
    return player.getEffectiveValue(satietyId);
  }

  /**
   * count tickぶん進める。**渇きだけは満たし続ける**——ここで見たいのは消化だけで、水分が尽きると
   * 何日も回す前に渇きで死ぬ（VitalsSystem.md 8節）。
   */
  function tick(count: number): void {
    const held = valueOf(hydrationId);
    for (let i = 0; i < count; i++) {
      player.tick(session);
      player.setProperty(hydrationId, held);
    }
  }

  /** 胃へ直接入れる（食べ物を用意せずに量だけを置きたいとき）。 */
  function fillStomach(amount: number): void {
    player.setProperty(stomachId, amount);
  }

  it('食べた物は胃から腸を通って、遅れて蓄えになる', () => {
    const fatBefore = valueOf(bodyFatId);
    player.setProperty(intestineId, 0);
    fillStomach(20);

    tick(1);
    expect(valueOf(stomachId), '胃から3出る（12以上の段）').toBe(17);
    expect(valueOf(intestineId), 'その3が腸へ届く').toBe(3);
    expect(valueOf(bodyFatId), '腸に届いた分はこのtickではまだ蓄えにならない').toBe(fatBefore - 1);

    tick(1);
    expect(valueOf(bodyFatId), '次のtickから吸収が始まる（0.5 - 基礎代謝1）').toBeCloseTo(
      fatBefore - 1.5,
      10,
    );
  });

  it.each([
    [4, 3],
    [8, 5],
    [16, 8],
    [20, 10],
    [32, 13],
  ])('胃は溜まっているほど速く出し、%d単位なら%d tickで空になる', (meal, expectedTicks) => {
    fillStomach(meal);

    for (let i = 0; i < expectedTicks - 1; i++) tick(1);
    expect(valueOf(stomachId), `${expectedTicks - 1} tickではまだ残っている`).toBeGreaterThan(0);

    tick(1);
    expect(valueOf(stomachId)).toBe(0);
  });

  it('満腹感は胃と腸の両方が押し上げ、両方が尽きて0になる', () => {
    player.setProperty(intestineId, 0);
    fillStomach(0);
    expect(satietyNow(), '胃も腸も空なら空腹の底').toBe(0);
    expect(valueOf(satietyId), '実体値は0のまま動かない').toBe(0);

    player.setProperty(intestineId, 16);
    expect(satietyNow(), '腸だけでも押し上がる（胃が空でもすぐには空腹にならない）').toBe(30);

    fillStomach(24);
    expect(satietyNow(), '満杯の胃が60を足す').toBe(90);
  });

  it('胃が満杯だと食べられない', () => {
    const taro = spawn('taro');
    expect(taro.moveToSlot(player, codex.slotNames.getId('hand'))).toBeUndefined();

    fillStomach(24);
    expect(taro.tryExecuteAction('eat', player, session), '満杯の段では実行できない').toBe(false);

    fillStomach(23);
    expect(taro.tryExecuteAction('eat', player, session), '1つ下の段なら食べられる').toBe(true);
  });

  it('1日3食（胃いっぱい）で体脂肪は横ばいになる', () => {
    // 3食×32単位 = 96単位が、基礎代謝1/tick × 96 tickとちょうど釣り合う（DigestionSystem.md 3.3節）。
    const fatBefore = valueOf(bodyFatId);

    for (let day = 0; day < 5; day++) {
      for (const [at, until] of [
        [28, 48],
        [48, 72],
        [72, DAY + 28],
      ]) {
        fillStomach(32);
        tick(until - at);
      }
    }

    // 5日ぶんの摂取と消費が釣り合っていること（配管に残っている分だけ目減りする）。
    expect(valueOf(bodyFatId)).toBeGreaterThan(fatBefore - 30);
    expect(valueOf(bodyFatId)).toBeLessThan(fatBefore + 30);
  });

  it('食べ続けても際限なく太らない（基礎代謝が体格で上がる）', () => {
    const stout = codex.objects.get(codex.objectNames.getId(SAMPLE_CHARACTER)).getPropertyDef(bodyFatId)!;

    // 段が上がるほど速く減る。ここが単調でないと、太るほど痩せやすいという裏返りが起きる。
    const rates = [0, 96, 480, 2880, 4320].map((fat) => {
      player.setProperty(bodyFatId, fat);
      player.setProperty(stomachId, 0);
      player.setProperty(intestineId, 0);
      const before = valueOf(bodyFatId);
      tick(1);
      return before - valueOf(bodyFatId);
    });

    expect(stout.stageNameOf(0)).toBe('starved');
    rates.forEach((rate, index) => expect(rate).toBeCloseTo([0.5, 0.7, 1, 1.3, 1.6][index], 10));
  });

  it('絶食すると飢えで死に、死因は段starvedになる', () => {
    player.setProperty(stomachId, 0);
    player.setProperty(intestineId, 0);

    // 17.7日（DigestionSystem.md 4節）。基礎代謝が痩せるほど落ちるので、一定1/tickの15日より延びる。
    tick(17 * DAY);
    expect(player.parent, '17日目はまだ生きている').toBeDefined();

    tick(DAY);
    expect(player.parent, '18日目には世界から外れる').toBeUndefined();
    expect(player.exhaustedStage()).toBe('starved');
  });
});
