import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { World } from '../../src/domain/runtime/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * animals.yamlの動物を、実ファイルの定義だけで検証する（docs/engine/HuntingSystem.md・
 * docs/world/Animals.md）。武器で殴る→怪我が刺さる→警戒が上がる→時間で引く、の一巡を通す。
 */
describe('animals.yamlの動物', () => {
  // strikeの候補は宣言順に「当たり70・外れ30・仕留め（無防備さ）」。無防備さは起きていれば5、
  // 気を失っていれば205なので、同じ引きでも状態によって当たる候補が変わる。
  /** 起きていても気を失っていても当たる引き。 */
  const HITS = 0.2;
  /** 起きている相手を外す引き。 */
  const MISSES = 0.8;
  /** 気を失っている相手なら仕留め、起きていれば当たるだけの引き。 */
  const KILLS_IF_HELPLESS = 0.5;
  /** 起きている相手でも仕留めてしまう、稀な引き。 */
  const LUCKY_KILL = 0.99;

  let codex: WorldCodex;
  let session: WorldSession;
  let jungle: WorldObject;
  let player: WorldObject;
  let monkey: WorldObject;
  let warinessId: number;
  let painId: number;
  let shockId: number;
  let consciousnessId: number;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    warinessId = codex.propertyNames.getId('wariness');
    painId = codex.propertyNames.getId('pain');
    shockId = codex.propertyNames.getId('shock');
    consciousnessId = codex.propertyNames.getId('consciousness');
  });

  beforeEach(() => {
    open(HITS);
  });

  /** 密林に立つプレイヤーと、その足元のサルから始める。rollはpickがどの候補を引くかを決める。 */
  function open(roll: number): void {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    session = new WorldSession(
      codex,
      new World(worldInstance, codex.propertyNames, codex.symbolNames),
      fixedRng(roll),
    );
    jungle = spawnInto('jungle', worldInstance, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, jungle, 'characters');
    monkey = spawnInto('monkey', jungle, 'items');
  }

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.spawn(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlot(parent, codex.slotNames.getId(slotName))).toBeUndefined();
    return spawned;
  }

  /** 今この土地のアイテムスロットに並んでいる物の識別子。 */
  function itemsInJungle(): string[] {
    return jungle.tryGetSlot(codex.slotNames.getId('items'))!.contents.map((object) => object.def.name);
  }

  /** その動物に刺さっている怪我の識別子。 */
  function injuriesOf(animal: WorldObject): string[] {
    const slot = animal.tryGetSlot(codex.slotNames.getId('injuries'));
    return slot === undefined ? [] : slot.contents.map((object) => object.def.name);
  }

  /** 尖った石を手に持たせ、それをサルへ重ねて殴る。 */
  function strikeWithSharpStone(): WorldObject {
    const stone = spawnInto('sharp_stone', player, 'hand');
    expect(monkey.tryExecuteCombination(stone, undefined, 'strike', session)).toBe(true);
    return stone;
  }

  function tick(count: number): void {
    for (let i = 0; i < count; i++) monkey.tick(session);
  }

  /** 今の実効値（modifyの寄与を加味した、画面に出るのと同じ値）。 */
  const effective = (propertyGlobalId: number): number | undefined =>
    monkey.readProperty(propertyGlobalId)?.value;

  /** 今のサルの意識（実効値と域）。痛み・衝撃の寄与が合流した後の姿で、カードのバーに出るのと同じ。 */
  function consciousness(): { value: number; alert: string } {
    const reading = monkey.readProperty(consciousnessId)!;
    return { value: reading.value, alert: reading.alert };
  }

  /** bodyの実行中に告げられた出来事（signal、9.8節）を「誰の身に・何が」の形で並べる。 */
  function signalsOf(body: () => void): string[] {
    const seen: string[] = [];
    session.observeSignals((signal) => seen.push(`${signal.object.def.name}: ${signal.name}`), body);
    return seen;
  }

  it('サルはアイテムでもある動物として、土地のアイテムスロットに並ぶ', () => {
    // 動物を分けるのは「持ち運べるか」ではなく「動かせるか」（HuntingSystem.md 1.1節）。
    const def = codex.objects.get(codex.objectNames.getId('monkey'));

    expect(def.tags).toContain(codex.tagNames.getId('item'));
    expect(def.tags).toContain(codex.tagNames.getId('animal'));
    expect(monkey.parent, '土地のitemsスロットに居る').toBe(jungle);
  });

  it('野生のサルは警戒した状態で現れ、放っておけば落ち着く', () => {
    // 明滅（CardView.md 3節）は域だけで決まるので、現れた時点で安全域を外れていることが要件。
    expect(monkey.readProperty(warinessId)?.alert, '現れた時点で安全域ではない').not.toBe('safe');
    expect(monkey.readProperty(warinessId)?.worsensUpward, '増えるほど悪い').toBe(true);

    // 40からの-1/tickなので、21tick（5時間15分）で安全域へ落ちる。
    tick(21);

    expect(monkey.readProperty(warinessId)?.alert, '待てば落ち着く').toBe('safe');
  });

  it('尖った石をサルへ重ねると殴れて、裂傷が1つ刺さる', () => {
    const stone = strikeWithSharpStone();

    expect(injuriesOf(monkey), '傷は動物のinjuriesスロットへ入る').toEqual(['laceration']);
    expect(stone.parent, '武器は手元に残る').toBe(player);
    expect(session.world!.totalMinutes, 'durationの15分が経つ').toBe(15);
  });

  it('殴れば警戒が上がり、刃も摩耗する', () => {
    const before = monkey.getNumber(warinessId);

    const stone = strikeWithSharpStone();

    // 上げるのは25だが、殴るのに15分＝1tickかかるぶんの落ち着き（-1/tick）が同時に起きる。
    expect(monkey.getNumber(warinessId) - before).toBe(25 - 1);
    expect(stone.readProperty(codex.propertyNames.getId('durability'))?.value).toBe(960 - 20);
  });

  it('外した回は傷が付かないが、警戒と摩耗はそのまま起きる', () => {
    // 当たり外れによらない分を各候補へ複製している（animals.yaml、issue #415）ので、外れた側でも
    // 抜けていないことを確かめる。
    open(MISSES);
    const before = monkey.getNumber(warinessId);

    const stone = strikeWithSharpStone();

    expect(injuriesOf(monkey), '外れれば傷は付かない').toEqual([]);
    expect(monkey.getNumber(warinessId) - before, '殴られたこと自体で気は立つ').toBe(25 - 1);
    expect(stone.readProperty(codex.propertyNames.getId('durability'))?.value).toBe(960 - 20);
  });

  it('当たった回も外した回も、殴られた側の札の上で起きたことを告げる', () => {
    // 当たった傷は押して開くinjuriesスロットへ入り、外した回は世界の形が何も変わらないため、
    // どちらもレーンを見ているだけでは分からない（HuntingSystem.md 6.3節）。
    expect(signalsOf(strikeWithSharpStone)).toEqual(['monkey: hit']);

    open(MISSES);

    expect(signalsOf(strikeWithSharpStone)).toEqual(['monkey: missed']);
  });

  it('一撃で気を失い、時間をかけて戻る', () => {
    // 狩りの決着は死ではなく気絶で付く（VitalsSystem.md 5節）ので、殴った瞬間に効く必要がある。
    // 石1つでもサルの体格（shockのmax=100）には一撃。
    expect(consciousness(), '殴る前ははっきりしている').toEqual({ value: 100, alert: 'safe' });

    strikeWithSharpStone();

    // 効果は時間が経ち切ってから適用される（ActionSystem.md 2節）ので、殴ったぶんはtickで引かれない。
    expect(monkey.getNumber(shockId), '衝撃はaddで即座に立つ').toBe(80);
    expect(consciousness(), 'reelingの-80と痛みの-20で底を打つ（unconsciousの段）').toEqual({
      value: 0,
      alert: 'danger',
    });

    // -4/tickで引く。60まで下がるとreeling（-80）を抜け、rattled（-30）と痛み（-20）だけが残る。
    tick(5);

    expect(consciousness(), '気絶からは45分で覚める（dazedの段）').toEqual({ value: 50, alert: 'caution' });

    // 28まで引けばsteadyへ。残るのは痛みの-20だけで、意識ははっきりした域へ戻る。
    tick(8);

    expect(monkey.getNumber(shockId)).toBe(28);
    expect(consciousness(), '残るのは痛みの-20だけ（clearの段）').toEqual({ value: 80, alert: 'safe' });
  });

  it('痛みも意識を下げるが、痛みだけでは気絶しない', () => {
    // 寄与元は段が持つ（VitalsSystem.md 2節）。深手を2つ負えば痛みは耐えがたい域に入り、
    // それでも朦朧に留まる——気絶させるのは衝撃の側。
    strikeWithSharpStone();
    strikeWithSharpStone();
    tick(20); // 衝撃だけを引かせる（傷はまだ残る）。

    expect(monkey.getNumber(shockId), '衝撃は引き切っている').toBe(20);
    expect(effective(painId), '裂傷2つで50+50').toBe(100);
    expect(consciousness(), '痛みが最も深くても朦朧に留まる（dazedの段）').toEqual({
      value: 100 - 45,
      alert: 'caution',
    });
  });

  describe('出血', () => {
    /** 傷1つが固まるまでに失う血（-15/tick × 4 tick、injuries.yaml）。 */
    const LOST_PER_WOUND = 60;

    let bloodId: number;
    let bleedingId: number;

    beforeAll(() => {
      bloodId = codex.propertyNames.getId('blood');
      bleedingId = codex.propertyNames.getId('bleeding');
    });

    /** 今サルに刺さっている傷のうち最初の1つ。 */
    function firstWound(): WorldObject {
      return monkey.tryGetSlot(codex.slotNames.getId('injuries'))!.contents[0];
    }

    it('傷は血を流し、放っておいても固まって止まる', () => {
      // 出血は傷の重さとは別の時間で動く（VitalsSystem.md 4節）。severityの段で表すと、傷が治る
      // まで何日も流れ続けることになる。
      strikeWithSharpStone();
      expect(monkey.getNumber(bloodId), '殴った時点ではまだ失っていない').toBe(400);
      expect(firstWound().getNumber(bleedingId)).toBe(100);

      tick(4);

      expect(firstWound().getNumber(bleedingId), '1時間で固まる').toBe(0);
      expect(monkey.getNumber(bloodId)).toBe(400 - LOST_PER_WOUND);

      tick(100);

      expect(monkey.getNumber(bloodId), '固まった後はもう減らない').toBe(400 - LOST_PER_WOUND);
      expect(injuriesOf(monkey), '血が止まっても傷そのものは残る').toEqual(['laceration']);
    });

    it('同じ傷でも、体格が小さいほどよく効く', () => {
      // 出血のレートは傷の側が持ち、相手の大きさを知らない（injuries.yaml）。ヒトの5,000mLには
      // 響かない60mLが、サルの400mLには1割半に当たる。
      strikeWithSharpStone();
      tick(4);

      expect(monkey.readProperty(bloodId)!.ratio, '1回の裂傷で1割半を失う').toBeCloseTo(0.85, 2);
    });

    it('衝撃が引いても、失った血が意識を奪い続ける', () => {
      // 気絶させるのは衝撃だが、そちらは自分で引く（2.1節）。失った血は戻らないので、
      // **目覚めるはずの時刻を過ぎても倒れたまま**になる。
      strikeWithSharpStone();
      strikeWithSharpStone();
      strikeWithSharpStone();
      tick(24);

      expect(monkey.getNumber(shockId), '衝撃は引き切っている').toBe(4);
      expect(monkey.getNumber(bloodId), '3つぶん失った').toBe(400 - 3 * LOST_PER_WOUND);
      expect(monkey.readProperty(bloodId)?.alert, '危険域').toBe('danger');
      expect(monkey.isInStage(consciousnessId, 'unconscious'), '目覚めない').toBe(true);
    });

    it('血が尽きれば、その枠のまま死体になる', () => {
      // 仕留めの一撃（HuntingSystem.md 1.4節）と同じ置き換えだが、こちらは**逃げられた個体が後で倒れる道**。
      for (let i = 0; i < 8; i++) strikeWithSharpStone();
      expect(itemsInJungle(), '殴っただけではまだ生きている').toEqual(['monkey']);

      tick(2);

      expect(itemsInJungle()).toEqual(['monkey_carcass']);
      expect(monkey.parent, '失血死した個体は世界から出る').toBeUndefined();
    });

    it('包帯を当てれば失う血は減るが、ゼロにはならない', () => {
      // 包帯はhemostaticタグを持たないので出血のゲートは閉じない。固まるのを早めるだけで、
      // 止血帯（未実装）との差がここに出る（InjurySystem.md 3.1節）。
      strikeWithSharpStone();
      const bandage = spawnInto('bandage', player, 'hand');
      expect(bandage.moveToSlot(firstWound(), codex.slotNames.getId('treatment'))).toBeUndefined();

      tick(4);

      expect(monkey.getNumber(bloodId), '固まるのが倍速なので失うのは半分').toBe(400 - LOST_PER_WOUND / 2);
    });
  });

  it('気を失っている相手は仕留められる', () => {
    // 仕留めは怪我にしない（残らないものだから、InjurySystem.md 4節）。pickの候補が直接、
    // 死体へ置き換える（HuntingSystem.md 1.4節）。
    open(KILLS_IF_HELPLESS);
    strikeWithSharpStone();

    expect(itemsInJungle(), '1発目は当たるだけ').toEqual(['monkey']);
    expect(monkey.isInStage(consciousnessId, 'unconscious'), '気を失っている').toBe(true);

    const killed = signalsOf(strikeWithSharpStone);

    expect(itemsInJungle(), 'その枠のまま死体へ置き換わる').toEqual(['monkey_carcass']);
    expect(killed).toEqual(['monkey: killed']);
    expect(monkey.parent, '仕留めた個体は世界から出る').toBeUndefined();
  });

  it('起きている相手でも、まれに仕留まる', () => {
    // 無防備さは起きていても0にしない——暴れる相手でも急所へ入ることはある。
    open(LUCKY_KILL);

    strikeWithSharpStone();

    expect(itemsInJungle()).toEqual(['monkey_carcass']);
  });

  it('殴られ続ければ危険域まで気が立つ', () => {
    // 段はワールド側の宣言なので、しきい値を刻み直したらここで落ちる。**外した回で確かめる**——
    // 当たると気を失い、その間は警戒が打ち消される（次のテスト）ため。
    open(MISSES);

    strikeWithSharpStone();
    expect(monkey.readProperty(warinessId)?.alert, '1発では警戒のまま').toBe('caution');

    strikeWithSharpStone();

    expect(monkey.readProperty(warinessId)?.alert).toBe('danger');
  });

  it('気を失っている間は警戒が消え、目覚めれば戻る', () => {
    // 気絶した動物は放っておいてよい相手なので、縁の明滅（CardView.md 3節）を止める。気絶そのものは
    // カードの覆いが言う（同 9.1節）——UIはunconsciousの段の名前だけを読む。
    strikeWithSharpStone();

    expect(monkey.getNumber(warinessId), '警戒そのものは上がっている').toBe(40 + 25 - 1);
    expect(monkey.readProperty(warinessId)?.value, '気絶が打ち消すので実効値は0').toBe(0);
    expect(monkey.readProperty(warinessId)?.alert, '縁は明滅しない').toBe('safe');
    expect(monkey.isInStage(consciousnessId, 'unconscious'), '覆いを出す段に居る').toBe(true);
    expect(injuriesOf(monkey), '同じ個体なので傷は残る').toEqual(['laceration']);

    tick(13);

    expect(monkey.isInStage(consciousnessId, 'unconscious'), '目覚めれば覆いは消える').toBe(false);
    expect(monkey.readProperty(warinessId)?.alert, '警戒も戻る').toBe('caution');
  });

  it('負わせた傷は時間で治り、治りきれば消える', () => {
    // 手負いの動物を追う時限（HuntingSystem.md 3節）が、怪我の側の自然治癒だけで成り立つ。
    strikeWithSharpStone();

    tick(479);
    expect(injuriesOf(monkey), '治りきる手前ではまだ残っている').toEqual(['laceration']);

    tick(1);

    expect(injuriesOf(monkey)).toEqual([]);
  });

  it('動物の傷は、キャラクタの怪我と同じ物である', () => {
    // 同じ定義を両方へ刺す（HuntingSystem.md 3節）。痛みも動物が持つ（VitalsSystem.md 7節）ので、
    // 怪我が宣言している痛みへの寄与はそのまま届く——怪我の側は相手を選ばない。
    strikeWithSharpStone();
    const wound = monkey.tryGetSlot(codex.slotNames.getId('injuries'))!.contents[0];

    expect(wound.def.tags).toContain(codex.tagNames.getId('injury'));
    expect(wound.readProperty(codex.propertyNames.getId('severity'))?.ratio).toBe(1);
    expect(effective(codex.propertyNames.getId('pain')), '傷の痛みが届く').toBe(50);

    expect(
      wound.moveToSlot(jungle, codex.slotNames.getId('items')),
      '負った本人から剥がせない（bound_to_owner）',
    ).toContain('離せません');
  });

  it('傷は押して開ける主要なスロットに入るので、カードを開けば並ぶ', () => {
    // キャラクタの怪我と同じ見え方にするための宣言（HuntingSystem.md 3節）。
    const def = codex.objects.get(codex.objectNames.getId('monkey'));

    expect(def.mainItemSlotGlobalId).toBe(codex.slotNames.getId('injuries'));
  });

  it('武器でない物を重ねても殴れない', () => {
    const stone = spawnInto('stone', player, 'hand');

    expect(monkey.findMatchingCombinations(stone), '素手の石はweaponタグを持たない').toEqual([]);
  });
});
