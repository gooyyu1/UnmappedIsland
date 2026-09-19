import { readFileSync } from 'node:fs';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/wrappers/Location';
import { World } from '../../src/domain/wrappers/World';
import { fixedRng } from '../support/rng';
import { bundledCodex, SAMPLE_CHARACTER, worldCodexYamlPaths } from '../support/worldCodexFiles';

/**
 * 嵐の日、屋根の下でなければ何もできないことを、実ファイルの定義だけで検証する
 * （docs/world/ContentSkeleton.md 8.1.4節・8.1.5節）。
 *
 * **止めているのは明るさではない**（同 8.1節）ので、見るのは「明るさが足りているのにできない」
 * ところ。嵐の正午は+6（約190 lx）で屋外の採取のしきい値（+3）も手元の作業のしきい値（+5）も
 * 超えるため、この1点で明るさと風雨が別の値であることが出る。
 */

/** 正午。晴れなら世界の明るさは+14、嵐でも+6で、採取（+3）と手元の作業（+5）のしきい値を超える。 */
const NOON_HOUR = 12;

describe('嵐の日は屋根の下でなければ何もできない', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = bundledCodex();
  });

  /** 草原にプレイヤーが1人立っている正午の世界。天気だけを引数で変える。 */
  function noon(weatherName: string) {
    const session = new WorldSession(codex, undefined, fixedRng(0));
    const worldInstance = session.createObject(codex.objectNames.getId('world'));
    session.adoptWorld(new World(worldInstance));
    worldInstance.getProperty(codex.propertyNames.getId('hour')).setNumberWithoutEvents(NOON_HOUR);
    worldInstance
      .getProperty(codex.propertyNames.getId('weather'))
      .setNumberWithoutEvents(codex.symbolNames.getId(weatherName));

    const land = spawnInto(session, 'grassland', worldInstance, 'locations');
    const player = spawnInto(session, SAMPLE_CHARACTER, land, 'characters');
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

  function propertyOf(object: WorldObject, propertyName: string): number {
    return object.getProperty(codex.propertyNames.getId(propertyName)).getEffectiveValue();
  }

  /** ヤシの葉を採る（coconut.yamlのpick_frond）。メニューから出る屋外の採取の代表。 */
  function picksFrond(session: WorldSession, land: WorldObject, player: WorldObject) {
    return spawnInto(session, 'palm_tree', land, 'fixtures').tryGetAction('pick_frond', player);
  }

  /** アバカを刃物で刈る（fiber.yamlのfell）。物を重ねて出す屋外の採取の代表。 */
  function fellsAbaca(session: WorldSession, land: WorldObject, player: WorldObject) {
    const plant = spawnInto(session, 'abaca', land, 'fixtures');
    const knife = spawnInto(session, 'sharp_stone', player, 'hand');
    return plant.combinationsWith(knife, player).find((combination) => combination.name === 'fell');
  }

  /**
   * 道を歩く（locations.yamlのpathのtravel）。**行き先は繋がない**——見たいのは条件が通るかだけで、
   * 通った先で実際に移動できるかは別の検査（tests/domain/）が持つ。
   */
  function travels(session: WorldSession, land: WorldObject, player: WorldObject) {
    return spawnInto(session, 'path', land, 'fixtures').tryGetAction('travel', player);
  }

  /** 石を打ち欠く（locations.yamlのknap）。屋外の採取ではない、手元の作業の代表。 */
  function knaps(session: WorldSession, holder: WorldObject, player: WorldObject) {
    const target = spawnInto(session, 'stone', holder, 'items');
    const hammer = spawnInto(session, 'stone', player, 'hand');
    return target.combinationsWith(hammer, player).find((combination) => combination.name === 'knap');
  }

  /** 打ち欠く手が断られた理由（同）。成立しているなら undefined。 */
  function knapRefusal(session: WorldSession, holder: WorldObject, player: WorldObject): string | undefined {
    const target = spawnInto(session, 'stone', holder, 'items');
    const hammer = spawnInto(session, 'stone', player, 'hand');
    return target
      .refusedCombinationsWith(hammer, player)
      .find((combination) => combination.name === 'knap')
      ?.unmetRequirement()?.reasonName;
  }

  it('嵐の正午は、明るさが足りていても何もできない（同じ正午の晴れならできる）', () => {
    const storm = noon('storm');
    expect(
      propertyOf(storm.player, 'looking_brightness'),
      '嵐の正午でも屋外の採取のしきい値（+3）は超える',
    ).toBeGreaterThanOrEqual(3);
    expect(
      propertyOf(storm.player, 'hand_brightness'),
      '嵐の正午でも手元の作業のしきい値（+5）は超える',
    ).toBeGreaterThanOrEqual(5);

    const stormPick = picksFrond(storm.session, storm.land, storm.player);
    expect(stormPick?.tryExecute(), '嵐では採れない').toBe(false);
    expect(stormPick?.unmetRequirement()?.reasonName, '止めているのは風雨').toBe('too_stormy');

    expect(new Location(storm.land).explore(storm.player), '嵐では探索できない').toBe(false);

    const stormTravel = travels(storm.session, storm.land, storm.player);
    expect(stormTravel?.unmetRequirement()?.reasonName, '嵐では道を歩けない').toBe('too_stormy');

    const stormKnap = knaps(storm.session, storm.land, storm.player);
    expect(stormKnap, '嵐では手元の作業も組み合わせに出ない').toBeUndefined();

    const clear = noon('clear');
    expect(picksFrond(clear.session, clear.land, clear.player)?.tryExecute(), '晴れなら採れる').toBe(true);
    expect(new Location(clear.land).explore(clear.player), '晴れなら探索できる').toBe(true);
    expect(
      travels(clear.session, clear.land, clear.player)?.unmetRequirement(),
      '晴れなら道を歩ける',
    ).toBeUndefined();
    expect(knaps(clear.session, clear.land, clear.player)?.tryExecute(), '晴れなら打てる').toBe(true);
  });

  it('物を重ねて出す採取も止まる（アバカを刈る）', () => {
    const storm = noon('storm');
    expect(fellsAbaca(storm.session, storm.land, storm.player), '嵐では組み合わせに出ない').toBeUndefined();

    const clear = noon('clear');
    expect(fellsAbaca(clear.session, clear.land, clear.player)?.tryExecute() === true).toBe(true);
  });

  it('大雨では動ける（止まるのは嵐だけ）', () => {
    const rain = noon('heavy_rain');
    expect(picksFrond(rain.session, rain.land, rain.player)?.tryExecute(), '採れる').toBe(true);
    expect(new Location(rain.land).explore(rain.player), '探索できる').toBe(true);
    expect(travels(rain.session, rain.land, rain.player)?.unmetRequirement(), '道を歩ける').toBeUndefined();
    expect(knaps(rain.session, rain.land, rain.player)?.tryExecute(), '打てる').toBe(true);
  });

  /**
   * 屋根の下へ入ると、断る理由が風雨から暗さへ入れ替わる。**同じ手を同じ嵐の中で2度訊く**ので、
   * 変わったのが居場所だけであることがこの1件で出る。
   *
   * **岩陰では「できる」までは行かない**——嵐の正午の岩陰は0で手元のしきい値（+5）を割るので、
   * そこから先は明かりの話になる（docs/world/ContentSkeleton.md 8.1.1.4節）。
   */
  it('屋根の下では風雨が止み、断る理由が暗さだけになる', () => {
    const storm = noon('storm');
    const cave = spawnInto(storm.session, 'shallow_cave', storm.land, 'fixtures');
    expect(propertyOf(storm.player, 'wind_speed'), '外は嵐の風速そのもの').toBe(20);
    expect(knapRefusal(storm.session, storm.land, storm.player), '外で止めているのは風雨').toBe('too_stormy');

    expect(cave.tryGetAction('enter', storm.player)?.tryExecute(), '洞窟へ入る').toBe(true);
    expect(propertyOf(storm.player, 'wind_speed'), '屋根の下では風雨が当たらない').toBe(0);
    expect(knapRefusal(storm.session, cave, storm.player), '屋根の下で残るのは暗さだけ').toBe('too_dark');
  });
});

/**
 * 明るさの条件と風雨の条件が、ちょうど同じ顔ぶれの操作へ書かれていることの検査。
 *
 * **条件を1箇所に集める術が無い**（レシピの `crafting_conditions` にあたるものが操作には無い）ので、
 * 操作それぞれが明るさの1行の隣に風雨の1行を持つ。書き忘れと「嵐でもできると決めた」が字面で
 * 見分けられないため、**2つが重なっていること**という形でここが見張る。
 *
 * **その2つが重なるのが線の引き方そのもの**（docs/engine/IlluminationSystem.md 5節）——目や手元の
 * 精度が要る仕事は、暗さでも風雨でも止まる。手が覚えている粗い動作（食べる・くべる・殴る）と海を
 * 渡ることはどちらの条件も持たないので、例外を並べずに済む。
 *
 * **両向きに見る。** 片側（明るさが在るなら風雨も）だけだと、風雨だけを書いた操作と、明るさの1行を
 * 後から落とされた操作が緑のまま通る。
 */
describe('明るさの条件と風雨の条件は、ちょうど同じ操作に書かれている', () => {
  it('どちらか一方だけを持つ条件の並びが1つも無い', () => {
    const gated = brightnessOrWindGatedConditions();

    // 何も拾えていない検査は、緑であることと見ていないことの区別が付かない。**両方の明るさと、
    // 操作ではない`crafting_conditions`を1つずつ確かめる**——片方の綴りが変わって拾えなくなっても、
    // もう片方が在るだけで緑になってしまう。
    for (const kind of ['looking_brightness', 'hand_brightness', 'crafting_conditions'])
      expect(
        gated.filter((one) => one.kinds.includes(kind)).length,
        `${kind}を見ている条件が1つも見つからない`,
      ).toBeGreaterThan(0);

    expect(
      gated
        .filter((one) => one.requiresBrightness !== one.requiresWind)
        .map((one) => `${one.where}: ${one.requiresWind ? '明るさ' : '風雨'}の条件を持たない`),
    ).toEqual([]);
  });
});

/** 明るさか風雨で閉じている条件の並び1つぶんの読み。 */
interface GatedConditions {
  readonly where: string;

  /** 見ている明るさのプロパティ名と、操作ではない条件の並びを指す印。 */
  readonly kinds: readonly string[];

  readonly requiresBrightness: boolean;
  readonly requiresWind: boolean;
}

/** 明るさとして数えるプロパティ（docs/engine/IlluminationSystem.md 5節）。 */
const BRIGHTNESS_PROPERTIES = ['looking_brightness', 'hand_brightness'];

/** 風雨として数えるプロパティ（docs/world/ContentSkeleton.md 8.1.5節）。 */
const WIND_PROPERTY = 'wind_speed';

/**
 * 同梱の定義YAMLから、明るさか風雨の段を要求している条件の並びをすべて拾う。ロード後の ConditionNode は
 * 木に畳まれていて列挙できないため、定義ファイルの構文木から拾う（`illuminationStages.test.ts` と
 * 同じ理由）。**操作の `conditions` と、ルートキーの `crafting_conditions` の両方を見る**
 * ——後者は全レシピへ一律に掛かる1本（`core.yaml`）。
 */
function brightnessOrWindGatedConditions(): readonly GatedConditions[] {
  const found: GatedConditions[] = [];

  const read = (where: string, conditions: unknown, extraKinds: readonly string[] = []): void => {
    const required = requiredStages(conditions);
    const looksAt = (property: string): boolean =>
      [...required].some((stage) => stage.startsWith(`${property}/`));
    const brightnessKinds = BRIGHTNESS_PROPERTIES.filter(looksAt);
    const requiresWind = looksAt(WIND_PROPERTY);
    if (brightnessKinds.length === 0 && !requiresWind) return;
    found.push({
      where,
      kinds: [...extraKinds, ...brightnessKinds],
      requiresBrightness: brightnessKinds.length > 0,
      requiresWind,
    });
  };

  for (const path of worldCodexYamlPaths()) {
    const document = parseDocument(readFileSync(path, 'utf8'));

    const walk = (node: unknown): void => {
      if (isSeq(node)) {
        for (const item of node.items) walk(item);
        return;
      }
      if (!isMap(node)) return;

      const interactions = node.get('interactions');
      if (isMap(interactions))
        for (const pair of interactions.items) {
          const name = isScalar(pair.key) ? String(pair.key.value) : '';
          read(`${path}: ${name}`, isMap(pair.value) ? pair.value.get('conditions') : undefined);
        }

      for (const pair of node.items) walk(pair.value);
    };

    walk(document.contents);
    read(`${path}: crafting_conditions`, document.get('crafting_conditions'), ['crafting_conditions']);
  }

  return found;
}

/**
 * `conditions` が段（`in_stage`・`in_stage_or_above`）で見ているプロパティを `プロパティ名/段名` として
 * 集める。`not` や `any` の中も辿る。
 */
function requiredStages(node: unknown): ReadonlySet<string> {
  const names = new Set<string>();

  const walk = (current: unknown): void => {
    if (isSeq(current)) {
      for (const item of current.items) walk(item);
      return;
    }
    if (!isMap(current)) return;

    const propertyName = current.get('prop');
    for (const key of ['in_stage', 'in_stage_or_above']) {
      const stageName = current.get(key);
      if (typeof propertyName === 'string' && typeof stageName === 'string')
        names.add(`${propertyName}/${stageName}`);
    }
    for (const pair of current.items) walk(pair.value);
  };

  walk(node);
  return names;
}
