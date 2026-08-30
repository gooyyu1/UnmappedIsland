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
 * drying.yamlの天日干しと干し場を、実ファイルの定義だけで検証する。
 *
 * 見たいのは1つ。**腐敗が引いた線を、干し場だけが跨げること**（docs/world/SurvivalItems.md 10節）
 * ——最も速い段（spoils_fast、屋外2日）は地面に並べても腐り切るのが先で、干し場に掛けたときだけ
 * 干し上がる。野菜の段（spoils_normal、屋外3.3日）は素手のまま地面でも届く。
 *
 * **この線は1tickの減りからは出ない。** 強い日差しは1日に24tickしか当たらない（salt.yamlの
 * drying_remaining）ので、地面の72tickは経過時間で3日ぶんになる。確かめるのは日をまたいで進めた
 * ときに**どちらが先に来るか**で、開始時刻に左右されないことも合わせて見る。
 */

/** 1tickの長さ（core.yamlのminutes_per_tick）。 */
const TICK_MINUTES = 15;

/** 強い日差しが差し始める時刻（tests/diagnostics/saltDryingHours.test.tsが定義から数える帯の入口）。 */
const SUNRISE_HOUR = 9;

/** 日差しが届かない夜。 */
const NIGHT_HOUR = 0;

/** 天気を据え置くための残り時間。周期（core.yamlのweather_remaining）が尽きなければ天気は変わらない。 */
const FROZEN_WEATHER_TICKS = 999999;

/** 打ち切り。最も長い野菜の屋外寿命（3.3日）を大きく超えて回しても答えは変わらない。 */
const LIMIT_TICKS = 96 * 6;

/** 1日を通して並べ始めうる時刻。**線が開始時刻に左右されないこと**まで見る。 */
const START_HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

describe('drying.yamlの天日干しと干し場', () => {
  let codex: WorldCodex;
  let durabilityId: number;
  let dryingRemainingId: number;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    durabilityId = codex.propertyNames.getId('durability');
    dryingRemainingId = codex.propertyNames.getId('drying_remaining');
  });

  /**
   * 砂浜にプレイヤーが立っている世界。時刻・天気・土地は呼び出し側が決める。
   *
   * **天気は据え置く。** 放っておくと4〜6時間ごとに変わるので（core.yamlのweather_remaining）、
   * 日をまたぐ検査では「晴れが続けば」の側を見られなくなる。
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

  /** tickをticks回進める。onTickがtrueを返したところで打ち切る。 */
  function advance(session: WorldSession, ticks: number, onTick?: () => boolean): void {
    for (let i = 0; i < ticks; i++) {
      session.advanceWorldTime(TICK_MINUTES);
      if (onTick?.() === true) return;
    }
  }

  /** その物が干し上がったか。干し上がりは別の型ではなくcure軸の値になることで表れる。 */
  function isDried(object: WorldObject): boolean {
    return object.def.name.endsWith('__cure_dried');
  }

  /** 腐り切って消えたか（perishableのdurabilityがon_minで自分を消す）。 */
  function isGone(object: WorldObject): boolean {
    return object.parent === undefined;
  }

  type Race = '干し上がった' | '腐り切った' | 'どちらも来ない';

  /** 干し上がるか腐り切るまで進めて、先に来たほうを返す。 */
  function raceOf(session: WorldSession, object: WorldObject): Race {
    let result: Race = 'どちらも来ない';
    advance(session, LIMIT_TICKS, () => {
      if (isDried(object)) result = '干し上がった';
      else if (isGone(object)) result = '腐り切った';
      return result !== 'どちらも来ない';
    });
    return result;
  }

  /** その型を1つ日の当たる地面へ並べて、決着を見る。 */
  function raceOnGround(objectName: string, hour: number, weather = 'clear', landName?: string): Race {
    const { session, land } = open(hour, weather, landName);
    return raceOf(session, spawnInto(session, objectName, land, 'items'));
  }

  /** その型を1つ干し場へ掛けて、決着を見る。 */
  function raceOnRack(objectName: string, hour: number, weather = 'clear', landName?: string): Race {
    const { session, land } = open(hour, weather, landName);
    const rack = spawnInto(session, 'drying_rack', land, 'fixtures');
    return raceOf(session, spawnInto(session, objectName, rack, 'drying'));
  }

  /** 開始時刻ごとの決着を並べる。**時刻で答えが変わらないこと**を1つのexpectで見るための形。 */
  function racesByHour(race: (hour: number) => Race): Record<number, Race> {
    return Object.fromEntries(START_HOURS.map((hour) => [hour, race(hour)]));
  }

  function allHours(result: Race): Record<number, Race> {
    return Object.fromEntries(START_HOURS.map((hour) => [hour, result]));
  }

  function numberOf(object: WorldObject, propertyId: number): number {
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

  it('生肉は、地面に並べても干し上がらない', () => {
    // **これが干し場の値打ち。** 晴れが1日も欠けなくても、強い日差しは1日24tickしか当たらないので、
    // 腐り切るまでに貯められるのは48tickまで——地面の72tickには何時に並べても届かない。
    expect(racesByHour((hour) => raceOnGround('raw_meat', hour))).toEqual(allHours('腐り切った'));
  });

  it('干し場に掛ければ、生肉は干し上がる', () => {
    expect(racesByHour((hour) => raceOnRack('raw_meat', hour))).toEqual(allHours('干し上がった'));
  });

  it('空心菜は、地面に並べるだけで干し上がる', () => {
    // **素手の天日干しは、干し場が建っても残る**（docs/world/SurvivalItems.md 10節）。野菜の段は
    // 屋外3.3日あるので、晴れが3日続けば地面の72tickに届く。
    expect(racesByHour((hour) => raceOnGround('water_spinach', hour))).toEqual(allHours('干し上がった'));
  });

  it('曇れば、干し場に掛けても干し上がらない', () => {
    // 境目（+14）は塩田と同じ1つで、曇りの正午でも届かない。**天気を見る条件は持たない。**
    expect(raceOnRack('raw_meat', SUNRISE_HOUR, 'cloudy'), '曇り').toBe('腐り切った');
    expect(raceOnRack('raw_meat', SUNRISE_HOUR, 'heavy_rain'), '雨').toBe('腐り切った');
  });

  it('樹冠の下では、干し場を据えても干し上がらない', () => {
    // **据える場所は縛らない**（drying.yaml）。密林は境目を超える時間がほとんど無いので、干せない
    // ことは乾きが進まないことで分かる——塩田を海から離して据えられるのと同じ。
    expect(raceOnRack('raw_meat', SUNRISE_HOUR, 'clear', 'jungle')).toBe('腐り切った');
  });

  it('干し上がると、腐るのが遅くなる', () => {
    // 行き先は塩漬けと同じ、既にある3段のうち最も遅い段（foods.yamlのcured）。生の海藻は-4に屋外の
    // -1が重なって-5、干し上がると-0.5と-1で-1.5になる。
    expect(spoilRateOfFresh('seaweed'), '生のままなら速い').toBeCloseTo(5);
    expect(spoilRateOfFresh('seaweed__cure_dried'), '干物は遅い').toBeCloseTo(1.5);
    expect(spoilRateOfFresh('seaweed__cure_dried'), '塩漬けと同じ段そのもの').toBeCloseTo(
      spoilRateOfFresh('seaweed__cure_salted'),
    );
  });

  it('掛け替えても、進んだぶんは残る', () => {
    // **残りを持つのは食べ物のほう。** 干し場が変えるのは1tickに減る量だけなので、地面から掛け
    // 直しても最初からにはならない。
    const { session, land } = open();
    const meat = spawnInto(session, 'raw_meat', land, 'items');
    advance(session, 8);

    const partial = numberOf(meat, dryingRemainingId);
    expect(partial, '地面では1tickに1ずつ進む').toBe(72 - 8);

    const rack = spawnInto(session, 'drying_rack', land, 'fixtures');
    expect(meat.moveToSlotOrRejection(rack.getSlot(codex.slotNames.getId('drying')))).toBeUndefined();
    advance(session, 1);
    expect(numberOf(meat, dryingRemainingId), '掛けると3倍で進む').toBe(partial - 3);
  });

  it('持ち歩いている間は乾かない', () => {
    // 並べるか掛けるかしなければ干し始まらない（親が土地でも干し場でもない）。日差しの下を歩いて
    // いるだけで干物になるなら、干し場も並べる場所も要らなくなる。
    const { session, player } = open();
    const meat = spawnInto(session, 'raw_meat', player, 'hand');
    const before = numberOf(meat, dryingRemainingId);

    advance(session, 24);
    expect(numberOf(meat, dryingRemainingId), 'タイマーは1つも進まない').toBe(before);
  });

  it('陽が届かなければ乾かない', () => {
    // 夜は暗さの底（-6）なので、何tick並べても進まない。
    const { session, land } = open(NIGHT_HOUR);
    const meat = spawnInto(session, 'raw_meat', land, 'items');
    const before = numberOf(meat, dryingRemainingId);

    advance(session, 24);
    expect(numberOf(meat, dryingRemainingId), 'タイマーは1つも進まない').toBe(before);
  });

  it('雨は乾きを押し戻す', () => {
    // 雨天は日差しの境目に届かない（進まない）うえ、濡れて乾きかけが戻る。
    const { session, land } = open(SUNRISE_HOUR, 'heavy_rain');
    const meat = spawnInto(session, 'raw_meat', land, 'items');
    meat.getProperty(dryingRemainingId).setNumberWithoutEvents(10);

    advance(session, 1);
    expect(numberOf(meat, dryingRemainingId), '残りが増える＝干し上がりが遠のく').toBe(12);
  });

  it('干し場に掛けられるのは、干せる物だけ', () => {
    // 焼いた物は軸を持たない（焼くのは食べるための工程、foods.yaml）ので、掛ける口そのものが無い。
    // 腐らない物も同じ。
    const { session, land } = open();
    const rack = spawnInto(session, 'drying_rack', land, 'fixtures');
    const drying = rack.getSlot(codex.slotNames.getId('drying'));

    for (const name of ['roasted_meat', 'roasted_rat', 'roasted_coconut_crab', 'roasted_taro', 'stone']) {
      const rejected = session.createObject(codex.objectNames.getId(name));
      expect(rejected.moveToSlotOrRejection(drying), `${name}は掛けられない`).toBeDefined();
    }
  });

  it('干した物は、もう塩漬けにできない', () => {
    // 塩の側の二度漬けを止める条件（salt.yamlのalready_cured）はcuredタグを見ているので、干物にも
    // そのまま効く。**保存を重ねても行き先は同じ段の端**なので、塩を捨てさせない。
    const { session, land, player } = open();
    const dried = spawnInto(session, 'raw_meat__cure_dried', land, 'items');
    const salt = spawnInto(session, 'salt', player, 'hand');

    const combination = salt.combinationsWith(dried, player).find((c) => c.name === 'cure');
    expect(combination?.tryExecute(), '塩を無駄にしない').not.toBe(true);
  });

  it('干せる食べ物は、干すと必ず遅くなる', () => {
    // **dryableを名乗ること自体が「この食べ物には日差しが効く」という宣言**（塩蔵のcure軸と同じ
    // 切り分け、salt.yaml）。行き先は既にある3段のうち最も遅い段そのものなので、元からその段で
    // 腐る物が名乗ると、3日並べて1日も延びない待ち時間が現れる。名乗るのは食べ物ごとなので、
    // 足すたびに同じ取り違えが起こりうる——数が増えても気付けるよう、名乗る全型を検査する。
    const names = dryableTypeNames(codex);
    const useless: string[] = [];

    for (const name of names) {
      const dried = `${name}__cure_dried`;
      expect(codex.objectNames.tryGetId(dried), `${name}はcure軸を宣言していない`).toBeDefined();
      if (spoilRateOfFresh(dried) >= spoilRateOfFresh(name)) useless.push(name);
    }

    expect(useless, '干しても速さが変わらない食べ物は、dryableを名乗らない').toEqual([]);
    expect(names.length, '検査した型が0件では通っても意味が無い').toBeGreaterThan(0);
  });

  it('干し場は太い枝6本と縄1本から作れる', () => {
    const def = codex.objects.get(codex.objectNames.getId('drying_rack'));
    const [recipe] = def.recipesProducingThis;
    const [step] = recipe!.steps;

    expect(step!.requirements).toHaveLength(2);
    expect(step!.requirements[0].requires(codex.objects.get(codex.objectNames.getId('thick_branch')))).toBe(
      true,
    );
    expect(step!.requirements[1].requires(codex.objects.get(codex.objectNames.getId('rope')))).toBe(true);
  });

  it('据えた干し場は、持ち歩けない', () => {
    // 設置物（fixture）でitemタグを持たないので、手持ちの枠が受け取らない（塩田・畑・囲いと同じ）。
    const { session, land, player } = open();
    const rack = spawnInto(session, 'drying_rack', land, 'fixtures');

    expect(rack.moveToSlotOrRejection(player.getSlot(codex.slotNames.getId('hand')))).toBeDefined();
  });
});

/** dryableを名乗る素の型の名前（保存済みの変種は除く）。 */
function dryableTypeNames(codex: WorldCodex): string[] {
  const dryable = codex.tagNames.getId('dryable');
  const names: string[] = [];

  for (let globalId = 0; globalId < codex.objects.count; globalId++) {
    const def = codex.objects.get(globalId);
    if (!def.tags.includes(dryable)) continue;
    if (codex.generatedTypes.baseGlobalIdIfVariantOn(def, 'cure') !== undefined) continue;
    names.push(def.name);
  }
  return names;
}
