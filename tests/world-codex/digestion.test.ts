import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PropertyValue } from '../../src/domain/PropertyValue';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { PlayerCharacter } from '../../src/domain/wrappers/PlayerCharacter';
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
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
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
    expect(
      beach.moveToSlotOrRejection(worldInstance.getSlot(codex.slotNames.getId('locations'))),
    ).toBeUndefined();
    player = spawn(SAMPLE_CHARACTER);
    expect(player.moveToSlotOrRejection(beach.getSlot(codex.slotNames.getId('characters')))).toBeUndefined();
  });

  function spawn(objectName: string): WorldObject {
    return session.createObject(codex.objectNames.getId(objectName));
  }

  function valueOf(propertyId: number): number {
    return player.tryGetProperty(propertyId)?.number ?? 0;
  }

  /**
   * count tickぶん進める。**渇きだけは満たし続ける**——ここで見たいのは消化だけで、水分が尽きると
   * 何日も回す前に渇きで死ぬ（VitalsSystem.md 8節）。
   */
  function tick(count: number): void {
    const held = valueOf(hydrationId);
    for (let i = 0; i < count; i++) {
      player.tick();
      player.getProperty(hydrationId).setNumberWithoutEvents(held);
    }
  }

  /** 在庫へ直接入れる（食べ物を用意せずに量だけを置きたいとき）。 */
  function stock(amount: number): void {
    player.getProperty(carbohydrateId).setNumberWithoutEvents(amount);
    for (const name of ['protein', 'lipid'])
      player.getProperty(codex.propertyNames.getId(name)).setNumberWithoutEvents(0);
  }

  it('食べた物は、かさと栄養素の両方に入る', () => {
    const taro = spawn('roasted_taro');
    expect(taro.moveToSlotOrRejection(player.getSlot(codex.slotNames.getId('hand')))).toBeUndefined();
    player.getProperty(satietyId).setNumberWithoutEvents(0);
    stock(0);

    expect(taro.tryGetAction('eat', player)?.tryExecute() === true).toBe(true);

    expect(valueOf(satietyId), 'かさはmL').toBe(550);
    expect(valueOf(carbohydrateId), '中身はtick（かさとは別の数）').toBe(48);
  });

  it('在庫は時間をかけて蓄えになり、尽きれば蓄えが削られる', () => {
    player.getProperty(bodyFatId).setNumberWithoutEvents(1000);
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
    player.getProperty(satietyId).setNumberWithoutEvents(512);

    tick(31);
    expect(valueOf(satietyId), '31 tickではまだ残っている').toBeGreaterThan(0);

    tick(1);
    expect(valueOf(satietyId)).toBe(0);
  });

  it('腹がいっぱいだと食べられず、直前まで食べても溢れない', () => {
    const taro = spawn('roasted_taro');
    expect(taro.moveToSlotOrRejection(player.getSlot(codex.slotNames.getId('hand')))).toBeUndefined();
    const max = 1500;

    player.getProperty(satietyId).setNumberWithoutEvents(900);
    expect(taro.tryGetAction('eat', player)?.tryExecute() === true, 'full段では実行できない').toBe(false);

    player.getProperty(satietyId).setNumberWithoutEvents(899);
    expect(taro.tryGetAction('eat', player)?.tryExecute() === true, '1つ下の段なら食べられる').toBe(true);
    expect(valueOf(satietyId), '最大の食料でも溢れない').toBe(899 + 550);
    expect(899 + 550).toBeLessThanOrEqual(max);
  });

  it('1日3食（512mLのイモ）で体脂肪は横ばいになる', () => {
    // 1食40単位×3 = 120単位が、基礎代謝1/tick × 96 tickをやや上回る（DigestionSystem.md 5節）。
    const fatBefore = valueOf(bodyFatId);
    stock(0);

    for (let day = 0; day < 5; day++) {
      for (let meal = 0; meal < 3; meal++) {
        player.getProperty(carbohydrateId).setNumberWithoutEvents(valueOf(carbohydrateId) + 32);
        tick(DAY / 3);
      }
    }

    expect(valueOf(bodyFatId)).toBeGreaterThan(fatBefore - 40);
    expect(valueOf(bodyFatId)).toBeLessThan(fatBefore + 40);
  });

  it('食べ続けても際限なく太らない（基礎代謝が体格で上がる）', () => {
    const stout = codex.objects.get(codex.objectNames.getId(SAMPLE_CHARACTER)).tryGetPropertyDef(bodyFatId)!;

    // 段が上がるほど速く減る。ここが単調でないと、太るほど痩せやすいという裏返りが起きる。
    const rates = [0, 96, 480, 2880, 4320].map((fat) => {
      player.getProperty(bodyFatId).setNumberWithoutEvents(fat);
      stock(0);
      const before = valueOf(bodyFatId);
      tick(1);
      return before - valueOf(bodyFatId);
    });

    expect(stout.stageAt(0)?.name).toBe('starved');
    rates.forEach((rate, index) => expect(rate).toBeCloseTo([0.5, 0.7, 1, 1.3, 1.6][index], 10));
  });

  it('絶食すると飢えで死に、死因は段starvedになる', () => {
    stock(0);

    // 17.7日（DigestionSystem.md 4節）。基礎代謝が痩せるほど落ちるので、一定1/tickの15日より延びる。
    tick(17 * DAY);
    expect(player.parent, '17日目はまだ生きている').toBeDefined();

    tick(DAY);
    expect(player.parent, '18日目には世界から外れる').toBeUndefined();
    expect(player.exhaustedStage).toBe('starved');
  });

  /**
   * ビタミンが尽きた先（DigestionSystem.md 4節）。壊血病は怪我のカードではなく、ビタミンの一番下の
   * 段そのもの——見るのは、絶てば段まで落ちること・段が痛みを押し上げること・食べれば戻ることの3つ。
   */
  describe('壊血病', () => {
    /** 空心菜1束ぶんのビタミン（foods.yaml）。1.7日ぶんに当たる。 */
    const ONE_BUNCH = 83;
    /** 壊血病が出る量（現実の閾値）。 */
    const SCURVY_THRESHOLD = 300;
    /** 開始時の900mgが閾値ちょうどに着くまでのtick数（(900 - 300) ÷ 0.5）。12.5日。 */
    const REACHES_THRESHOLD = 1200;
    /** 閾値を割って壊血病に入るまでのtick数（段の下限は閾値を含む）。 */
    const ONSET_TICKS = REACHES_THRESHOLD + 1;
    /** 開始時の900mgが0に着くまでのtick数（900 ÷ 0.5）。18.75日。 */
    const DEPLETION_TICKS = 1800;

    /**
     * count tickぶん進める。13日ぶんを回すので、その間に渇きと飢えで死んでしまわないよう
     * （VitalsSystem.md 8節）、命を絶つ値だけは戻しておく。
     */
    function endure(count: number): void {
      const vital = ['hydration', 'body_fat'].map((name) => codex.propertyNames.getId(name));
      const held = vital.map((id) => player.tryGetProperty(id)?.number ?? 0);
      for (let i = 0; i < count; i++) {
        player.tick();
        vital.forEach((id, index) => player.getProperty(id).setNumberWithoutEvents(held[index]));
      }
    }

    function vitamin(): PropertyValue {
      return player.getProperty(codex.propertyNames.getId('vitamin'));
    }

    function painOf(): number {
      return player.tryGetProperty(codex.propertyNames.getId('pain'))?.getEffectiveValue() ?? 0;
    }

    /** 怪我スロットに並ぶ物の識別子（同種のスタックは個数ぶん並べる）。 */
    function injuries(): string[] {
      return new PlayerCharacter(player, codex).injuryStacks.flatMap((stack) =>
        stack.map((object) => object.def.name),
      );
    }

    it('葉物を絶つと、12.5日で300mgを割って壊血病の段に落ちる', () => {
      endure(REACHES_THRESHOLD);
      expect(vitamin().number, '閾値ちょうど').toBe(SCURVY_THRESHOLD);
      expect(vitamin().stage?.name, '割るまでは壊血病ではない').toBe('deficient');

      endure(1);
      expect(vitamin().stage?.name).toBe('scurvy');
    });

    it('壊血病は怪我のカードを作らず、段が痛みを押し上げる', () => {
      // 怪我にすると、目に見えない病のカードを何枚も作ることになる（DesignPrinciples.md）。
      expect(painOf(), '足りているうちは痛まない').toBe(0);

      endure(ONSET_TICKS);

      expect(injuries(), '怪我スロットには何も入らない').toEqual([]);
      expect(painOf(), '段のmodifyが押し上げる').toBe(60);
    });

    it('割った直後なら、空心菜1束で段を抜けて痛みがその場で引く', () => {
      endure(ONSET_TICKS);
      expect(painOf()).toBe(60);

      vitamin().add(ONE_BUNCH);

      expect(vitamin().stage?.name).toBe('deficient');
      expect(painOf(), 'modifyは可逆なので、段を出た瞬間に消える（8.3節）').toBe(0);
    });

    it('尽きるまで放っておくと、戻すのに4束要る', () => {
      // 閾値の上に戻すのが手当てにあたるので、放置した分だけ支払う量が増える。
      endure(DEPLETION_TICKS);
      expect(vitamin().number).toBe(0);

      vitamin().add(ONE_BUNCH * 3);
      expect(vitamin().stage?.name, '249mgでは閾値に届かない').toBe('scurvy');

      vitamin().add(ONE_BUNCH);

      expect(vitamin().stage?.name).toBe('deficient');
      expect(painOf()).toBe(0);
    });

    it('壊血病でも死なない（死に方は3つのまま）', () => {
      // 尽きて死ぬのは水分・体脂肪・血だけ（VitalsSystem.md 8節）。ビタミンは致命的域を持たない。
      endure(DEPLETION_TICKS + DAY);

      expect(vitamin().number, '0で止まる').toBe(0);
      expect(player.parent, '尽きたまま置いても世界から外れない').toBeDefined();
      expect(vitamin().alert).toBe('danger');
    });
  });
});
