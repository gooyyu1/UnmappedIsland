import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction } from '../support/illumination';

/**
 * salt.yamlの塩田と塩蔵を、実ファイルの定義だけで検証する。
 *
 * 見たいのは2つ。**塩田が罠・畑と同じ「留守番の設備」の形で海水から塩を採ること**と、
 * **塩蔵が腐敗を遅らせること**（docs/world/ContentSkeleton.md 4節の保存の段4）。
 *
 * 遅くなった後の速さは、既にある3段（docs/engine/DurabilitySystem.md 3節）の最も遅い段そのものなので、
 * **別の物差しを持ち込んでいないことは「芋と同じ速さになる」で確かめる**。
 */

/** 正午。砂浜（+1）の晴れ（-2）で+15になり、塩田が干し上がる境目（+14）を越える。 */
const NOON_HOUR = 12;
/** 夜。太陽が地平線の下なので、どの土地も暗さの底（-6）に張り付く。 */
const NIGHT_HOUR = 0;

describe('salt.yamlの塩田と塩蔵', () => {
  let codex: WorldCodex;
  let brineId: number;
  let dryingRemainingId: number;
  let durabilityId: number;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    brineId = codex.propertyNames.getId('brine');
    dryingRemainingId = codex.propertyNames.getId('drying_remaining');
    durabilityId = codex.propertyNames.getId('durability');
  });

  /** 砂浜にプレイヤーが立っている世界。landを変えれば海に面していない土地にできる。 */
  function open(hour = NOON_HOUR, weather = 'clear', landName = 'sandy_beach') {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    const session = new WorldSession(codex, new World(worldInstance, codex), fixedRng(0.9));
    worldInstance.getProperty(codex.propertyNames.getId('hour')).setNumberWithoutEvents(hour);
    worldInstance
      .getProperty(codex.propertyNames.getId('weather'))
      .setNumberWithoutEvents(codex.symbolNames.getId(weather));

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

  /** そのスロットに今並んでいる物の識別子。 */
  function contentsOf(owner: WorldObject, slotName: string): string[] {
    return (owner.tryGetSlot(codex.slotNames.getId(slotName))?.contents ?? []).map(
      (object) => object.def.name,
    );
  }

  function numberOf(object: WorldObject, propertyId: number): number {
    return object.getProperty(propertyId).number;
  }

  /** 塩田を1つ据えて、海水をcount杯張る。 */
  function buildPan(session: WorldSession, land: WorldObject, player: WorldObject, count = 0) {
    const pan = spawnInto(session, 'salt_pan', land, 'fixtures');
    for (let i = 0; i < count; i++)
      expect(pan.tryGetAction('draw_seawater', player)?.tryExecute(), '海水を汲める').toBe(true);
    return pan;
  }

  /** 塩が採れるまで進める。採れなければ失敗させる。 */
  function tickUntilSalted(land: WorldObject, pan: WorldObject, limit = 200): string[] {
    for (let i = 0; i < limit; i++) {
      land.tick();
      const salt = contentsOf(pan, 'salt');
      if (salt.length > 0) return salt;
    }
    throw new Error('塩田に何も採れなかった');
  }

  /** 塩を1つ持ったプレイヤーで、その食べ物を塩漬けにする（できなければfalse）。 */
  function cure(session: WorldSession, player: WorldObject, food: WorldObject): boolean {
    const salt = spawnInto(session, 'salt', player, 'hand');
    const combination = salt.combinationsWith(food, player).find((c) => c.name === 'cure');
    return combination?.tryExecute() === true;
  }

  /** その物のdurabilityが1tickで減る量（実体値の差）。 */
  function spoilRateOf(land: WorldObject, object: WorldObject): number {
    const before = numberOf(object, durabilityId);
    land.tick();
    return before - numberOf(object, durabilityId);
  }

  it('海水を張るまで、塩田は何も採らない', () => {
    // 畑と同じ形（farming.yaml）。張っていない回は重み0の先頭の候補で拾われるので、日が照って
    // いても塩は出ない。
    const { session, land, player } = open();
    const pan = buildPan(session, land, player);

    for (let i = 0; i < 200; i++) land.tick();
    expect(contentsOf(pan, 'salt'), '張っていない塩田は空のまま').toEqual([]);
  });

  it('張った海水は、日に干されて塩になる', () => {
    const { session, land, player } = open();
    const pan = buildPan(session, land, player, 1);
    expect(numberOf(pan, brineId), '1杯張られた').toBe(1);

    expect(tickUntilSalted(land, pan), '塩が1つ採れる').toEqual(['salt']);
    expect(numberOf(pan, brineId), '張った海水は使われる').toBe(0);
  });

  it('張ったぶんだけで止まる', () => {
    // **塩田は無限には採れない。** 張った杯数が重みそのものなので、尽きれば重み0の先頭へ落ちる。
    const { session, land, player } = open();
    const pan = buildPan(session, land, player, 1);
    tickUntilSalted(land, pan);

    for (let i = 0; i < 200; i++) land.tick();
    expect(contentsOf(pan, 'salt'), '2つ目は採れない').toEqual(['salt']);
  });

  it('海に面していない土地では、海水を汲めない', () => {
    // 据える場所は縛らず、汲む操作だけがcoastタグ（locations.yaml）を見る。
    const { session, land, player } = open(NOON_HOUR, 'clear', 'grassland');
    const pan = spawnInto(session, 'salt_pan', land, 'fixtures');

    expect(pan.tryGetAction('draw_seawater', player)?.unmetRequirement()?.reasonName).toBe('no_seawater');
  });

  it('満ちた塩田には、これ以上張れない', () => {
    const { session, land, player } = open();
    const pan = buildPan(session, land, player, 8);

    expect(pan.tryGetAction('draw_seawater', player)?.unmetRequirement()?.reasonName).toBe('salt_pan_full');
  });

  it('陽が届かなければ干し上がらない', () => {
    // 干すのは日差しで、境目は液体の蒸発の上乗せと同じ+14（liquid_containers.yaml）。夜は底の-6
    // なので、何日置いても進まない。
    const { session, land, player } = open(NIGHT_HOUR);
    const pan = buildPan(session, land, player, 1);
    const before = numberOf(pan, dryingRemainingId);

    for (let i = 0; i < 200; i++) land.tick();
    expect(numberOf(pan, dryingRemainingId), 'タイマーは1つも進まない').toBe(before);
    expect(contentsOf(pan, 'salt'), '夜のあいだ塩は採れない').toEqual([]);
  });

  it('雨は干し上がりを押し戻す', () => {
    // 雨天は日差しの境目に届かない（進まない）うえ、張った海水が薄まって乾きかけが戻る。
    const { session, land, player } = open(NOON_HOUR, 'heavy_rain');
    const pan = buildPan(session, land, player, 1);
    pan.getProperty(dryingRemainingId).setNumberWithoutEvents(10);

    land.tick();
    expect(numberOf(pan, dryingRemainingId), '残りが増える＝干し上がりが遠のく').toBe(12);
  });

  it('塩漬けにすると、腐るのが遅くなる', () => {
    // 生のヤシガニは調理済みと同じ段（-4）で、屋外の上乗せ（-1）と重なって-5。塩漬けにすると
    // 通常温度のぶんが芋と同じ-0.5へ移るので-1.5になる。
    const { session, land, player } = open();
    const fresh = spawnInto(session, 'coconut_crab', land, 'items');
    expect(spoilRateOf(land, fresh), '生のままなら速い').toBeCloseTo(5);

    expect(cure(session, player, fresh), '塩漬けにできる').toBe(true);
    expect(fresh.def.name, '同じ個体が塩漬けの版になる').toBe('coconut_crab__cure_salted');
    expect(spoilRateOf(land, fresh), '塩漬けは遅い').toBeCloseTo(1.5);
  });

  it('塩漬けの速さは、芋と同じ段そのもの', () => {
    // **別の物差しを持ち込んでいないことの確認。** 塩蔵が名乗るのは既にある3段のうち最も遅い段
    // （spoils_slow）で、同じ場所に置いた芋と1tickの減り方が一致する。
    const { session, land, player } = open();
    const crab = spawnInto(session, 'coconut_crab', land, 'items');
    const taro = spawnInto(session, 'taro', land, 'items');
    expect(cure(session, player, crab)).toBe(true);

    const before = { crab: numberOf(crab, durabilityId), taro: numberOf(taro, durabilityId) };
    land.tick();
    expect(before.crab - numberOf(crab, durabilityId)).toBeCloseTo(
      before.taro - numberOf(taro, durabilityId),
    );
  });

  it('塩漬けにしても、傷み具合は引き継ぐ', () => {
    // 別の型を作らず同じ個体を作り変える（become、GameElementDefinition.md 9.9節）ので、
    // 焼き直しのように新品へ戻ることはない。
    const { session, land, player } = open();
    const crab = spawnInto(session, 'coconut_crab', land, 'items');
    crab.getProperty(durabilityId).setNumberWithoutEvents(700);

    expect(cure(session, player, crab)).toBe(true);
    // 漬ける30分（2tick）ぶんは生のままの速さ（-5）で進むので、そのぶんだけ減って引き継がれる。
    expect(numberOf(crab, durabilityId), '新品には戻らない').toBe(690);
  });

  it('傷んだ物は塩漬けにできない', () => {
    // 塩は腐敗を止めるだけで、進んだぶんは戻らない。無事な段（sound、480以上）でだけ漬かる。
    const { session, land, player } = open();
    const crab = spawnInto(session, 'coconut_crab', land, 'items');
    crab.getProperty(durabilityId).setNumberWithoutEvents(300);

    expect(cure(session, player, crab), '傷んだ物には塩を打てない').toBe(false);
    expect(crab.def.name, '型は変わらない').toBe('coconut_crab');
  });

  it('二度は漬けられない', () => {
    const { session, land, player } = open();
    const crab = spawnInto(session, 'coconut_crab', land, 'items');
    expect(cure(session, player, crab)).toBe(true);

    expect(cure(session, player, crab), '塩を無駄にしない').toBe(false);
  });

  it('塩漬けにできるのは、腐る物のうち生のままの物だけ', () => {
    // 焼くのは食べるための工程なので、焼いた物には軸を付けていない（foods.yaml・animals.yaml）。
    // 腐らない物（石）にも塩は効かない。
    const { session, land, player } = open();
    const stone = spawnInto(session, 'stone', land, 'items');

    for (const roasted of ['roasted_coconut_crab', 'roasted_meat', 'roasted_rat'])
      expect(cure(session, player, spawnInto(session, roasted, land, 'items')), `${roasted}は漬けない`).toBe(
        false,
      );
    expect(cure(session, player, stone), '腐らない物は漬けない').toBe(false);
  });

  it('生肉を塩漬けにすると、腐るのが遅くなる', () => {
    // **塩蔵の本来の相手。** 生肉は調理済みと同じ段（-4）で、屋外の上乗せ（-1）と重なって-5——
    // 狩った肉は2.5日で消える。塩漬けにすると芋と同じ段へ移って-1.5になる。
    const { session, land, player } = open();
    const meat = spawnInto(session, 'raw_meat', land, 'items');
    expect(spoilRateOf(land, meat), '生のままなら速い').toBeCloseTo(5);

    expect(cure(session, player, meat), '塩漬けにできる').toBe(true);
    expect(meat.def.name, '同じ個体が塩漬けの版になる').toBe('raw_meat__cure_salted');
    expect(spoilRateOf(land, meat), '塩漬けは遅い').toBeCloseTo(1.5);
  });

  it('死体は丸のまま漬けられるが、解体して出る生肉は漬かっていない', () => {
    // 塩が残るのは掛けた個体だけ（spawnは新しい個体を作る）なので、丸のまま漬けても得られるのは
    // 「解体を後へ回せる」ことだけ。肉まで保たせるには、肉になってからもう一度漬ける。
    const { session, land, player } = open();
    const carcass = spawnInto(session, 'junglefowl_carcass', land, 'items');
    expect(cure(session, player, carcass), '死体を塩漬けにできる').toBe(true);
    expect(spoilRateOf(land, carcass), '塩漬けの死体は遅い').toBeCloseTo(1.5);

    const knife = spawnInto(session, 'sharp_stone', player, 'hand');
    const butcher = carcass.combinationsWith(knife, player).find((c) => c.name === 'butcher');
    expect(butcher?.tryExecute(), '塩漬けの死体も解体できる').toBe(true);

    const meat = land
      .getSlot(codex.slotNames.getId('items'))
      .contents.find((object) => object.def.name === 'raw_meat');
    expect(meat, '出てくるのは素の生肉').toBeDefined();
    expect(spoilRateOf(land, meat!), '漬かっていないので速いまま').toBeCloseTo(5);
  });

  it('ヤシの実の中身も漬けられる', () => {
    // ヤシの実の連鎖には焼く工程が無いので、腐る物すべてが軸を持つ（coconut.yaml）。
    const { session, land, player } = open();
    const flesh = spawnInto(session, 'coconut_meat', land, 'items');
    expect(spoilRateOf(land, flesh), '生の果肉は野菜と同じ段（-2）＋屋外の-1').toBeCloseTo(3);

    expect(cure(session, player, flesh), '塩漬けにできる').toBe(true);
    expect(spoilRateOf(land, flesh), '塩漬けは遅い').toBeCloseTo(1.5);
  });

  it('塩田は平たい石4つから作れる', () => {
    const def = codex.objects.get(codex.objectNames.getId('salt_pan'));
    const [recipe] = def.recipesProducingThis;
    const [step] = recipe!.steps;

    expect(step!.requirements).toHaveLength(1);
    expect(step!.requirements[0].requires(codex.objects.get(codex.objectNames.getId('stone')))).toBe(true);
  });

  it('据えた塩田は、持ち歩けない', () => {
    // 設置物（fixture）でitemタグを持たないので、手持ちの枠が受け取らない（畑・囲いと同じ）。
    const { session, land, player } = open();
    const pan = buildPan(session, land, player);

    expect(pan.moveToSlotOrRejection(player.getSlot(codex.slotNames.getId('hand')))).toBeDefined();
  });
});
