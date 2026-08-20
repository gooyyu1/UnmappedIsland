import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * animals.yamlの動物を、実ファイルの定義だけで検証する（docs/engine/HuntingSystem.md・
 * docs/world/Animals.md）。武器で殴る→怪我が刺さる→警戒が上がる→時間で引く、の一巡を通す。
 */
describe('animals.yamlの動物', () => {
  // strikeの候補は宣言順に「強打・浅打・刺突・外し・仕留め」（animals.yamlのbeast trait）で、
  // どれを引くかは武器が宣言する重み配分（tools.yaml）が決める。だから同じ引きでも、掴んだ札に
  // よって当たる候補が変わる。無防備さ（仕留めの重み）は起きていれば5、気を失っていれば205。
  /** 当てる引き。尖った石なら浅打、石斧なら強打、槍なら刺突になる。 */
  const LANDS = 0.2;
  /** 起きている相手を外す引き。 */
  const WHIFFS = 0.8;
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
  let bloodId: number;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    warinessId = codex.propertyNames.getId('wariness');
    painId = codex.propertyNames.getId('pain');
    shockId = codex.propertyNames.getId('shock');
    consciousnessId = codex.propertyNames.getId('consciousness');
    bloodId = codex.propertyNames.getId('blood');
  });

  beforeEach(() => {
    open(LANDS);
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

  /** 武器を手に持たせ、それを相手のカードへ重ねて殴る。返すのは使った武器。 */
  function strikeWith(weaponName: string, target: WorldObject = monkey): WorldObject {
    const weapon = spawnInto(weaponName, player, 'hand');
    expect(target.tryExecuteCombination(weapon, undefined, 'strike')).toBe(true);
    return weapon;
  }

  /** 尖った石をサルへ重ねて殴る。 */
  function strikeWithSharpStone(): WorldObject {
    return strikeWith('sharp_stone');
  }

  function tick(count: number, animal: WorldObject = monkey): void {
    for (let i = 0; i < count; i++) animal.tick();
  }

  /** 今の実効値（modifyの寄与を加味した、画面に出るのと同じ値）。 */
  const effective = (propertyGlobalId: number): number | undefined =>
    monkey.tryGetProperty(propertyGlobalId)?.getEffectiveValue();

  /** 今のサルの意識（実効値と域）。痛み・衝撃の寄与が合流した後の姿で、カードのバーに出るのと同じ。 */
  function consciousness(): { value: number; alert: string } {
    const property = monkey.tryGetProperty(consciousnessId)!;
    return { value: property.getEffectiveValue(), alert: property.alert };
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
    expect(monkey.tryGetProperty(warinessId)?.alert, '現れた時点で安全域ではない').not.toBe('safe');
    expect(monkey.tryGetProperty(warinessId)?.def.worsensUpward, '増えるほど悪い').toBe(true);

    // 40からの-1/tickなので、21tick（5時間15分）で安全域へ落ちる。
    tick(21);

    expect(monkey.tryGetProperty(warinessId)?.alert, '待てば落ち着く').toBe('safe');
  });

  it('尖った石をサルへ重ねると殴れて、裂傷が1つ刺さる', () => {
    const stone = strikeWithSharpStone();

    expect(injuriesOf(monkey), '傷は動物のinjuriesスロットへ入る').toEqual(['laceration']);
    expect(stone.parent, '武器は手元に残る').toBe(player);
    expect(session.world!.totalMinutes, 'durationの15分が経つ').toBe(15);
  });

  it('殴れば警戒が上がり、刃も摩耗する', () => {
    const before = monkey.tryGetProperty(warinessId)?.number ?? 0;

    const stone = strikeWithSharpStone();

    // 上げるのは25だが、殴るのに15分＝1tickかかるぶんの落ち着き（-1/tick）が同時に起きる。
    expect((monkey.tryGetProperty(warinessId)?.number ?? 0) - before).toBe(25 - 1);
    expect(stone.tryGetProperty(codex.propertyNames.getId('durability'))?.getEffectiveValue()).toBe(960 - 20);
  });

  it('外した回は傷が付かないが、警戒と摩耗はそのまま起きる', () => {
    // 当たり外れによらない分（警戒・摩耗）を各候補が持つ（animals.yaml）ので、外れた側でも
    // 抜けていないことを確かめる。
    open(WHIFFS);
    const before = monkey.tryGetProperty(warinessId)?.number ?? 0;

    const stone = strikeWithSharpStone();

    expect(injuriesOf(monkey), '外れれば傷は付かない').toEqual([]);
    expect((monkey.tryGetProperty(warinessId)?.number ?? 0) - before, '殴られたこと自体で気は立つ').toBe(
      25 - 1,
    );
    expect(stone.tryGetProperty(codex.propertyNames.getId('durability'))?.getEffectiveValue()).toBe(960 - 20);
  });

  it('どんな一撃が入ったかを、殴られた側の札の上で告げる', () => {
    // 当たった傷は押して開くinjuriesスロットへ入り、外した回は世界の形が何も変わらないため、
    // どちらもレーンを見ているだけでは分からない（HuntingSystem.md 6.3節）。**武器ごとに違う語を
    // 告げる**ので、なぜ倒れないのかが札の上で読める。
    expect(signalsOf(() => strikeWith('sharp_stone'))).toEqual(['monkey: grazed']);

    open(LANDS);
    expect(signalsOf(() => strikeWith('stone_axe'))).toEqual(['monkey: hit']);

    open(LANDS);
    expect(signalsOf(() => strikeWith('spear'))).toEqual(['monkey: pierced']);

    // 殴るのに15分＝1tickかかるので、同じ回にサルの1手も入る（同2節）。手番は効果より先に回る
    // （時間を進めてから効果を適用する、ActionSystem.md 2節）ので、告げられる順も1手が先になる。
    open(WHIFFS);
    expect(signalsOf(() => strikeWith('sharp_stone'))).toEqual(['monkey: bit', 'monkey: missed']);
  });

  describe('体格と武器', () => {
    /** その動物を密林へ置いて返す。 */
    function spawnAnimal(name: string): WorldObject {
      return spawnInto(name, jungle, 'items');
    }

    /** 気を失っているか（VitalsSystem.md 6節の段）。 */
    function isDown(animal: WorldObject): boolean {
      return animal.tryGetProperty(consciousnessId)?.isInStage('unconscious') ?? false;
    }

    it('小動物は、尖った石でも一撃で沈む', () => {
      // 衝撃のmaxが体格（体重の1/50）なので、浅い一撃（30）でも80gのネズミ・1kgのヤケイでは
      // 振り切れる。**武器の側は相手の大きさを知らない**——同じ30が体格で意味を変える。
      const rat = spawnAnimal('rat');
      const junglefowl = spawnAnimal('junglefowl');

      strikeWith('sharp_stone', rat);
      strikeWith('sharp_stone', junglefowl);

      expect(isDown(rat), 'ネズミは一撃').toBe(true);
      expect(isDown(junglefowl), 'ヤケイも一撃').toBe(true);
    });

    it('中型は、尖った石では3撃かかり、石斧なら一撃で沈む', () => {
      // 上位の武器の存在価値がここに出る。石は浅打（30）しか持たないので、5kgのサル（気絶は70）
      // には溜めて3撃。石斧の強打（250）は一撃で振り切る。
      strikeWithSharpStone();
      expect(isDown(monkey), '1撃目では沈まない').toBe(false);
      strikeWithSharpStone();
      expect(isDown(monkey), '2撃目でも沈まない').toBe(false);

      strikeWithSharpStone();

      expect(monkey.tryGetProperty(shockId)?.number ?? 0, '30ずつ足し、1tickごとに4引く').toBe(
        30 * 3 - 4 * 2,
      );
      expect(isDown(monkey), '3撃目で沈む').toBe(true);

      open(LANDS);

      strikeWith('stone_axe');

      expect(isDown(monkey), '石斧なら一撃').toBe(true);
    });

    it('大型は石斧でも4撃かかり、尖った石では衝撃が溜まらない', () => {
      // 60kgのイノシシは衝撃のmaxがサルの12倍（1200、気絶は840）。**引く速さも体格に比例する**
      // ので、浅打（30）は溜まる前に引いてしまう——弱い武器で殴り続けても倒せない。
      const boar = spawnAnimal('wild_boar');

      for (let i = 0; i < 3; i++) strikeWith('stone_axe', boar);
      expect(isDown(boar), '3撃目までは立っている').toBe(false);

      strikeWith('stone_axe', boar);

      expect(isDown(boar), '4撃目で沈む').toBe(true);

      open(LANDS);
      const untouched = spawnAnimal('wild_boar');

      for (let i = 0; i < 10; i++) strikeWith('sharp_stone', untouched);

      expect(untouched.tryGetProperty(shockId)?.number ?? 0, '足す30より引く48のほうが大きい').toBe(30);
      expect(isDown(untouched), '尖った石では何撃当てても沈まない').toBe(false);
    });

    it('槍は沈められないが、刺し傷から血が抜けて倒れる', () => {
      // 槍の一撃は衝撃をほとんど生まないので、その場では倒れない（HuntingSystem.md 1.2節の
      // 「急所寄り」）。代わりに刺し傷が-250/tickで血を奪い、400mLのサルは2tickで尽きる。
      strikeWith('spear');

      expect(injuriesOf(monkey), '裂傷ではなく刺し傷が刺さる').toEqual(['puncture_wound']);
      expect(isDown(monkey), '突かれてもその場では倒れない').toBe(false);

      tick(1);
      expect(itemsInJungle(), '1tickではまだ生きている').toEqual(['monkey']);

      tick(1);

      expect(itemsInJungle(), '2tick（30分）で血が尽きて死体になる').toEqual(['monkey_carcass']);
    });

    it('大型に槍で届くのは、深手を重ねて血を奪うから', () => {
      // 4,600mLのイノシシに裂傷1つ（60mL）は響かないが、刺し傷は1つで800mL——4突きで危機域へ落ち、
      // 失った血が意識を奪う（VitalsSystem.md 3節）。**衝撃ではなく血で決着する道**。
      const boar = spawnAnimal('wild_boar');

      for (let i = 0; i < 4; i++) strikeWith('spear', boar);
      tick(4, boar);

      expect(boar.tryGetProperty(bloodId)?.alert, '致命的域まで失う').toBe('fatal');
      expect(isDown(boar), '血を失って倒れる').toBe(true);
    });
  });

  it('一撃で気を失った相手は、時間をかけて戻る', () => {
    // 狩りの決着は死ではなく気絶で付く（VitalsSystem.md 5節）ので、殴った瞬間に効く必要がある。
    expect(consciousness(), '殴る前ははっきりしている').toEqual({ value: 100, alert: 'safe' });

    strikeWith('stone_axe');

    // 効果は時間が経ち切ってから適用される（ActionSystem.md 2節）ので、殴ったぶんはtickで引かれない。
    // 250はサルの体格（max 100）を越えるので、そこで頭打ちになる。
    expect(monkey.tryGetProperty(shockId)?.number ?? 0, '衝撃はaddで即座に立ち、体格で頭打ちになる').toBe(
      100,
    );
    expect(consciousness(), 'reelingの-80と痛みの-20で底を打つ（unconsciousの段）').toEqual({
      value: 0,
      alert: 'danger',
    });

    // -4/tickで引く。60まで下がるとreeling（-80）を抜け、rattled（-30）と痛みの-20だけが残る。
    tick(10);

    expect(consciousness(), '気絶からは2時間半で覚める（dazedの段）').toEqual({
      value: 50,
      alert: 'caution',
    });

    // 28まで引けばsteadyへ。残るのは痛みの-20だけで、意識ははっきりした域へ戻る。
    tick(8);

    expect(monkey.tryGetProperty(shockId)?.number ?? 0).toBe(28);
    expect(consciousness(), '残るのは痛みの-20だけ（clearの段）').toEqual({ value: 80, alert: 'safe' });
  });

  it('痛みも意識を下げるが、痛みだけでは気絶しない', () => {
    // 寄与元は段が持つ（VitalsSystem.md 2節）。深手を2つ負えば痛みは耐えがたい域に入り、
    // それでも朦朧に留まる——気絶させるのは衝撃の側。
    strikeWithSharpStone();
    strikeWithSharpStone();
    tick(20); // 衝撃だけを引かせる（傷はまだ残る）。

    expect(monkey.tryGetProperty(shockId)?.number ?? 0, '衝撃は引き切っている').toBe(0);
    expect(effective(painId), '裂傷2つで50+50').toBe(100);
    expect(consciousness(), '痛みが最も深くても朦朧に留まる（dazedの段）').toEqual({
      value: 100 - 45,
      alert: 'caution',
    });
  });

  describe('出血', () => {
    /** 傷1つが固まるまでに失う血（-15/tick × 4 tick、injuries.yaml）。 */
    const LOST_PER_WOUND = 60;
    /** 自然回復（animals.yaml）。出血と同時に走るので、失う量からわずかに差し引かれる。 */
    const RECOVERED_PER_TICK = 0.16;

    let bleedingId: number;

    beforeAll(() => {
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
      expect(monkey.tryGetProperty(bloodId)?.number ?? 0, '殴った時点ではまだ失っていない').toBe(400);
      expect(firstWound().tryGetProperty(bleedingId)?.number ?? 0).toBe(100);

      tick(4);

      expect(firstWound().tryGetProperty(bleedingId)?.number ?? 0, '1時間で固まる').toBe(0);
      const afterClotting = monkey.tryGetProperty(bloodId)?.number ?? 0;
      expect(afterClotting).toBeCloseTo(400 - LOST_PER_WOUND + 4 * RECOVERED_PER_TICK, 5);

      tick(100);

      // 削るのは一瞬でも戻るのは桁違いに遅い（VitalsSystem.md 3節）——1日かけて16mLしか戻らない。
      expect(
        (monkey.tryGetProperty(bloodId)?.number ?? 0) - afterClotting,
        '止まった後は少しずつ戻る',
      ).toBeCloseTo(100 * RECOVERED_PER_TICK, 5);
      expect(injuriesOf(monkey), '血が止まっても傷そのものは残る').toEqual(['laceration']);
    });

    it('同じ傷でも、体格が小さいほどよく効く', () => {
      // 出血のレートは傷の側が持ち、相手の大きさを知らない（injuries.yaml）。ヒトの5,000mLには
      // 響かない60mLが、サルの400mLには1割半に当たる。
      strikeWithSharpStone();
      tick(4);

      expect(monkey.tryGetProperty(bloodId)!.ratio, '1回の裂傷で1割半を失う').toBeCloseTo(0.85, 2);
    });

    it('衝撃が引いても、失った血が意識を奪い続ける', () => {
      // 気絶させるのは衝撃だが、そちらは自分で引く（2.1節）。血の戻りは桁違いに遅いので、
      // **目覚めるはずの時刻を過ぎても倒れたまま**になる。
      strikeWithSharpStone();
      strikeWithSharpStone();
      strikeWithSharpStone();
      tick(24);

      expect(monkey.tryGetProperty(shockId)?.number ?? 0, '衝撃は引き切っている').toBe(0);
      expect(monkey.tryGetProperty(bloodId)?.number ?? 0, '3つぶん失った').toBeLessThan(
        400 - 3 * LOST_PER_WOUND + 5,
      );
      expect(monkey.tryGetProperty(bloodId)?.alert, '危険域').toBe('danger');
      expect(monkey.tryGetProperty(consciousnessId)?.isInStage('unconscious') ?? false, '目覚めない').toBe(
        true,
      );
    });

    it('血が尽きれば、その枠のまま死体になる', () => {
      // 仕留めの一撃（HuntingSystem.md 1.4節）と同じ置き換えで、**同じon_minが受ける**。
      // こちらは殴り続けて失血させる道。
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

      expect(monkey.tryGetProperty(bloodId)?.number ?? 0, '固まるのが倍速なので失うのは半分').toBeCloseTo(
        400 - LOST_PER_WOUND / 2 + 4 * RECOVERED_PER_TICK,
        5,
      );
    });
  });

  it('気を失っている相手は仕留められる', () => {
    // 仕留めは怪我にしない（残らないものだから、InjurySystem.md 4節）。pickの候補が血を空にし、
    // bloodのon_minが死体へ置き換える（HuntingSystem.md 1.4節）。
    open(KILLS_IF_HELPLESS);
    strikeWith('stone_axe');

    expect(itemsInJungle(), '1発目は当たるだけ').toEqual(['monkey']);
    expect(monkey.tryGetProperty(consciousnessId)?.isInStage('unconscious') ?? false, '気を失っている').toBe(
      true,
    );

    const killed = signalsOf(() => strikeWith('stone_axe'));

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

  describe('死体の解体', () => {
    /** 気を失わせてから仕留めて、その場に残った死体を返す。 */
    function kill(): WorldObject {
      open(KILLS_IF_HELPLESS);
      strikeWith('stone_axe');
      strikeWith('stone_axe');
      return jungle.tryGetSlot(codex.slotNames.getId('items'))!.contents[0];
    }

    /** 刃物を手に取り、死体へ重ねて解体する。 */
    function butcher(carcass: WorldObject): WorldObject {
      const knife = spawnInto('sharp_stone', player, 'hand');
      expect(carcass.tryExecuteCombination(knife, player, 'butcher')).toBe(true);
      return knife;
    }

    /** 今この土地のアイテムスロットに並ぶ物の重さ（g）。 */
    function weightsInJungle(): number[] {
      const weightId = codex.propertyNames.getId('weight');
      return jungle
        .tryGetSlot(codex.slotNames.getId('items'))!
        .contents.map((object) => object.tryGetProperty(weightId)?.number ?? 0);
    }

    it('刃物を死体へ重ねると、肉・骨・生皮に分かれる', () => {
      const carcass = kill();

      const knife = butcher(carcass);

      expect(itemsInJungle(), '死体が居た場所へ宣言順に並んで置き換わる').toEqual([
        'raw_meat',
        'raw_meat',
        'raw_meat',
        'raw_meat',
        'animal_bone',
        'rawhide',
      ]);
      expect(carcass.parent, '死体は世界から出る').toBeUndefined();
      expect(knife.parent, '刃物は手元に残る').toBe(player);
      expect(session.world!.totalMinutes - 30, 'durationの60分が経つ（殴った2回で30分）').toBe(60);
    });

    it('取り分の重さの合計は、死体より軽くなる', () => {
      // 血と内臓はカードにしない（animals.yamlの内訳、HuntingSystem.md 1.5節）ので、ヤシの実の連鎖と
      // 違って重さは保存しない。
      const carcass = kill();

      butcher(carcass);

      expect(weightsInJungle()).toEqual([500, 500, 500, 500, 500, 600]);
      expect(
        weightsInJungle().reduce((total, weight) => total + weight),
        '5000gのうち3100g',
      ).toBe(3100);
    });

    it('獲物が大きいほど、同じ物が多く取れる', () => {
      // 得られる素材は獲物の種類によらず同じで、大きさは個数が表す（HuntingSystem.md 1.5節）。
      // 12倍の体格から、12倍の枚数が出る。
      const boarCarcass = spawnInto('wild_boar_carcass', jungle, 'items');

      butcher(boarCarcass);

      const counts = new Map<string, number>();
      // 足元には生きたサルも居るので、解体で出た物だけを数える。
      for (const name of itemsInJungle().filter((name) => name !== 'monkey'))
        counts.set(name, (counts.get(name) ?? 0) + 1);
      expect(Object.fromEntries(counts)).toEqual({ raw_meat: 40, animal_bone: 6, rawhide: 6 });
    });

    it('刃物でない物を重ねても解体できない', () => {
      const carcass = kill();
      const stone = spawnInto('stone', player, 'hand');

      expect(carcass.combinationsWith(stone, player), '素手の石はcutting_toolタグを持たない').toEqual([]);
    });

    it('槍では解体できない', () => {
      // 穂先は柄の先に固定されていて皮を剥ぐ手つきにならない（tools.yaml）。狩れても捌けないので、
      // 刃物を別に持つ理由が残る。
      const carcass = kill();
      const spear = spawnInto('spear', player, 'hand');

      expect(carcass.combinationsWith(spear, player), '槍はcutting_toolタグを持たない').toEqual([]);
    });

    it('生肉は食べられる', () => {
      // 狩りが栄養に届く終端（docs/world/Animals.md 2節の肉の基準）。火がまだ無いので生のまま口へ入る。
      const carcass = kill();
      butcher(carcass);
      const meat = jungle.tryGetSlot(codex.slotNames.getId('items'))!.contents[0];
      const satietyId = codex.propertyNames.getId('satiety');
      const before = player.tryGetProperty(satietyId)?.number ?? 0;

      expect(meat.tryExecuteAction('eat', player)).toBe(true);

      // 食べるのに15分かかり、時間は効果より先に進む（actionTime参照）ので、その1 tickぶん
      // （satiety -16）が引かれた値になる。
      expect((player.tryGetProperty(satietyId)?.number ?? 0) - before, '1切れが腹に入るかさ').toBe(500 - 16);
      expect(meat.parent, '食べた肉は無くなる').toBeUndefined();
    });
  });

  it('殴られ続ければ危険域まで気が立つ', () => {
    // 段はワールド側の宣言なので、しきい値を刻み直したらここで落ちる。**外した回で確かめる**——
    // 当たると気を失い、その間は警戒が打ち消される（次のテスト）ため。
    open(WHIFFS);

    strikeWithSharpStone();
    expect(monkey.tryGetProperty(warinessId)?.alert, '1発では警戒のまま').toBe('caution');

    strikeWithSharpStone();

    expect(monkey.tryGetProperty(warinessId)?.alert).toBe('danger');
  });

  it('気を失っている間は警戒が消え、目覚めれば戻る', () => {
    // 気絶した動物は放っておいてよい相手なので、縁の明滅（CardView.md 3節）を止める。気絶そのものは
    // カードの覆いが言う（同 9.1節）——UIはunconsciousの段の名前だけを読む。
    strikeWith('stone_axe');

    expect(monkey.tryGetProperty(warinessId)?.number ?? 0, '警戒そのものは上がっている').toBe(40 + 25 - 1);
    expect(monkey.tryGetProperty(warinessId)?.getEffectiveValue(), '気絶が打ち消すので実効値は0').toBe(0);
    expect(monkey.tryGetProperty(warinessId)?.alert, '縁は明滅しない').toBe('safe');
    expect(
      monkey.tryGetProperty(consciousnessId)?.isInStage('unconscious') ?? false,
      '覆いを出す段に居る',
    ).toBe(true);
    expect(injuriesOf(monkey), '同じ個体なので傷は残る').toEqual(['laceration']);

    tick(18);

    expect(
      monkey.tryGetProperty(consciousnessId)?.isInStage('unconscious') ?? false,
      '目覚めれば覆いは消える',
    ).toBe(false);
    expect(monkey.tryGetProperty(warinessId)?.alert, '警戒も戻る').toBe('caution');
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
    expect(wound.tryGetProperty(codex.propertyNames.getId('severity'))?.ratio).toBe(1);
    expect(effective(codex.propertyNames.getId('pain')), '傷の痛みが届く').toBe(50);

    expect(
      wound.moveToSlot(jungle, codex.slotNames.getId('items')),
      '負った本人から剥がせない（bound_to_owner）',
    ).toContain('離せません');
  });

  it('傷もくわえた物も外から見えるので、カードを開けばタブに並ぶ', () => {
    // キャラクタの怪我と同じ見え方にするための宣言（HuntingSystem.md 3節）。
    const def = codex.objects.get(codex.objectNames.getId('monkey'));

    expect(def.visibleSlotGlobalIds).toEqual([
      codex.slotNames.getId('injuries'),
      codex.slotNames.getId('spoils'),
    ]);
  });

  it('武器でない物を重ねても殴れない', () => {
    const stone = spawnInto('stone', player, 'hand');

    expect(monkey.combinationsWith(stone, player), '素手の石はweaponタグを持たない').toEqual([]);
  });
});
