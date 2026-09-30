import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { objectCostMinutesOf } from '../../src/analysis/balanceTables';
import { durationsOf } from '../../src/analysis/durations';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { fixedRng } from '../support/rng';
import {
  bundledBalanceTables,
  bundledCodex,
  worldCodexPath,
  worldCodexYamlPaths,
} from '../support/worldCodexFiles';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { WorldObject } from '../../src/domain/WorldObject';
import { MINUTES_PER_DAY } from '../../src/domain/worldTime';

/**
 * 素材の屋外劣化（`src/assets/world-codex/weathering.yaml`、
 * [`docs/engine/DurabilitySystem.md`](../../docs/engine/DurabilitySystem.md) 2節）と、そこから出る
 * 維持の重さ（[`docs/world/SurvivalItems.md`](../../docs/world/SurvivalItems.md) 12節）を、同梱の
 * YAMLに対して確かめる。
 *
 * **見るのは宣言ではなく効き目**——trait を名乗ったかではなく、その物が何日で朽ちるかを
 * `durationsOf` から読む。名前を付け替えても、レートを書き換えても、ここが落ちる。
 */
const codex = bundledCodex();

/** 素材の分類（DurabilitySystem.md 2節）。 */
type Material = 'weatherproof' | 'long_lived' | 'short_lived';

/** 分類ごとの、屋根の無い所に置いたときの寿命（晴れの日数・雨の日数）。傷まない素材は持たない。 */
const LIFETIME_DAYS: Record<Material, { sunny: number; rainy: number } | null> = {
  weatherproof: null,
  long_lived: { sunny: 100, rainy: 20 },
  short_lived: { sunny: 10, rainy: 5 },
};

/**
 * 手に持って使う物・身につける物・入れ物・寝床が名乗る素材（DurabilitySystem.md 2節）。
 *
 * **この表は全数**。下の「表は1つ残らず並べている」が、同じタグを名乗る型を世界から数え上げて
 * 突き合わせるので、道具や衣類を足した人はここへも書くことになる。
 */
const MATERIALS: Readonly<Record<string, Material>> = {
  sharp_stone: 'weatherproof',
  stone_axe: 'long_lived',
  bone_needle: 'long_lived',
  spear: 'long_lived',
  fishing_harpoon: 'long_lived',
  fire_drill: 'long_lived',
  woven_basket: 'short_lived',
  sledge: 'long_lived',
  handcart: 'long_lived',
  bundled_leaf_clothing: 'short_lived',
  rawhide_clothing: 'short_lived',
  woven_leaf_clothing: 'short_lived',
  tanned_leather_clothing: 'long_lived',
  bed: 'short_lived',
  hammock: 'long_lived',
};

/**
 * 表の対象になるタグ。道具・入れ物・身につける物・寝床（DurabilitySystem.md 2節）。
 *
 * **下の表の全数検査はこのタグから数え上げる**ので、ここが漏れると表ごと漏れる。覆っていることは
 * `durability` を持つ型の数え上げと突き合わせる（「耐久を持つ物は、表のタグを名乗るか、…」）。
 */
const WEATHERED_TAGS = ['tool', 'container', 'equippable', 'bed'];

/** `durability` を持つが、屋外劣化の表に載せない物のタグ。 */
const DURABLE_OUTSIDE_TABLE = [
  // 減るのは腐敗で、素材の分類ではなく腐る速さを名乗る（DurabilitySystem.md 3節、foods.yaml）。
  'perishable',
  // 仕掛けた罠は獲物にもがかれて減り、減り方を罠の側が持つ（TrapSystem.md 6.1節、traps.yaml）。
  'trap',
];

/** 積んであるだけでも屋外で傷む素材と、その分類（DurabilitySystem.md 2.2節）。 */
const STOCKED_MATERIALS: Readonly<Record<string, Material>> = {
  plant_fiber: 'short_lived',
  woven_leaf: 'short_lived',
};

/** 現実で傷むのに年単位でかかるので、屋外に置いたままでも傷ませない物（DurabilitySystem.md 2.2節）。 */
const LASTING = ['log', 'raft'];

/** 持ち物1つの維持に充ててよい、1日の余剰に対する割合（SurvivalItems.md 12.1節）。 */
const UPKEEP_SHARE = 0.05;

const balance = bundledBalanceTables();

function isGenerated(def: ObjectDef): boolean {
  return codex.isGenerated(def);
}

/** 素材の分類ごとの trait（weathering.yaml）。 */
const MATERIAL_TRAITS = Object.keys(LIFETIME_DAYS).map((material) => `${material}_material`);

/** 素材の trait のどれかを名乗っている型の名前。trait は合成後に消えるので、同梱のYAMLから読む。 */
function materialNamerNames(): string[] {
  const names: string[] = [];
  for (const path of worldCodexYamlPaths()) {
    const root = parse(readFileSync(path, 'utf8')) as {
      object_defs?: Record<string, { traits?: unknown } | null>;
    } | null;
    for (const [name, body] of Object.entries(root?.object_defs ?? {})) {
      const traits = Array.isArray(body?.traits) ? body.traits : [];
      if (traits.some((trait) => MATERIAL_TRAITS.includes(String(trait)))) names.push(name);
    }
  }
  return names;
}

/** 表の対象になる型の名前（宣言順）。 */
function weatheredDefNames(): string[] {
  const tagIds = WEATHERED_TAGS.map((tag) => codex.tagNames.getId(tag));
  const names: string[] = [];
  for (const def of codex.objects) {
    if (isGenerated(def)) continue;
    if (!tagIds.some((tagId) => def.tags.includes(tagId))) continue;
    names.push(def.name);
  }
  return names;
}

/** その型の `durability` が屋外で尽きるまでの日数。時間で減らない物は undefined。 */
function weatheringOf(objectName: string): { sunny: number; rainy: number } | undefined {
  const row = durationsOf(codex).find(
    (duration) => duration.objectName === objectName && duration.propertyName === 'durability',
  );
  return row === undefined ? undefined : { sunny: row.days, rainy: row.shortestDays };
}

describe('素材の屋外劣化', () => {
  it('表は、道具・入れ物・身につける物・寝床を1つ残らず並べている', () => {
    // 名乗り忘れた物は屋外へ置いても朽ちない。数が増えても気付けるよう、タグから数え上げて突き合わせる
    // （かさの全数検査、containersYaml.test.ts と同じ理由）。
    expect(weatheredDefNames().sort()).toEqual(Object.keys(MATERIALS).sort());
  });

  it('耐久を持つ物は、表のタグを名乗るか、積んだ素材の表に在るか、表の外に置く理由を持つ', () => {
    // 表の対象を選ぶタグ（WEATHERED_TAGS）が漏れると、上の全数検査は数え上げの土台ごと漏れて緑の
    // まま通る。耐久を持つのにどこにも当たらない物は、タグの一覧か、表の外に置く理由の側が足りない。
    const durabilityId = codex.propertyNames.getId('durability');
    const coveredTagIds = [...WEATHERED_TAGS, ...DURABLE_OUTSIDE_TABLE].map((tag) =>
      codex.tagNames.getId(tag),
    );
    const uncovered = [...codex.objects]
      .filter((def) => !isGenerated(def) && def.tryGetPropertyDef(durabilityId) !== undefined)
      .filter((def) => !coveredTagIds.some((tagId) => def.tags.includes(tagId)))
      .map((def) => def.name)
      .filter((name) => !(name in STOCKED_MATERIALS));

    expect(uncovered).toEqual([]);
  });

  it('表の分類どおりの日数で朽ちる', () => {
    for (const [objectName, material] of Object.entries(MATERIALS)) {
      const expected = LIFETIME_DAYS[material];
      const actual = weatheringOf(objectName);

      if (expected === null) {
        expect(actual, `${objectName} は傷まない素材なので、時間では減らない`).toBeUndefined();
        continue;
      }

      expect(actual, `${objectName} の寿命`).toEqual(expected);
    }
  });

  it('持ち物1つの維持は、1日の余剰の5%を超えない', () => {
    // 寿命は素材が、手間はレシピが決めるので、**どちらを触っても崩れうる**（SurvivalItems.md 12.1節）。
    // 崩れたまま入ると、6枠を埋めただけで1日が維持で埋まる。
    const limit = balance.surplusMinutes * UPKEEP_SHARE;
    const upkeep = Object.entries(MATERIALS)
      .map(([objectName, material]) => ({ objectName, lifetime: LIFETIME_DAYS[material] }))
      .filter((entry) => entry.lifetime !== null)
      .map((entry) => ({
        objectName: entry.objectName,
        minutesPerDay: objectCostMinutesOf(balance, entry.objectName) / entry.lifetime!.sunny,
      }));

    expect(upkeep.length, '寿命を持つ物が1つも無い').toBeGreaterThan(0);
    for (const entry of upkeep)
      expect(entry.minutesPerDay, `${entry.objectName} の1日あたりの維持（分）`).toBeLessThanOrEqual(limit);
  });
});

describe('積んである素材の屋外劣化（DurabilitySystem.md 2.2節）', () => {
  /** 洞窟が湧く土地の1つ（locations.yamlのrocky_fieldのexplore）。 */
  const CAVE_LAND = 'rocky_field';

  /** 岩場に浅い洞窟（屋根のある唯一の場所）が1つある世界。 */
  function landWithCave() {
    const session = new WorldSession(codex, fixedRng(0));
    const worldInstance = session.createObject(codex.objectNames.getId('world'));
    session.adoptWorld(new World(worldInstance));
    const land = spawnInto(session, CAVE_LAND, worldInstance, 'locations');
    const cave = spawnInto(session, 'shallow_cave', land, 'fixtures');
    return { session, land, cave };
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

  /** 同じ場所へ2つ積む。同種なので1つの山にまとまる（SlotSystem.md 5節）。 */
  function pileOf(session: WorldSession, objectName: string, place: WorldObject): WorldObject[] {
    return [spawnInto(session, objectName, place, 'items'), spawnInto(session, objectName, place, 'items')];
  }

  function durabilityOf(object: WorldObject): number {
    return object.getProperty(codex.propertyNames.getId('durability')).getEffectiveValue();
  }

  it('積んだ短命な素材は、表の分類どおりの日数で朽ちる', () => {
    for (const [objectName, material] of Object.entries(STOCKED_MATERIALS))
      expect(weatheringOf(objectName), `${objectName} の寿命`).toEqual(LIFETIME_DAYS[material]);
  });

  it('素材の分類は、weathering.yaml が宣言する素材の trait と過不足なく一致する', () => {
    // 下の全数検査は、素材の trait をこの分類から数える。分類に無い trait を名乗る型は、どの表からも
    // 漏れて緑のまま通る。
    const root = parse(readFileSync(worldCodexPath('weathering.yaml'), 'utf8')) as {
      traits?: Record<string, unknown>;
    };
    const declared = Object.keys(root.traits ?? {}).filter((trait) => trait.endsWith('_material'));

    expect(declared, '素材の trait が1つも読めない').not.toHaveLength(0);
    expect([...MATERIAL_TRAITS].sort()).toEqual(declared.sort());
  });

  it('素材の trait を名乗るのは、持ち物の表と積んだ素材の表に並べた物だけ', () => {
    // 表に無い在庫（ヤシの葉・枯れ草など）や据えた大物が名乗り出したら、DurabilitySystem.md 2.2節の線を
    // 動かしたことになる。
    expect(materialNamerNames().sort()).toEqual(
      [...Object.keys(MATERIALS), ...Object.keys(STOCKED_MATERIALS)].sort(),
    );
  });

  it('丸太と筏は、屋外に置いたままでも時間では傷まない', () => {
    for (const objectName of LASTING)
      expect(weatheringOf(objectName), `${objectName} は年単位で保つ`).toBeUndefined();
  });

  it('屋外に積んだ分は揃って日ごとに減り、屋根の下では減らない', () => {
    const { session, land, cave } = landWithCave();
    const piles = Object.keys(STOCKED_MATERIALS).map((objectName) => ({
      objectName,
      outdoors: pileOf(session, objectName, land),
      sheltered: pileOf(session, objectName, cave),
    }));
    const log = spawnInto(session, 'log', land, 'items');
    const raft = spawnInto(session, 'raft', land, 'fixtures');

    session.advanceWorldTime(MINUTES_PER_DAY);

    for (const pile of piles) {
      const outdoor = pile.outdoors.map(durabilityOf);
      // 晴れなら1日で96、雨の刻があればその分だけ多く減る（DurabilitySystem.md 2節の表）。
      expect(outdoor[0], `屋外の ${pile.objectName} は1日ぶん以上傷む`).toBeLessThanOrEqual(960 - 96);
      expect(outdoor, `積んだ ${pile.objectName} は1つずつではなく同時に減る`).toEqual([
        outdoor[0],
        outdoor[0],
      ]);
      expect(pile.sheltered.map(durabilityOf), `洞窟の ${pile.objectName} は傷まない`).toEqual([960, 960]);
    }
    expect(log.parent, '丸太は屋外に残っている').toBe(land);
    expect(raft.parent, '筏は屋外に残っている').toBe(land);
  });
});
