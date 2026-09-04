import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnsObject } from '../../src/codex-viewer/describe/effectQueries';
import type { ObjectDef } from '../../src/domain/ObjectDef';
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
    open(0);
  });

  /** 砂浜に立つプレイヤーから始める。rollはpickがどの候補を引くかを決める（fixedRng）。 */
  function open(roll: number): void {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    session = new WorldSession(codex, undefined, fixedRng(roll));
    const beach = spawn('sandy_beach');
    expect(
      beach.moveToSlotOrRejection(worldInstance.getSlot(codex.slotNames.getId('locations'))),
    ).toBeUndefined();
    player = spawn(SAMPLE_CHARACTER);
    expect(player.moveToSlotOrRejection(beach.getSlot(codex.slotNames.getId('characters')))).toBeUndefined();
  }

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

  it('絶食すると飢えで死に、死因はstarvedを名乗る', () => {
    stock(0);

    // 17.7日（DigestionSystem.md 4節）。基礎代謝が痩せるほど落ちるので、一定1/tickの15日より延びる。
    tick(17 * DAY);
    expect(player.parent, '17日目はまだ生きている').toBeDefined();

    tick(DAY);
    expect(player.parent, '18日目には世界から外れる').toBeUndefined();
    expect(player.destroyedReason).toBe('starved');
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
     *
     * **脂の在庫も戻す。** 15時間で尽きて別の段が痛みを押し上げる（同7節）ので、そのままでは
     * ここで見ている痛みが壊血病のものだけではなくなる。
     */
    function endure(count: number): void {
      const vital = ['hydration', 'body_fat', 'lipid'].map((name) => codex.propertyNames.getId(name));
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

  /**
   * 脂が尽きたまま肉ばかり食べ続ける道（DigestionSystem.md 7節）。壊血病と同じ形で、内側の不調を
   * lipidの一番下の段が持つ——見るのは、絶てば段まで落ちること・水の保ちが半分になること・
   * 食べたたんぱく質が身にならないこと・脂を摂れば全部止まることの4つ。
   *
   * **死に方は増えない。** 最後に死ぬのは既にある脱水で（VitalsSystem.md 8節）、名乗る死因も
   * dehydratedのまま。
   */
  describe('脂が尽きた域', () => {
    /** 開始時の30単位が0に着くまでのtick数（30 ÷ 0.5）。15時間。 */
    const DEPLETION_TICKS = 60;
    /** 肉を食べ続けている状態として置くたんぱく質の在庫（maxいっぱい）。 */
    const MEAT_FED = 120;
    /** ヤシの果肉1つぶんの脂質（coconut.yaml）。 */
    const ONE_MEAT = 26;

    function prop(name: string): PropertyValue {
      return player.getProperty(codex.propertyNames.getId(name));
    }

    function painOf(): number {
      return player.tryGetProperty(codex.propertyNames.getId('pain'))?.getEffectiveValue() ?? 0;
    }

    /** count tickぶん進める。**水分を戻さない**——ここで見たいのが水の減り方そのものなので。 */
    function live(count: number): void {
      for (let i = 0; i < count; i++) player.tick();
    }

    /** 肉だけを食べ続けながらcount tick進める（たんぱく質の在庫を切らさない）。 */
    function liveOnMeat(count: number): void {
      for (let i = 0; i < count; i++) {
        prop('protein').setNumberWithoutEvents(MEAT_FED);
        player.tick();
      }
    }

    it('脂を絶つと15時間で在庫が尽き、その1 tick手前で段に入る', () => {
      // 段の境目は1——15分ぶんも残っていなければ尽きたとみなす。0.5/tickで出ていくので、
      // 割るのは59 tick目。
      live(DEPLETION_TICKS - 2);
      expect(prop('lipid').number).toBe(1);
      expect(prop('lipid').stage?.name, '1はまだ在庫').toBe('stocked');

      live(1);
      expect(prop('lipid').number).toBe(0.5);
      expect(prop('lipid').stage?.name).toBe('fat_starved');

      live(1);
      expect(prop('lipid').number, '15時間で空').toBe(0);
    });

    it('肉が在庫にある間だけ、水分の減りが倍になる', () => {
      // 「食べれば凌げる」が裏返る唯一の場所（7節）。ゲートがたんぱく質の在庫なので、脂の無い肉を
      // 食べ足すほど水が減る。
      prop('lipid').setNumberWithoutEvents(0);

      prop('protein').setNumberWithoutEvents(0);
      const withoutMeat = prop('hydration').number;
      live(1);
      expect(withoutMeat - prop('hydration').number, '捨てる肉が無ければ-1/tickのまま').toBe(1);

      prop('protein').setNumberWithoutEvents(MEAT_FED);
      const withMeat = prop('hydration').number;
      live(1);
      expect(withMeat - prop('hydration').number, '尿素を捨てるのに水が要る').toBe(2);
    });

    it('肉は身にならない——在庫は3減るのに、蓄えへ届くのは1のまま', () => {
      // 捨てられる2は行き先が無い（transferではなくadd）。だから食べても体脂肪は増えない。
      const stocked = spendOneTick(30, MEAT_FED);
      const starved = spendOneTick(0, MEAT_FED);
      const noMeat = spendOneTick(0, 0);

      expect(stocked.protein, '脂があれば体脂肪へ流れる1だけ').toBe(1);
      expect(starved.protein, '脂が尽きると捨てる2が上乗せされる').toBe(3);
      expect(starved.bodyFat - noMeat.bodyFat, '3減っても、蓄えへ届くのは1のまま').toBe(1);
    });

    /** 脂とたんぱく質の在庫を置いて1 tick進め、たんぱく質と体脂肪の動いた量を返す。 */
    function spendOneTick(lipid: number, protein: number): { protein: number; bodyFat: number } {
      prop('lipid').setNumberWithoutEvents(lipid);
      prop('protein').setNumberWithoutEvents(protein);
      const bodyFat = prop('body_fat').number;

      live(1);

      return {
        protein: protein - prop('protein').number,
        bodyFat: prop('body_fat').number - bodyFat,
      };
    }

    it('ヤシの果肉を1つ食べれば段を抜け、痛みも水の減りもその場で戻る', () => {
      prop('lipid').setNumberWithoutEvents(0);
      prop('protein').setNumberWithoutEvents(MEAT_FED);
      live(1);
      expect(painOf(), '必須脂肪酸の欠乏で30（壊血病の半分）').toBe(30);

      prop('lipid').add(ONE_MEAT);

      expect(prop('lipid').stage?.name).toBe('stocked');
      expect(painOf(), 'modifyは可逆なので、段を出た瞬間に消える（8.3節）').toBe(0);
      const before = prop('hydration').number;
      live(1);
      expect(before - prop('hydration').number, '水の減りも元どおり').toBe(1);
    });

    it('肉だけで凌ごうとすると、渇いて死ぬまでが半分になる', () => {
      // 死に方は増えない（VitalsSystem.md 8節）。増えるのは、そこへ至る速さだけ。
      const max = prop('hydration').def.range?.max ?? 0;
      expect(max, 'medicの満水（characters/medic.yaml）').toBe(288);
      prop('hydration').setNumberWithoutEvents(max);
      prop('lipid').setNumberWithoutEvents(0);

      liveOnMeat(max / 2 - 1);
      expect(prop('hydration').number).toBe(2);
      expect(player.parent, '満水から36時間ではまだ生きている').toBeDefined();

      liveOnMeat(1);
      expect(player.parent, '本来3日保つ水が1日半で尽きる').toBeUndefined();
      expect(player.destroyedReason, '終わり方は脱水のまま').toBe('dehydrated');
    });
  });

  /**
   * 傷んだ物を食べたときの吐き下し（DigestionSystem.md 6.1節）。引き金は腐敗だけ（durabilityの段が
   * 押し上げるspoilage）で、見るのは、無事な物では当たらないこと・吐けば腹が空くこと・下せば水が
   * 余計に減ること・引き金を持つべき食べ物が全部持っていること。
   *
   * **生であることはここでは引かない。** 生の物が運ぶ菌は抽選ではなく蓄積する値で持つので、
   * そちらは tests/world-codex/pathogen.test.ts が見る（同6節）。
   */
  describe('吐き下し', () => {
    /** 腐った段（durability 240未満）に居る焼きイモの残り。 */
    const ROTTEN = 120;
    /** 傷んだ段（同480未満）に居る焼きイモの残り。 */
    const STALE = 360;

    // 腐った段の3択は等しい重み（無事100 : 吐く100 : 下す100、foods.yaml）なので、rollがそのまま
    // どれを引くかになる。傷んだ段では吐き下しの重みが1/4なので、同じrollでも無事な側へ寄る。
    const VOMITS = 0.5;
    const HAS_DIARRHEA = 0.9;

    /** 3本の在庫を同じ量だけ置く（減った分を割合で読みたいので、0に張り付かせない）。 */
    const STOCKED = 60;
    /** 吐き下しが3本から持っていく量（foods.yaml）。 */
    const LOST = 40;
    /** 下痢で余計に減る水分（同）。 */
    const DRAINED = 48;

    function stockAll(amount: number): void {
      for (const name of ['carbohydrate', 'protein', 'lipid'])
        player.getProperty(codex.propertyNames.getId(name)).setNumberWithoutEvents(amount);
    }

    /** 焼きイモを1つ、残りdurabilityを指定して食べる。 */
    function eatTaro(durability: number): void {
      const taro = spawn('roasted_taro');
      expect(taro.moveToSlotOrRejection(player.getSlot(codex.slotNames.getId('hand')))).toBeUndefined();
      taro.getProperty(codex.propertyNames.getId('durability')).setNumberWithoutEvents(durability);
      player.getProperty(satietyId).setNumberWithoutEvents(0);
      stockAll(STOCKED);

      expect(taro.tryGetAction('eat', player)?.tryExecute() === true).toBe(true);
    }

    function nutrients(): number[] {
      return ['carbohydrate', 'protein', 'lipid'].map(
        (name) => player.getProperty(codex.propertyNames.getId(name)).number,
      );
    }

    /** eatを持つ食べ物（飲む物は持たない。青いヤシの実、foods.yaml冒頭）を宣言のまま全数。 */
    function edibleDefs(): ObjectDef[] {
      const foodTagId = codex.tagNames.getId('food');
      return [...codex.objects].filter(
        (def) => !codex.isGenerated(def) && def.tags.includes(foodTagId) && def.declaresInteraction('eat'),
      );
    }

    /**
     * 食べ物を全数、1つずつ真新しい世界で食べさせて、食べた後の体を見て名前を振り分ける。
     * prepareは口へ運ぶ前の仕込み（腐らせる等）で、書かなければ採れたてのまま食べさせる。
     * hitは「当たった」の見分け方で、既定は吐き下し（腹が空になったか）。
     */
    function eatEveryFood(
      roll: number,
      prepare: (food: WorldObject) => void = () => {},
      hit: () => boolean = () => valueOf(satietyId) === 0,
    ): { affected: string[]; unaffected: string[] } {
      const affected: string[] = [];
      const unaffected: string[] = [];

      for (const def of edibleDefs()) {
        open(roll);
        const food = spawn(def.name);
        expect(food.moveToSlotOrRejection(player.getSlot(codex.slotNames.getId('hand')))).toBeUndefined();
        prepare(food);
        player.getProperty(satietyId).setNumberWithoutEvents(0);
        stockAll(STOCKED);

        expect(food.tryGetAction('eat', player)?.tryExecute() === true, def.name).toBe(true);
        (hit() ? affected : unaffected).push(def.name);
      }

      return { affected: affected.sort(), unaffected: unaffected.sort() };
    }

    it('無事な食べ物では当たらない', () => {
      // 一番当たりやすい位置を引いても何も起きない。傷んでいなければ吐き下しの重みは0なので、
      // 抽選そのものが無事な側の1択になる。
      open(HAS_DIARRHEA);
      const water = valueOf(hydrationId);

      eatTaro(960);

      expect(valueOf(satietyId), 'かさはそのまま残る').toBe(550);
      expect(nutrients(), '中身も減らない').toEqual([STOCKED + 48, STOCKED + 2, STOCKED]);
      expect(valueOf(hydrationId), '水も余計に減らない').toBe(water);
    });

    it('腐った物を食べて吐くと、腹が空になり、少し前に食べた分まで失う', () => {
      open(VOMITS);
      const water = valueOf(hydrationId);

      eatTaro(ROTTEN);

      expect(valueOf(satietyId), '胃は空になる').toBe(0);
      expect(nutrients(), '在庫も割合で持っていかれる').toEqual([
        STOCKED + 48 - LOST,
        STOCKED + 2 - LOST,
        STOCKED - LOST,
      ]);
      expect(valueOf(hydrationId), '吐くほうは水を余計に減らさない').toBe(water);
    });

    it('腐った物で下すと、身にならないうえ水が余計に減る', () => {
      open(HAS_DIARRHEA);
      const water = valueOf(hydrationId);

      eatTaro(ROTTEN);

      expect(valueOf(satietyId), '腹は満ちたまま（出るのは腸から先）').toBe(550);
      expect(nutrients(), '在庫は体脂肪へ渡らずに減る').toEqual([
        STOCKED + 48 - LOST,
        STOCKED + 2 - LOST,
        STOCKED - LOST,
      ]);
      expect(valueOf(hydrationId), '脱水はこちらだけ').toBe(water - DRAINED);
    });

    it('傷んだだけの段は、腐った段より当たりにくい', () => {
      // 同じrollで結果が分かれることが、重みが段で変わっていることそのもの。
      open(VOMITS);

      eatTaro(STALE);
      expect(valueOf(satietyId), '傷んだだけなら、この位置ではまだ無事に収まる').toBe(550);

      eatTaro(ROTTEN);
      expect(valueOf(satietyId), '腐っていれば同じ位置で吐く').toBe(0);
    });

    it('腐る食べ物は、どれを食べても当たる', () => {
      // 食べ物を足したときにpickを書き忘れると、それだけが腐っても平気な食料になる。数が増えても
      // 気付けるよう、eatを持つ食べ物を全数、腐らせてから食べさせる。
      const durabilityId = codex.propertyNames.getId('durability');

      const { affected, unaffected } = eatEveryFood(VOMITS, (food) => {
        if (food.def.tryGetPropertyDef(durabilityId) !== undefined)
          food.getProperty(durabilityId).setNumberWithoutEvents(ROTTEN);
      });

      expect(affected).toEqual([
        'banana',
        'bird_egg',
        'coconut_jelly',
        'coconut_meat',
        'raw_meat',
        'roasted_coconut_crab',
        'roasted_meat',
        'roasted_rat',
        'roasted_taro',
        'seaweed',
        'water_spinach',
      ]);
      expect(unaffected, '水も栄養素も残らない炭（animals.yaml）だけが腐らないので当たらない').toEqual([
        'charred_lump',
      ]);
    });

    it('生でも食べられる物は、傷んでいなくても菌を入れる', () => {
      // 菌を書き忘れると、それだけが焼かずに食べても平気な食料になる。数が増えても気付けるよう、
      // 「焼くと何になるか」を実データから引いて、eatを持つ食べ物を全数、**傷ませずに**食べさせる。
      const cookingProgressId = codex.propertyNames.getId('cooking_progress');
      const defs = [...codex.objects].filter((def) => !codex.isGenerated(def));

      /** fromを焼くとtoになるか（cooking_progressのon_max、FireSystem.md 7節）。 */
      const roastsInto = (from: ObjectDef, to: ObjectDef): boolean =>
        from
          .tryGetPropertyDef(cookingProgressId)
          ?.rangeEvents()
          .some(([label, effect]) => label === 'on_max' && spawnsObject(effect, to.globalId)) === true;

      // 規則は「焼いた先を持つ食べ物のうち、生でも食べられる物」（DigestionSystem.md 6.1節）。
      // **生であることは、丸焼きの鎖の先頭に居ること**として引く——焼いた先を持つかどうかだけでは、
      // 焦げる手前の焼けた肉も当てはまってしまう。焼いて生まれた物は既に火が通っている。
      const raw = edibleDefs()
        .filter(
          (def) =>
            defs.some((roasted) => roastsInto(def, roasted)) &&
            !defs.some((source) => roastsInto(source, def)),
        )
        .map((def) => def.name)
        .sort();
      expect(
        raw,
        '菌を名乗るべきなのは、いまは生肉だけ。増えたらDigestionSystem.md 6.1節の数え上げも直す',
      ).toEqual(['raw_meat']);

      // 当たるかどうかは食べた側の免疫が決めるので、ここで見るのは入ったかどうかだけ
      // （その先は tests/world-codex/pathogen.test.ts）。抽選を引かないのでrollは何でもよい。
      const pathogenId = codex.propertyNames.getId('pathogen');
      const { affected } = eatEveryFood(0, undefined, () => valueOf(pathogenId) > 0);

      expect(affected, '傷んでいない物で菌が入るのは、生のまま食べた物だけ').toEqual(raw);
    });

    it('下痢の脱水は、既にある渇きの死に方へ流れる', () => {
      // 吐き下しは新しい致命的な値を足さない（VitalsSystem.md 8節）。死ぬときの名乗りが渇きのまま
      // であることが、死に方が増えていないことの証拠になる。
      open(HAS_DIARRHEA);
      player.getProperty(hydrationId).setNumberWithoutEvents(DRAINED);

      eatTaro(ROTTEN);

      expect(player.parent, '水を使い切って世界から外れる').toBeUndefined();
      expect(player.destroyedReason).toBe('dehydrated');
    });
  });
});
