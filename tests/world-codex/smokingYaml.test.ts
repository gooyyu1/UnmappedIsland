import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/wrappers/Location';
import { World } from '../../src/domain/wrappers/World';
import { fixedRng } from '../support/rng';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction } from '../support/illumination';
import type { PropertyGlobalId } from '../../src/domain/GlobalId';

/**
 * smoking.yamlの燻製と燻し小屋を、実ファイルの定義だけで検証する。
 *
 * 見たいのは2つ。**燻し小屋が開けるのは日差しの要らない保存であること**（docs/world/SurvivalItems.md
 * 11節）——干し場は曇り・夜・樹冠の下では止まるが、燻し小屋は火さえ生きていれば進む。もう1つは
 * **その火が炎にならないこと**——掛けた食べ物が焼けないのは条件で止めているからではなく、火力の
 * 上限が種火の段の中に置いてあるからで、上限を動かすと黙って焼け始める。
 */

/** 1tickの長さ（core.yamlのminutes_per_tick）。 */
const TICK_MINUTES = 15;

/** 強い日差しの差す時刻（干し場が進む帯。tests/world-codex/dryingYaml.test.tsと同じ）。 */
const SUNRISE_HOUR = 9;

/** 日差しが届かない夜。 */
const NIGHT_HOUR = 0;

/** 天気を据え置くための残り時間。周期（core.yamlのweather_remaining）が尽きなければ天気は変わらない。 */
const FROZEN_WEATHER_TICKS = 999999;

/** 燻し上がるまでのtick数（smoking.yamlのsmoking_remaining）。 */
const SMOKING_TICKS = 96;

/** 打ち切り。生肉の屋外寿命（2日）を大きく超えて回しても答えは変わらない。 */
const LIMIT_TICKS = 96 * 6;

describe('smoking.yamlの燻製と燻し小屋', () => {
  let codex: WorldCodex;
  let smokingRemainingId: PropertyGlobalId;
  let cookingProgressId: PropertyGlobalId;
  let durabilityId: PropertyGlobalId;
  let fuelId: PropertyGlobalId;
  let heatId: PropertyGlobalId;

  beforeAll(() => {
    codex = bundledCodex();
    smokingRemainingId = codex.propertyNames.getId('smoking_remaining');
    cookingProgressId = codex.propertyNames.getId('cooking_progress');
    durabilityId = codex.propertyNames.getId('durability');
    fuelId = codex.propertyNames.getId('fuel');
    heatId = codex.propertyNames.getId('heat');
  });

  /**
   * 土地にプレイヤーが立っている世界。時刻・天気・土地は呼び出し側が決める。
   *
   * **天気は据え置く**（干し場の検査と同じ理由、dryingYaml.test.ts）——放っておくと数時間ごとに
   * 変わるので、雨の日に火が保たないことを見られなくなる。
   */
  function open(hour = SUNRISE_HOUR, weather = 'clear', landName = 'sandy_beach') {
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
    worldInstance
      .getProperty(codex.propertyNames.getId('weather_remaining'))
      .setNumberWithoutEvents(FROZEN_WEATHER_TICKS);

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
   * 火の入った燻し小屋を1つ据える。着火の道筋（火口→火種→炉）はfire.yamlの持ち分なので
   * （tests/world-codex/fireYaml.test.tsが見張る）、ここでは薪と種火を直に置く。
   */
  function litSmokehouse(session: WorldSession, parent: WorldObject): WorldObject {
    const house = spawnInto(session, 'smokehouse', parent, 'fixtures');
    house.getProperty(fuelId).setNumberWithoutEvents(20);
    house.getProperty(heatId).setNumberWithoutEvents(1);
    return house;
  }

  /** tickをticks回進める。onTickがtrueを返したところで打ち切る。 */
  function advance(session: WorldSession, ticks: number, onTick?: () => boolean): void {
    for (let i = 0; i < ticks; i++) {
      session.advanceWorldTime(TICK_MINUTES);
      if (onTick?.() === true) return;
    }
  }

  /** その物が燻し上がったか。燻し上がりは別の型ではなくcure軸の値になることで表れる。 */
  function isSmoked(object: WorldObject): boolean {
    return object.def.name.endsWith('__cure_smoked');
  }

  /** 腐り切って消えたか（perishableのdurabilityがon_minで自分を消す）。 */
  function isGone(object: WorldObject): boolean {
    return object.parent === undefined;
  }

  type Race = '燻し上がった' | '腐り切った' | 'どちらも来ない';

  /** 燻し上がるか腐り切るまで進めて、先に来たほうを返す。 */
  function raceOf(session: WorldSession, object: WorldObject): Race {
    let result: Race = 'どちらも来ない';
    advance(session, LIMIT_TICKS, () => {
      if (isSmoked(object)) result = '燻し上がった';
      else if (isGone(object)) result = '腐り切った';
      return result !== 'どちらも来ない';
    });
    return result;
  }

  /** 火の入った燻し小屋へ生肉を1つ吊るして、決着を見る。 */
  function raceInSmokehouse(hour: number, weather = 'clear', landName?: string): Race {
    const { session, land } = open(hour, weather, landName);
    const house = litSmokehouse(session, land);
    return raceOf(session, spawnInto(session, 'raw_meat', house, 'fire'));
  }

  function numberOf(object: WorldObject, propertyId: PropertyGlobalId): number {
    return object.getProperty(propertyId).number;
  }

  /** その型を1つだけ野ざらしに置いたときの、1tickあたりのdurabilityの減り。 */
  function spoilRateOfFresh(objectName: string): number {
    const { session, land } = open();
    const object = spawnInto(session, objectName, land, 'items');
    const before = numberOf(object, durabilityId);
    advance(session, 1);
    return before - numberOf(object, durabilityId);
  }

  it('火の入った燻し小屋に吊るせば、生肉は燻製になる', () => {
    expect(raceInSmokehouse(SUNRISE_HOUR)).toBe('燻し上がった');
  });

  it('曇りでも夜でも樹冠の下でも、燻し上がる', () => {
    // **これが燻し小屋の値打ち**（docs/world/SurvivalItems.md 11節）。干し場はこのどれでも止まる
    // （tests/world-codex/dryingYaml.test.ts）が、煙は日差しを当てにしていない。
    expect(raceInSmokehouse(SUNRISE_HOUR, 'cloudy'), '曇り').toBe('燻し上がった');
    expect(raceInSmokehouse(NIGHT_HOUR), '夜').toBe('燻し上がった');
    expect(raceInSmokehouse(SUNRISE_HOUR, 'clear', 'jungle'), '樹冠の下').toBe('燻し上がった');
  });

  it('火が消えていれば、吊るしても進まない', () => {
    // 残りが減るのは火の生きている間だけ。薪を切らした小屋はただの棚になる。
    const { session, land } = open();
    const house = spawnInto(session, 'smokehouse', land, 'fixtures');
    const meat = spawnInto(session, 'raw_meat', house, 'fire');

    advance(session, 24);
    expect(numberOf(house, heatId), '火は消えたまま').toBe(0);
    expect(numberOf(meat, smokingRemainingId), 'タイマーは1つも進まない').toBe(SMOKING_TICKS);
  });

  it('雨の日でも、薪が足りていれば燻し上がる', () => {
    // 雨は炉から火力を削る（fire.yamlのhearth）が、薪の段が育てるぶんが勝つので、燻しは止まらない。
    // **天気で開け閉めされるのは日差しの側だけ**という、この設備の値打ちそのもの。
    expect(raceInSmokehouse(SUNRISE_HOUR, 'heavy_rain')).toBe('燻し上がった');
  });

  it('薪が心細い燻し小屋は、雨に降られると火が落ちる', () => {
    // 雨が削る4に対し、薪が少なければ育てるのは2（fire.yamlのhearth）。**囲いが火を守るのは、
    // 中で薪が焚けている間だけ。**
    const { session, land } = open(SUNRISE_HOUR, 'heavy_rain');
    const house = spawnInto(session, 'smokehouse', land, 'fixtures');
    house.getProperty(fuelId).setNumberWithoutEvents(5);
    house.getProperty(heatId).setNumberWithoutEvents(4);

    advance(session, 4);
    expect(numberOf(house, heatId), '火は消えている').toBe(0);
  });

  it('燻し小屋の火は、薪を満たしても種火の段より上へ行かない', () => {
    // **これが「燻し小屋では焼けない」の実体**（smoking.yaml）。熱を子へ渡すのは熾火より上の段
    // だけなので（fire.yaml）、上限を熾火の下端より下に置いてあることが、焼けないことそのもの。
    const { session, land } = open();
    const house = litSmokehouse(session, land);

    advance(session, SMOKING_TICKS);
    expect(house.getProperty(heatId).isInStage('ember'), '火力は種火の段のまま').toBe(true);
    expect(numberOf(house, fuelId), '薪はまだ残っている').toBeGreaterThan(0);
  });

  it('燻し小屋に吊るした肉は、焼けない', () => {
    const { session, land } = open();
    const house = litSmokehouse(session, land);
    const meat = spawnInto(session, 'raw_meat', house, 'fire');

    advance(session, SMOKING_TICKS - 1);
    expect(numberOf(meat, cookingProgressId), '焼けの進みは1つも動かない').toBe(0);
    expect(meat.def.name, 'まだ生肉のまま').toBe('raw_meat');
  });

  it('燻し上がると、腐るのが遅くなる', () => {
    // 行き先は塩漬け・干物と同じ、既にある3段のうち最も遅い段（foods.yamlのcured）。
    expect(spoilRateOfFresh('seaweed'), '生のままなら速い').toBeCloseTo(5);
    expect(spoilRateOfFresh('seaweed__cure_smoked'), '燻製は遅い').toBeCloseTo(1.5);
    expect(spoilRateOfFresh('seaweed__cure_smoked'), '塩漬けと同じ段そのもの').toBeCloseTo(
      spoilRateOfFresh('seaweed__cure_salted'),
    );
  });

  it('小屋から出しても、進んだぶんは残る', () => {
    // **残りを持つのは食べ物のほう**（干し場と同じ、drying.yaml）。火が絶えた小屋から出して別の
    // 小屋へ移しても、最初からにはならない。
    const { session, land } = open();
    const first = litSmokehouse(session, land);
    const meat = spawnInto(session, 'raw_meat', first, 'fire');
    advance(session, 8);

    const partial = numberOf(meat, smokingRemainingId);
    expect(partial, '1tickに1ずつ進む').toBe(SMOKING_TICKS - 8);

    expect(meat.moveToSlotOrRejection(land.getSlot(codex.slotNames.getId('items')))).toBeUndefined();
    advance(session, 8);
    expect(numberOf(meat, smokingRemainingId), '外に置いた間は動かない').toBe(partial);

    const second = litSmokehouse(session, land);
    expect(meat.moveToSlotOrRejection(second.getSlot(codex.slotNames.getId('fire')))).toBeUndefined();
    advance(session, 1);
    expect(numberOf(meat, smokingRemainingId), '掛け直せば続きから進む').toBe(partial - 1);
  });

  it('燻し小屋に吊るせるのは、燻せる物だけ', () => {
    // 焼いた物は軸を持たない（焼くのは食べるための工程、foods.yaml）ので、吊るす口そのものが無い。
    // 薪も入らない——炉の火床の枠は燃料を受けない（fire.yaml）。
    const { session, land } = open();
    const house = spawnInto(session, 'smokehouse', land, 'fixtures');
    const fire = house.getSlot(codex.slotNames.getId('fire'));

    for (const name of ['roasted_meat', 'roasted_taro', 'stone', 'thick_branch']) {
      const rejected = session.createObject(codex.objectNames.getId(name));
      expect(rejected.moveToSlotOrRejection(fire), `${name}は吊るせない`).toBeDefined();
    }
  });

  it('燻した物は、もう塩漬けにできない', () => {
    // **止めているのは条件ではなく軸のほう**（干物と同じ、drying.yaml）。変種の変種は作らない
    // （3.5.1節）ので、燻製にはcureの行き先が無く、塩漬けの操作そのものが現れない。
    const { session, land, player } = open();
    const smoked = spawnInto(session, 'raw_meat__cure_smoked', land, 'items');
    const salt = spawnInto(session, 'salt', player, 'hand');

    expect(
      salt.combinationsWith(smoked, player).map((c) => c.name),
      '塩漬けの操作が現れない',
    ).not.toContain('cure');
  });

  it('燻せる物の顔ぶれは、干せる物とそっくり同じ', () => {
    // どちらも「生のままで、加工すると実際に速さが移る食べ物」という同じ切り分け
    // （docs/world/SurvivalItems.md 9節）。**名乗るのは食べ物ごと**なので、片方だけに足す取り違えが
    // 起こりうる——食べ物が増えても気付けるよう、両方の顔ぶれを突き合わせる。
    const smokable = typeNamesWithTag(codex, 'smokable');

    expect(smokable).toEqual(typeNamesWithTag(codex, 'dryable'));
    expect(smokable.length, '検査した型が0件では通っても意味が無い').toBeGreaterThan(0);
  });

  it('燻せる食べ物は、燻すと必ず遅くなる', () => {
    // **smokableを名乗ること自体が「この食べ物には煙が効く」という宣言**（干し場・塩蔵と同じ
    // 切り分け）。行き先は最も遅い段そのものなので、元からその段で腐る物が名乗ると、1日燻して
    // 1日も延びない待ち時間が現れる。
    const useless: string[] = [];

    for (const name of typeNamesWithTag(codex, 'smokable')) {
      const smoked = `${name}__cure_smoked`;
      expect(codex.objectNames.tryGetId(smoked), `${name}はcure軸を宣言していない`).toBeDefined();
      if (spoilRateOfFresh(smoked) >= spoilRateOfFresh(name)) useless.push(name);
    }

    expect(useless, '燻しても速さが変わらない食べ物は、smokableを名乗らない').toEqual([]);
  });

  it('燻し小屋は、保存の腕が basic に届くまで作れない', () => {
    // **保存の腕を読む唯一の側**（docs/engine/SkillSystem.md 4節）。腕が伸びるのは塩漬けだけなので
    // （salt.yamlのcure）、燻製は塩蔵の後ろに来る。
    const [recipe] = codex.objects.get(codex.objectNames.getId('smokehouse')).recipesProducingThis;
    const session = new WorldSession(codex);
    const skill = codex.propertyNames.getId('skill_preserving');
    const player = session.createObject(codex.objectNames.getId(SAMPLE_CHARACTER));

    player.getProperty(skill).setNumberWithoutEvents(19);
    expect(recipe!.unmetUnlockRequirement(player), 'basicの手前では作れない').toBeDefined();

    player.getProperty(skill).setNumberWithoutEvents(20);
    expect(recipe!.unmetUnlockRequirement(player), 'basicへ届けば作れる').toBeUndefined();
  });

  it('燻し小屋は太い枝6本・編んだ葉6枚・縄2本から作れる', () => {
    const [recipe] = codex.objects.get(codex.objectNames.getId('smokehouse')).recipesProducingThis;
    const [step] = recipe!.steps;

    expect(step!.requirements).toHaveLength(3);
    for (const [index, name] of ['thick_branch', 'woven_leaf', 'rope'].entries())
      expect(
        step!.requirements[index].requires(codex.objects.get(codex.objectNames.getId(name))),
        `${index}番目は${name}`,
      ).toBe(true);
  });

  it('燻し小屋を2基据えても、1枚のカードに束ならない', () => {
    // stackable: false（SlotSystem.md 4節）。束ねると火力も薪も吊るした物も代表の1基ぶんしか
    // 見えなくなる——干し場・塩田と同じで、留守番の設備は中身が個体ごとに違う。
    const { session, land } = open();
    spawnInto(session, 'smokehouse', land, 'fixtures');
    spawnInto(session, 'smokehouse', land, 'fixtures');

    expect(
      new Location(land, codex).fixtureStacks.map((stack) => stack.length),
      '2つの枠に1基ずつ並ぶ',
    ).toEqual([1, 1]);
  });

  it('据えた燻し小屋は、持ち歩けない', () => {
    // 設置物（fixture）でitemタグを持たないので、手持ちの枠が受け取らない（干し場・塩田と同じ）。
    const { session, land, player } = open();
    const house = spawnInto(session, 'smokehouse', land, 'fixtures');

    expect(house.moveToSlotOrRejection(player.getSlot(codex.slotNames.getId('hand')))).toBeDefined();
  });
});

/** そのタグを名乗る素の型の名前（保存済みの変種は除く）。 */
function typeNamesWithTag(codex: WorldCodex, tagName: string): string[] {
  const tag = codex.tagNames.getId(tagName);
  const names: string[] = [];

  for (let globalId = 0; globalId < codex.objects.count; globalId++) {
    const def = codex.objects.get(globalId);
    if (!def.tags.includes(tag)) continue;
    if (codex.generatedTypes.baseGlobalIdIfVariantOn(def, 'cure') !== undefined) continue;
    names.push(def.name);
  }
  return names;
}
