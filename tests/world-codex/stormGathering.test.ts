import { readFileSync } from 'node:fs';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/wrappers/Location';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import {
  loadYamlDirectory,
  SAMPLE_CHARACTER,
  WORLD_CODEX_DIR,
  worldCodexYamlPaths,
} from '../support/worldCodexFiles';

/**
 * 嵐の日に屋外の採取が止まることを、実ファイルの定義だけで検証する
 * （docs/world/ContentSkeleton.md 8.1.4節・8.1.5節）。
 *
 * **止めているのは明るさではない**（同 8.1節）ので、見るのは「明るさが足りているのに採れない」
 * ところ。嵐の正午は+6（約190 lx）で屋外の採取のしきい値（+3）を超えるため、この1点で
 * 明るさと風雨が別の値であることが出る。
 */

/** 正午。晴れなら世界の明るさは+14、嵐でも+6で、屋外の採取のしきい値（+3）を超える。 */
const NOON_HOUR = 12;

/** 探索は嵐でも止まらない（8.1.4節が止めると決めているのは採取だけ）。 */
const EXPLORE_ACTION = 'explore';

describe('嵐の日は屋外の採取ができない', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  });

  /** 草原にプレイヤーが1人立っている正午の世界。天気だけを引数で変える。 */
  function noon(weatherName: string) {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    const session = new WorldSession(codex, new World(worldInstance, codex), fixedRng(0));
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

  it('嵐の正午は、明るさが足りていても採れない（同じ正午の晴れなら採れる）', () => {
    const storm = noon('storm');
    expect(
      propertyOf(storm.player, 'looking_brightness'),
      '嵐の正午でも屋外の採取のしきい値（+3）は超える',
    ).toBeGreaterThanOrEqual(3);

    const stormPick = picksFrond(storm.session, storm.land, storm.player);
    expect(stormPick?.tryExecute(), '嵐では採れない').toBe(false);
    expect(stormPick?.unmetRequirement()?.reasonName, '止めているのは風雨').toBe('too_stormy');

    const clear = noon('clear');
    expect(picksFrond(clear.session, clear.land, clear.player)?.tryExecute(), '晴れなら採れる').toBe(true);
  });

  it('物を重ねて出す採取も止まる（アバカを刈る）', () => {
    const storm = noon('storm');
    expect(fellsAbaca(storm.session, storm.land, storm.player), '嵐では組み合わせに出ない').toBeUndefined();

    const clear = noon('clear');
    expect(fellsAbaca(clear.session, clear.land, clear.player)?.tryExecute() === true).toBe(true);
  });

  it('大雨では採れる（止まるのは嵐だけ）', () => {
    const rain = noon('heavy_rain');
    expect(picksFrond(rain.session, rain.land, rain.player)?.tryExecute()).toBe(true);
  });

  it('探索は嵐でも進む', () => {
    const storm = noon('storm');
    expect(new Location(storm.land, codex).explore(storm.player)).toBe(true);
  });

  it('屋根の下では風雨が止む', () => {
    const storm = noon('storm');
    const cave = spawnInto(storm.session, 'shallow_cave', storm.land, 'fixtures');
    expect(propertyOf(storm.player, 'wind_speed'), '外は嵐の風速そのもの').toBe(20);

    expect(cave.tryGetAction('enter', storm.player)?.tryExecute(), '洞窟へ入る').toBe(true);
    expect(propertyOf(storm.player, 'wind_speed'), '屋根の下では風雨が当たらない').toBe(0);
  });
});

/**
 * 採取を宣言している操作が、風雨の条件を書き忘れていないことの検査。
 *
 * **条件を1箇所に集める術が無い**（レシピの `crafting_conditions` にあたるものが操作には無い）ので、
 * 採取の操作それぞれが明るさの1行の隣に風雨の1行を持つ。書き忘れと「嵐でもできると決めた」が
 * 字面で見分けられないため、**屋外の採取を名乗る操作は探索を除いて必ず風雨も要求する**という形で
 * ここが見張る。
 *
 * 屋外の採取かどうかは、視界の明るさに `bright` を要求しているかで見分ける
 * （docs/engine/IlluminationSystem.md 5節）。移動は同じ値の別の段（`pitch_dark` でないこと）を
 * 見るので、ここには入らない。
 */
describe('屋外の採取は、明るさと風雨をそろって要求する', () => {
  it('屋外の採取を名乗る操作が、探索を除いてすべて風雨も要求している', () => {
    const outdoor = outdoorInteractions();

    // 何も拾えていない検査は、緑であることと見ていないことの区別が付かない。
    expect(outdoor.length, '屋外の採取を名乗る操作が1つも見つからない').toBeGreaterThan(0);

    expect(
      outdoor
        .filter((interaction) => interaction.name !== EXPLORE_ACTION && !interaction.requiresWind)
        .map((interaction) => `${interaction.where}: ${interaction.name} が風雨の条件を持たない`),
    ).toEqual([]);
  });
});

/** 操作1つの読み。屋外の採取を名乗っているものだけを拾う。 */
interface OutdoorInteraction {
  readonly where: string;
  readonly name: string;
  readonly requiresWind: boolean;
}

/**
 * 同梱の定義YAMLから、屋外の採取（視界の明るさの `bright` を要求する操作）をすべて拾う。
 * ロード後の ConditionNode は木に畳まれていて列挙できないため、定義ファイルの構文木から拾う
 * （`illuminationStages.test.ts` と同じ理由）。
 */
function outdoorInteractions(): readonly OutdoorInteraction[] {
  const found: OutdoorInteraction[] = [];

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
          const required = requiredStages(isMap(pair.value) ? pair.value.get('conditions') : undefined);
          if (required.has('looking_brightness/bright'))
            found.push({
              where: `${path}: ${name}`,
              name,
              requiresWind: [...required].some((stage) => stage.startsWith('wind_speed/')),
            });
        }

      for (const pair of node.items) walk(pair.value);
    };

    walk(document.contents);
  }

  return found;
}

/**
 * `conditions` が段（`in_stage`）で見ているプロパティを `プロパティ名/段名` として集める。
 * `not` や `any` の中も辿る。
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
    const stageName = current.get('in_stage');
    if (typeof propertyName === 'string' && typeof stageName === 'string')
      names.add(`${propertyName}/${stageName}`);
    for (const pair of current.items) walk(pair.value);
  };

  walk(node);
  return names;
}
