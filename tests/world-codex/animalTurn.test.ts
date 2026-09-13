import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { fixedRng } from '../support/rng';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import type { PropertyGlobalId } from '../../src/domain/GlobalId';
import type { WorldChange } from '../../src/domain/WorldChange';
import { lungeTargetsByInstance, vanishedInstances } from '../../src/game/view/changedInstances';

/**
 * 動物の1手（docs/engine/HuntingSystem.md 5節）を、実ファイルの定義だけで検証する。
 *
 * 時間が経つと何が起きるか——警戒しているかどうかで顔ぶれが変わり、動物ごとに配分が変わり、
 * 深手を負うほど逃げに転じる——を、密林とその隣の草原を繋いだ小さな世界で通す。
 */
describe('動物の1手', () => {
  /** 1手ぶんのゲーム内時間（minutes_per_tick、core.yaml）。 */
  const TICK_MINUTES = 15;

  let codex: WorldCodex;
  let session: WorldSession;
  let world: WorldObject;
  let jungle: WorldObject;
  let grassland: WorldObject;
  let player: WorldObject;

  let warinessId: PropertyGlobalId;
  let fleeId: PropertyGlobalId;
  let biteId: PropertyGlobalId;

  beforeAll(() => {
    codex = bundledCodex();
    warinessId = codex.propertyNames.getId('wariness');
    fleeId = codex.propertyNames.getId('flee');
    biteId = codex.propertyNames.getId('bite');
  });

  /**
   * 密林に立つプレイヤーから始める。rollは重み付き抽選（1手の候補も、その対象も）がどれを引くかを
   * 決める。道はまだ通していない——逃げ道が要る検証だけがopenPath()で通す。
   */
  function open(roll: number): void {
    session = new WorldSession(codex, undefined, fixedRng(roll));
    world = new WorldObject(0, codex.objects.get(codex.objectNames.getId('world')), session);
    session.adoptWorld(new World(world, codex));
    jungle = spawnInto('jungle', world, 'locations');
    grassland = spawnInto('grassland', world, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, jungle, 'characters');
  }

  /** 密林から草原へ抜ける、発見済みの道を1本通す。 */
  function openPath(): WorldObject {
    const path = spawnInto('path', jungle, 'fixtures');
    path
      .getProperty(codex.propertyNames.getId('destination_id'))
      .setNumberWithoutEvents(grassland.instanceId);
    return path;
  }

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  /** その動物を密林の足元へ置く。 */
  function release(name: string): WorldObject {
    return spawnInto(name, jungle, 'items');
  }

  /**
   * その動物を警戒した姿にする。**現れたときの警戒は獣ごとに違う**（animals.yaml）ので、
   * 「警戒していれば何をするか」を見る検証は、種の初期値に頼らず自分で立てる——イノシシは
   * 落ち着いた姿で現れる唯一の獣なので、素のままでは攻め手も逃走も抽選に出ない。
   */
  function alarm(animal: WorldObject): WorldObject {
    animal.getProperty(warinessId).setNumberWithoutEvents(40);
    return animal;
  }

  /** その動物の1手の重み（実効値。押し引きを加味した、抽選が実際に見る値）。 */
  function weightOf(animal: WorldObject, propertyName: string): number {
    return animal.tryGetProperty(codex.propertyNames.getId(propertyName))?.getEffectiveValue() ?? 0;
  }

  /** 1手ぶんの時間を進める。手番を配るのはtickの後処理（WorldSession.advanceWorldTime）。 */
  function passTurn(count = 1): void {
    session.advanceWorldTime(TICK_MINUTES * count);
  }

  /** その物に刺さっている怪我の識別子。 */
  function injuriesOf(target: WorldObject): string[] {
    const slot = target.tryGetSlot(codex.slotNames.getId('injuries'));
    return slot === undefined ? [] : slot.contents.map((object) => object.def.name);
  }

  /** その動物がくわえている物の識別子。 */
  function spoilsOf(animal: WorldObject): string[] {
    const slot = animal.tryGetSlot(codex.slotNames.getId('spoils'));
    return slot === undefined ? [] : slot.contents.map((object) => object.def.name);
  }

  /** 今この土地のアイテムスロットに並んでいる物の識別子。 */
  function itemsIn(location: WorldObject): string[] {
    return location.tryGetSlot(codex.slotNames.getId('items'))!.contents.map((object) => object.def.name);
  }

  it('落ち着いている動物は、襲いも逃げもしない', () => {
    // 警戒していない間は攻撃と逃走の重みが打ち消される（animals.yamlのbeast trait）。足元に物も
    // 無いので、残る候補は様子見だけになる。
    open(0.5);
    openPath();
    const monkey = release('monkey');
    monkey.getProperty(warinessId).setNumberWithoutEvents(0);

    passTurn(4);

    expect(monkey.parent, 'その場を動かない').toBe(jungle);
    expect(injuriesOf(player), '襲ってこない').toEqual([]);
  });

  it('警戒したネズミは、道があれば隣の土地へ逃げる', () => {
    // 逃走が配分の8割を占める（animals.yaml）。ネズミは警戒した姿で現れる（現れたときの警戒は
    // 獣ごとに違う、HuntingSystem.md 3.1節）ので、置いた次の手番から逃げにかかる。
    open(0.5);
    openPath();
    const rat = release('rat');

    passTurn();

    expect(rat.parent, '道の行き先へ移る').toBe(grassland);
    expect(itemsIn(jungle), '密林からは居なくなる').toEqual([]);
  });

  it('追い詰められたネズミは、逃げずに噛みつく', () => {
    // 逃げ道が無ければ逃走の重みが抽選から外れる（HuntingSystem.md 5.3節）。専用の条件を1つも
    // 書かずに「追い詰められた獣は反撃する」が成立する。
    open(0.9);
    const rat = release('rat');

    passTurn();

    expect(rat.parent, '逃げ道が無いので動かない').toBe(jungle);
    expect(injuriesOf(player)).toEqual(['bite_wound']);
  });

  it('サルは足元の物をくわえ、倒せば地面へ戻る', () => {
    // 持ち去りだけは取り返しが付く（docs/world/Animals.md 4.1節）。くわえた物は動物の中に居るので、
    // 倒せば中身として地面へこぼれる（9.3節）。
    open(0.5);
    const monkey = release('monkey');
    monkey.getProperty(warinessId).setNumberWithoutEvents(0);
    const coconut = release('coconut');

    passTurn();

    expect(spoilsOf(monkey), 'くわえた物は動物の中へ移る').toEqual(['coconut']);
    expect(itemsIn(jungle), '地面からは無くなる').toEqual(['monkey']);

    monkey.destroy();

    expect(coconut.parent, '倒せば地面へこぼれる').toBe(jungle);
  });

  it('サルは、既に1つくわえていれば次を持ち去らない', () => {
    open(0.5);
    const monkey = release('monkey');
    monkey.getProperty(warinessId).setNumberWithoutEvents(0);
    release('coconut');
    release('coconut');

    passTurn(3);

    expect(spoilsOf(monkey), 'くわえられるのは1つだけ').toEqual(['coconut']);
    expect(itemsIn(jungle)).toEqual(['monkey', 'coconut']);
  });

  it('イノシシは足元の物を壊し、中身は地面に散らばる', () => {
    // 壊しうる物だけが候補になる（fragileタグ、HuntingSystem.md 5.4節）。置いておいた道具まで
    // 一撃で消えることはない。
    open(0.5);
    const boar = release('wild_boar');
    boar.getProperty(warinessId).setNumberWithoutEvents(0);
    const basket = release('woven_basket');
    const stone = release('sharp_stone');
    expect(stone.moveToSlotOrRejection(basket.getSlot(codex.slotNames.getId('contents')))).toBeUndefined();

    passTurn();

    expect(basket.parent, '編み籠は壊れて消える').toBeUndefined();
    expect(stone.parent, '中身は地面に散らばる').toBe(jungle);
  });

  it('警戒したイノシシは牙で突き、その傷はこの島で最も血が流れる', () => {
    open(0.5);
    const boar = alarm(release('wild_boar'));

    passTurn();

    expect(injuriesOf(player)).toEqual(['gore_wound']);
    expect(boar.parent, '逃げ道が無いので居座る').toBe(jungle);
  });

  it('イノシシに圧し掛かられると骨を折り、荷が担げなくなる', () => {
    // 骨折を残すのは大型の獣の1手だけ（HuntingSystem.md 5節）。血ではなく動きを奪うので、
    // 傷の側に移動の規則を1行も書かずに「折れた脚では運べない」が出る（InjurySystem.md 5節）。
    //
    // 密林に居るイノシシの候補は様子見15・牙30・圧し掛かり10（足元に物も逃げ道も無いので、
    // 残りは抽選に出ない）。合計55のうち末尾の10を引くrollを渡す。
    open(0.9);
    const boar = alarm(release('wild_boar'));

    passTurn();

    expect(injuriesOf(player)).toEqual(['fracture']);
    expect(boar.parent, '突き飛ばした側はその場に残る').toBe(jungle);
    expect(
      player.tryGetProperty(codex.propertyNames.getId('load'))?.stage?.name,
      '空身でも荷を負っているのと同じになる',
    ).toBe('heavy');
  });

  it('小型の獣は、追い詰められても噛みつくだけで骨は折らない', () => {
    // 重みを立てるのは大型だけなので、小型では候補ごと抽選に出ない（HuntingSystem.md 5節）。
    // 「重い獣に踏まれたときだけ折れる」を、傷の側に「大型からしか出ない」と書かずに表している。
    // 上と同じrollを、逃げ道の無い密林に置いたネズミへ渡す。
    open(0.9);
    const rat = release('rat');

    passTurn();

    expect(injuriesOf(player), '重みを立てていない候補は引かれない').toEqual(['bite_wound']);
    expect(rat.tryGetProperty(codex.propertyNames.getId('crush'))?.getEffectiveValue() ?? 0).toBe(0);
  });

  it('深手を負うほど、逃走の重みが太くなる', () => {
    // 痛みの段が逃走の重みを押し上げる（animals.yamlのpain）。動物の種類によらない1箇所の宣言で、
    // 「傷めつければ逃げる」が全種類に効く。
    //
    // **重みが意味を持つのは手番を1つ回した後**——その場の状況（逃げ道の本数）を書き込むのは
    // 手番を与える側なので、置いた直後の値はまだ何も見ていない（5.2節）。引きは常に先頭の
    // 様子見になる0.0にして、動物をその場に留めたまま重みだけを読む。
    open(0.0);
    openPath();
    const monkey = release('monkey');

    passTurn();
    const base = monkey.tryGetProperty(fleeId)?.getEffectiveValue() ?? 0;

    wound(monkey);
    passTurn();
    const hurt = monkey.tryGetProperty(fleeId)?.getEffectiveValue() ?? 0;

    wound(monkey);
    passTurn();

    expect(base, '素の配分（animals.yamlのmonkey）').toBe(20);
    expect(hurt, '傷1つで痛みの段が上がる').toBeGreaterThan(base);
    expect(monkey.tryGetProperty(fleeId)?.getEffectiveValue() ?? 0, '深手ほどさらに太くなる').toBeGreaterThan(
      hurt,
    );
    expect(monkey.parent, '様子見を引き続けたので動いていない').toBe(jungle);
  });

  it('落ち着いていれば、逃走も攻撃も抽選から外れる', () => {
    // 打ち消しは重みが0でクランプされること（10節）で表す。実効値は負のままでよく、
    // 「起こらない」は抽選側が決める。
    open(0.0);
    openPath();
    const monkey = release('monkey');

    passTurn();

    expect(
      monkey.tryGetProperty(fleeId)?.getEffectiveValue() ?? 0,
      '警戒していれば逃げられる',
    ).toBeGreaterThan(0);
    expect(monkey.tryGetProperty(biteId)?.getEffectiveValue() ?? 0, '警戒していれば噛みつく').toBeGreaterThan(
      0,
    );

    monkey.getProperty(warinessId).setNumberWithoutEvents(0);
    passTurn();

    expect(monkey.tryGetProperty(fleeId)?.getEffectiveValue() ?? 0).toBeLessThanOrEqual(0);
    expect(monkey.tryGetProperty(biteId)?.getEffectiveValue() ?? 0).toBeLessThanOrEqual(0);
  });

  it('人の居ない土地では襲う手が抽選から外れる', () => {
    open(0.5);
    const goreId = codex.propertyNames.getId('gore');
    const boar = alarm(release('wild_boar'));

    passTurn();

    expect(injuriesOf(player), '同じ土地に居るうちは突かれる').toEqual(['gore_wound']);
    expect(boar.tryGetProperty(goreId)?.getEffectiveValue() ?? 0).toBeGreaterThan(0);

    expect(
      player.moveToSlotOrRejection(grassland.getSlot(codex.slotNames.getId('characters'))),
    ).toBeUndefined();
    for (let i = 0; i < 5; i++) passTurn();

    // **重みは配分のまま**（打ち消しの寄与は無い）。相手が1つも居ない候補が抽選に出ないのは、
    // amongが集合を見るからで、著者は「相手が居なければ起こらない」を書いていない（10.3節）。
    expect(boar.tryGetProperty(goreId)?.getEffectiveValue() ?? 0).toBeGreaterThan(0);
    expect(injuriesOf(player), '相手が居なければ、襲う候補は抽選に出ない').toEqual(['gore_wound']);
  });

  it('現れたときの警戒は獣ごとに違い、落ち着いた姿で現れるのはイノシシだけ', () => {
    // 全種が同じ姿勢で現れていたのを、獣ごとの値にした（HuntingSystem.md 3.1節、issue #1994）。
    // **初期値がそのまま「掴めるようになるまでの手数」**で、そこから19を引いたものが
    // 「近寄れる（落ち着く）までの手数」になる——減り方は獣によらず-1/tickだから。
    open(0.5);
    const wariness = new Map(
      ['rat', 'junglefowl', 'monkey', 'wild_boar'].map((name) => {
        const property = release(name).getProperty(warinessId);
        return [name, { value: property.number, stage: property.stage?.name }] as const;
      }),
    );
    const values = [...wariness.values()].map((seen) => seen.value);

    expect(new Set(values).size, 'どの2種も同じ値では現れない').toBe(values.length);
    expect(
      [...wariness].filter(([, seen]) => seen.stage === 'calm').map(([name]) => name),
      '落ち着いた姿で現れるのはイノシシだけ（人を恐れない）',
    ).toEqual(['wild_boar']);
    expect(Math.max(...values), 'いちばん長く落ち着かないのはネズミ').toBe(wariness.get('rat')?.value);
  });

  it('間合いのある武器を構えている間は、獣が踏み込む手が細る', () => {
    // 構えている側（tools.yamlのweapon trait）が土地へbraced_reachを立て、獣がそれを読む
    // （HuntingSystem.md 1.2節）。**武器はどんな獣が居るかを知らず、獣はどんな武器が在るかを
    // 知らない**——条件は入れ子のスロットを見られないので、土地が1つ挟まる。
    open(0.0);
    const boar = alarm(release('wild_boar'));
    const spear = release('spear');
    const hand = codex.slotNames.getId('hand');

    passTurn();

    expect(weightOf(boar, 'gore'), '地面に置いた槍は誰も構えていない').toBe(30);

    expect(spear.moveToSlotOrRejection(player.getSlot(hand))).toBeUndefined();
    passTurn();

    expect(weightOf(boar, 'gore'), '牙は3分の1まで細る').toBe(10);
    expect(weightOf(boar, 'crush'), '圧し掛かりは間合いの外へ出る').toBeLessThanOrEqual(0);

    // 70cmの柄は、牙の届く間合いの内側（tools.yamlのstone_axe）。
    expect(spear.moveToSlotOrRejection(jungle.getSlot(codex.slotNames.getId('items')))).toBeUndefined();
    expect(release('stone_axe').moveToSlotOrRejection(player.getSlot(hand))).toBeUndefined();
    passTurn();

    expect(weightOf(boar, 'gore'), '石斧を構えても間合いは取れない').toBe(30);
  });

  it('深手を負った獣は立ち去らず、傷が癒えるより先に膿んで倒れる', () => {
    // 立ち去りが先に来ると、逃げた獲物は傷があと何百手も残っている時点で消える（HuntingSystem.md
    // 5.6節、issue #1994で測った）。止めた結果、**追跡の窓を閉じるのは立ち去りではなく化膿**に
    // なる——獣は自分で傷を洗えない（injuries.yamlのwash）ので、深い傷は必ずそこへ行き着く。
    open(0.0);
    const stayId = codex.propertyNames.getId('stay_remaining');
    const boar = release('wild_boar');
    wound(boar);
    expect(
      player.moveToSlotOrRejection(grassland.getSlot(codex.slotNames.getId('characters'))),
    ).toBeUndefined();

    // 丸1日（96tick）の立ち去りを大きく越えても、裂傷はまだ半分も治っていない（480tick）。
    passTurn(200);

    expect(boar.parent, '痛む間はその土地に居る').toBe(jungle);
    expect(boar.tryGetProperty(stayId)?.getEffectiveValue() ?? 0, 'タイマーは減ってすらいない').toBe(96);

    // 傷が膿みきる（infectionがsepticへ届く）と、菌が血を削り始める。
    passTurn(280);

    expect(boar.parent, '立ち去ったのではなく倒れた').toBeUndefined();
    expect(itemsIn(jungle), '追いつけば、死体はその土地に残っている').toEqual(['wild_boar_carcass']);
  });

  it('浅い傷では立ち去りは止まらない', () => {
    // 線を引くのは痛みの段で、傷の数や種類ではない（HuntingSystem.md 5.6節）。生かす罠の打ち身は
    // sore に留まる（injuries.yamlのbruiseは痛み30）ので、**素の穴からこぼれた獲物はこぼれた時から
    // 数え始める**——止まるのは、こちらが付ける傷と殺す罠の傷（どれもhurting以上）だけ。
    open(0.0);
    const boar = release('wild_boar');
    wound(boar, 'bruise');
    expect(
      player.moveToSlotOrRejection(grassland.getSlot(codex.slotNames.getId('characters'))),
    ).toBeUndefined();

    expect(
      boar.tryGetProperty(codex.propertyNames.getId('pain'))?.stage?.name,
      '痛むが、深手の段には届かない',
    ).toBe('sore');

    passTurn(96);

    expect(boar.parent, '丸1日で立ち去る').toBeUndefined();
  });

  it('誰も見ていない土地の動物は、丸1日で立ち去る', () => {
    // 動物は探索が際限なく湧かせるので、消える口が無いと島に溜まり続ける（HuntingSystem.md 5.6節）。
    open(0.0);
    const rat = release('rat');
    expect(
      player.moveToSlotOrRejection(grassland.getSlot(codex.slotNames.getId('characters'))),
    ).toBeUndefined();

    passTurn(95);
    expect(rat.parent, '残り1（下限）までは居る').toBe(jungle);

    passTurn(1);
    expect(rat.parent, '尽きた個体は世界から消える').toBeUndefined();
    // 立ち去りは死ではない。消した宣言（stay_remainingのon_min）が名前を名乗らないので、
    // この消滅は死因として読まれない（VitalsSystem.md 6節）。
    expect(rat.destroyedReason, '立ち去った獣は、どう消えたかを名乗らない').toBeUndefined();
  });

  it('同じ土地に人が居る間は、立ち去りが止まる', () => {
    // タイマーはリセットではなく一時停止（HuntingSystem.md 5.6節）。目の前では絶対に消えない。
    open(0.0);
    const stayId = codex.propertyNames.getId('stay_remaining');
    const fowl = release('junglefowl');

    passTurn(100);

    expect(fowl.parent, '見ている間は消えない').toBe(jungle);
    expect(fowl.tryGetProperty(stayId)?.getEffectiveValue() ?? 0, 'タイマーは減ってすらいない').toBe(96);
  });

  it('罠に掛かった獲物は立ち去らない', () => {
    // in_slot: itemsが「土地の地面に居る」を言うので、罠の中ではタイマーが止まる
    // （HuntingSystem.md 5.6節）。獲物が消えるより先に、もがかれた罠のほうが壊れる（traps.yamlの
    // durability、-11/tickで約87tick）ので、罠が保っている間はいつ戻っても獲物が居る。
    open(0.0);
    const stayId = codex.propertyNames.getId('stay_remaining');
    const snare = release('snare');
    const fowl = spawnInto('junglefowl', snare, 'catch');
    expect(
      player.moveToSlotOrRejection(grassland.getSlot(codex.slotNames.getId('characters'))),
    ).toBeUndefined();

    passTurn(60);

    expect(fowl.parent, '罠の中では消えない').toBe(snare);
    expect(fowl.tryGetProperty(stayId)?.getEffectiveValue() ?? 0, 'タイマーは減ってすらいない').toBe(96);
  });

  it('立ち去った動物のくわえていた物は、その土地に落ちている', () => {
    // 道具は食べ物と違って食べられない（beast traitのゲート）ので、立ち去りまでくわえたまま残り、
    // 消えるときに中身としてその土地へこぼれる（destroyの規約、9.3節）。追跡が遅れても物は戻る。
    open(0.7);
    const monkey = release('monkey');
    monkey.getProperty(warinessId).setNumberWithoutEvents(0);
    const stone = release('sharp_stone');

    passTurn();
    expect(spoilsOf(monkey), '道具は食べずにくわえたまま').toEqual(['sharp_stone']);

    expect(
      player.moveToSlotOrRejection(grassland.getSlot(codex.slotNames.getId('characters'))),
    ).toBeUndefined();
    passTurn(96);

    expect(monkey.parent, '本体は立ち去って消える').toBeUndefined();
    expect(stone.parent, '盗品はその土地へこぼれる').toBe(jungle);
  });

  it('くわえた食べ物は、やがて食べられて失われる', () => {
    open(0.7);
    const monkey = release('monkey');
    monkey.getProperty(warinessId).setNumberWithoutEvents(0);
    const meat = release('raw_meat');

    passTurn();
    expect(spoilsOf(monkey), 'まずくわえる').toEqual(['raw_meat']);

    passTurn();
    expect(meat.parent, '食べられて世界から消える').toBeUndefined();
    expect(spoilsOf(monkey)).toEqual([]);
    expect(itemsIn(jungle), '地面にも戻らない').toEqual(['monkey']);
  });

  describe('UIは、1手を「誰が何をしたか」として読める（HuntingSystem.md 6節）', () => {
    /** bodyの実行中に起きた変化。 */
    function changesOf(body: () => void): readonly WorldChange[] {
      const changes: WorldChange[] = [];
      session.observeChanges((change) => changes.push(change), body);
      return changes;
    }

    it('持ち去った回は、その動物から持ち去られた物への突進になる', () => {
      open(0.5);
      const monkey = release('monkey');
      monkey.getProperty(warinessId).setNumberWithoutEvents(0);
      const coconut = release('coconut');

      const changes = changesOf(() => passTurn());

      expect(lungeTargetsByInstance(changes)).toEqual(new Map([[monkey.instanceId, [coconut.instanceId]]]));
    });

    it('壊した回も同じ形で読め、壊された物は世界から出たものとして挙がる', () => {
      // 突進が着いてから砂埃を立てるのに要る（cardMotionPlan）。
      open(0.5);
      const boar = release('wild_boar');
      boar.getProperty(warinessId).setNumberWithoutEvents(0);
      const basket = release('woven_basket');

      const changes = changesOf(() => passTurn());

      expect(lungeTargetsByInstance(changes)).toEqual(new Map([[boar.instanceId, [basket.instanceId]]]));
      expect(vanishedInstances(changes)).toContain(basket.instanceId);
    });

    it('中身のある入れ物を壊した回は、こぼれた中身も候補に挙がる（先に記録されるのは中身）', () => {
      // WorldObject.destroyは中身をこぼしてから自分の消滅を記録するので、**起きた順の先頭は
      // 手を出した相手ではない**。どちらを相手にするかは、画面に出ているかで決まる（cardMotionPlan）。
      open(0.5);
      const boar = release('wild_boar');
      boar.getProperty(warinessId).setNumberWithoutEvents(0);
      const basket = release('woven_basket');
      const stone = release('sharp_stone');
      expect(stone.moveToSlotOrRejection(basket.getSlot(codex.slotNames.getId('contents')))).toBeUndefined();

      const changes = changesOf(() => passTurn());

      expect(lungeTargetsByInstance(changes)).toEqual(
        new Map([[boar.instanceId, [stone.instanceId, basket.instanceId]]]),
      );
    });

    it('逃げた回は突進にならない（動いたのは自分）', () => {
      open(0.5);
      openPath();
      const rat = release('rat');

      const changes = changesOf(() => passTurn());

      expect(rat.parent, '隣の土地へ移っている').toBe(grassland);
      expect(lungeTargetsByInstance(changes).size).toBe(0);
    });

    it('襲った回も突進にならない（怪我はどこからも動いていない）', () => {
      // 怪我は生まれた物なので、飛ぶのは怪我の側（出どころは襲った動物）。
      open(0.9);
      release('wild_boar');

      const changes = changesOf(() => passTurn());

      expect(injuriesOf(player)).not.toEqual([]);
      expect(lungeTargetsByInstance(changes).size).toBe(0);
    });

    it('くわえた物を食べた回も突進にならない（相手は自分の中に居る）', () => {
      open(0.7);
      const monkey = release('monkey');
      monkey.getProperty(warinessId).setNumberWithoutEvents(0);
      release('raw_meat');
      passTurn();

      const changes = changesOf(() => passTurn());

      expect(spoilsOf(monkey), '食べ終えている').toEqual([]);
      expect(lungeTargetsByInstance(changes).size).toBe(0);
    });
  });

  /**
   * その動物へ傷を1つ刺す。既定が裂傷なのは、刺し傷では失血で意識まで落ちるため——気を失った動物は
   * 警戒も消えるので、逃げるかどうかの話にならない。
   */
  function wound(animal: WorldObject, injuryName = 'laceration'): void {
    const injury = session.createObject(codex.objectNames.getId(injuryName));
    expect(injury.moveToSlotOrRejection(animal.getSlot(codex.slotNames.getId('injuries')))).toBeUndefined();
  }
});
