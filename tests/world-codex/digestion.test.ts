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
 * 見るのは文書が挙げた数値そのもの——満腹感が空になるまでの時間・1日3食で体脂肪が横ばいになること・
 * 絶食して死ぬまでの日数。配分を刻み直したら必ずここが落ちる。
 */
describe('消化（かさ・栄養素・蓄え）', () => {
  /** 1日 = 96 tick（1 tick = 15分）。 */
  const DAY = 96;

  let codex: WorldCodex;
  let session: WorldSession;
  let player: WorldObject;
  let satietyId: number;
  let carbohydrateId: number;
  let bodyFatId: number;
  let hydrationId: number;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    satietyId = codex.propertyNames.getId('satiety');
    carbohydrateId = codex.propertyNames.getId('carbohydrate');
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

  /** 在庫へ直接入れる（食べ物を用意せずに量だけを置きたいとき）。 */
  function stock(amount: number): void {
    player.setProperty(carbohydrateId, amount);
    for (const name of ['protein', 'lipid']) player.setProperty(codex.propertyNames.getId(name), 0);
  }

  it('食べた物は、かさと栄養素の両方に入る', () => {
    const taro = spawn('taro');
    expect(taro.moveToSlot(player, codex.slotNames.getId('hand'))).toBeUndefined();
    player.setProperty(satietyId, 0);
    stock(0);

    expect(taro.tryExecuteAction('eat', player, session)).toBe(true);

    expect(valueOf(satietyId), 'かさはmL').toBe(600);
    expect(valueOf(carbohydrateId), '中身はtick（かさとは別の数）').toBe(40);
  });

  it('在庫は時間をかけて蓄えになり、尽きれば蓄えが削られる', () => {
    player.setProperty(bodyFatId, 1000);
    stock(4);

    const fatBefore = valueOf(bodyFatId);
    tick(1);
    expect(valueOf(carbohydrateId), '糖質は2/tickで出る').toBe(2);
    expect(valueOf(bodyFatId), '出た2が蓄えになり、基礎代謝1が引かれる').toBe(fatBefore + 1);

    tick(2);
    expect(valueOf(carbohydrateId), '在庫は尽きている').toBe(0);
    expect(valueOf(bodyFatId), '尽きた後は基礎代謝で減るだけ').toBe(fatBefore + 1);
  });

  it('満腹感はかさで、1食が8時間もつ', () => {
    // 512mL（1食）を16mL/tickで空にすると32 tick＝8時間（DigestionSystem.md 2節）。
    player.setProperty(satietyId, 512);

    tick(31);
    expect(valueOf(satietyId), '31 tickではまだ残っている').toBeGreaterThan(0);

    tick(1);
    expect(valueOf(satietyId)).toBe(0);
  });

  it('腹がいっぱいだと食べられず、直前まで食べても溢れない', () => {
    const taro = spawn('taro');
    expect(taro.moveToSlot(player, codex.slotNames.getId('hand'))).toBeUndefined();
    const max = 1500;

    player.setProperty(satietyId, 900);
    expect(taro.tryExecuteAction('eat', player, session), 'full段では実行できない').toBe(false);

    player.setProperty(satietyId, 899);
    expect(taro.tryExecuteAction('eat', player, session), '1つ下の段なら食べられる').toBe(true);
    expect(valueOf(satietyId), '最大の食料でも溢れない').toBe(899 + 600);
    expect(899 + 600).toBeLessThanOrEqual(max);
  });

  it('1日3食（512mLのイモ）で体脂肪は横ばいになる', () => {
    // 1食40単位×3 = 120単位が、基礎代謝1/tick × 96 tickをやや上回る（DigestionSystem.md 5節）。
    const fatBefore = valueOf(bodyFatId);
    stock(0);

    for (let day = 0; day < 5; day++) {
      for (let meal = 0; meal < 3; meal++) {
        player.setProperty(carbohydrateId, valueOf(carbohydrateId) + 32);
        tick(DAY / 3);
      }
    }

    expect(valueOf(bodyFatId)).toBeGreaterThan(fatBefore - 40);
    expect(valueOf(bodyFatId)).toBeLessThan(fatBefore + 40);
  });

  it('食べ続けても際限なく太らない（基礎代謝が体格で上がる）', () => {
    const stout = codex.objects.get(codex.objectNames.getId(SAMPLE_CHARACTER)).getPropertyDef(bodyFatId)!;

    // 段が上がるほど速く減る。ここが単調でないと、太るほど痩せやすいという裏返りが起きる。
    const rates = [0, 96, 480, 2880, 4320].map((fat) => {
      player.setProperty(bodyFatId, fat);
      stock(0);
      const before = valueOf(bodyFatId);
      tick(1);
      return before - valueOf(bodyFatId);
    });

    expect(stout.stageNameOf(0)).toBe('starved');
    rates.forEach((rate, index) => expect(rate).toBeCloseTo([0.5, 0.7, 1, 1.3, 1.6][index], 10));
  });

  it('絶食すると飢えで死に、死因は段starvedになる', () => {
    stock(0);

    // 17.7日（DigestionSystem.md 4節）。基礎代謝が痩せるほど落ちるので、一定1/tickの15日より延びる。
    tick(17 * DAY);
    expect(player.parent, '17日目はまだ生きている').toBeDefined();

    tick(DAY);
    expect(player.parent, '18日目には世界から外れる').toBeUndefined();
    expect(player.exhaustedStage()).toBe('starved');
  });
});
