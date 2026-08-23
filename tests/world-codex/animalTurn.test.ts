import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

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

  let warinessId: number;
  let fleeId: number;
  let biteId: number;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
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
    const spawned = session.spawn(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlot(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  /** その動物を密林の足元へ置く。 */
  function release(name: string): WorldObject {
    return spawnInto(name, jungle, 'items');
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
    // 逃走が配分の8割を占める（animals.yaml）。野生の個体は警戒した状態で現れるので、置いた
    // 次の手番から逃げにかかる。
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
    expect(stone.moveToSlot(basket.getSlot(codex.slotNames.getId('contents')))).toBeUndefined();

    passTurn();

    expect(basket.parent, '編み籠は壊れて消える').toBeUndefined();
    expect(stone.parent, '中身は地面に散らばる').toBe(jungle);
  });

  it('警戒したイノシシは牙で突き、その傷はこの島で最も血が流れる', () => {
    open(0.5);
    const boar = release('wild_boar');

    passTurn();

    expect(injuriesOf(player)).toEqual(['gore_wound']);
    expect(boar.parent, '逃げ道が無いので居座る').toBe(jungle);
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
    const boar = release('wild_boar');

    passTurn();

    expect(injuriesOf(player), '同じ土地に居るうちは突かれる').toEqual(['gore_wound']);
    expect(boar.tryGetProperty(goreId)?.getEffectiveValue() ?? 0).toBeGreaterThan(0);

    expect(player.moveToSlot(grassland.getSlot(codex.slotNames.getId('characters')))).toBeUndefined();
    for (let i = 0; i < 5; i++) passTurn();

    // **重みは配分のまま**（打ち消しの寄与は無い）。相手が1つも居ない候補が抽選に出ないのは、
    // amongが集合を見るからで、著者は「相手が居なければ起こらない」を書いていない（10.3節）。
    expect(boar.tryGetProperty(goreId)?.getEffectiveValue() ?? 0).toBeGreaterThan(0);
    expect(injuriesOf(player), '相手が居なければ、襲う候補は抽選に出ない').toEqual(['gore_wound']);
  });

  it('誰も見ていない土地の動物は、丸1日で立ち去る', () => {
    // 動物は探索が際限なく湧かせるので、消える口が無いと島に溜まり続ける（HuntingSystem.md 5.6節）。
    open(0.0);
    const rat = release('rat');
    expect(player.moveToSlot(grassland.getSlot(codex.slotNames.getId('characters')))).toBeUndefined();

    passTurn(95);
    expect(rat.parent, '残り1（下限）までは居る').toBe(jungle);

    passTurn(1);
    expect(rat.parent, '尽きた個体は世界から消える').toBeUndefined();
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
    expect(player.moveToSlot(grassland.getSlot(codex.slotNames.getId('characters')))).toBeUndefined();

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

    expect(player.moveToSlot(grassland.getSlot(codex.slotNames.getId('characters')))).toBeUndefined();
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

  /**
   * その動物へ裂傷を1つ負わせる（痛みを押し上げるため）。刺し傷ではなく裂傷なのは、失血で
   * 意識まで落とさないため——気を失った動物は警戒も消えるので、逃げるかどうかの話にならない。
   */
  function wound(animal: WorldObject): void {
    const injury = session.spawn(codex.objectNames.getId('laceration'));
    expect(injury.moveToSlot(animal.getSlot(codex.slotNames.getId('injuries')))).toBeUndefined();
  }
});
