import { describe, expect, it } from 'vitest';
import { buildBalanceTables, objectCostMinutesOf } from '../../src/analysis/balanceTables';
import { craftingStepsOf } from '../../src/analysis/craftingSteps';
import { durationsOf } from '../../src/analysis/durations';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import type { ObjectDef } from '../../src/domain/ObjectDef';

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
};

/** 表の対象になるタグ。道具・入れ物・身につける物・寝床（DurabilitySystem.md 2節）。 */
const WEATHERED_TAGS = ['tool', 'container', 'equippable', 'bed'];

/** 持ち物1つの維持に充ててよい、1日の余剰に対する割合（SurvivalItems.md 12.1節）。 */
const UPKEEP_SHARE = 0.05;

/** 1つの工程に充ててよい、1日の余剰に対する割合（SurvivalItems.md 12.2節）。 */
const STEP_SHARE = 0.6;

const balance = buildBalanceTables(codex, SAMPLE_CHARACTER);

function isGenerated(def: ObjectDef): boolean {
  return codex.isGenerated(def);
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

  it('1つの工程は、1日の余剰の6割を超えない', () => {
    // 工程は途中で止められない（GameElementDefinition.md 11.3節）ので、1つが余剰を食い切ると、
    // 着手した日は他に何もできなくなる（SurvivalItems.md 12.2節）。
    const limit = balance.surplusMinutes * STEP_SHARE;
    for (const def of codex.objects) {
      if (isGenerated(def)) continue;
      for (const step of craftingStepsOf(codex, def))
        expect(step.laborMinutes, `${def.name} の ${step.name} が払う時間（分）`).toBeLessThanOrEqual(limit);
    }
  });
});
