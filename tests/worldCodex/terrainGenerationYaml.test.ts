import { beforeAll, describe, expect, it } from 'vitest';
import type { GenerationDefs } from '../../src/domain/defs/generation/GenerationDefs';
import type { GenerationScopeDef } from '../../src/domain/defs/generation/GenerationScopeDef';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/** LINQのSingleOrDefault相当: 条件に一致する要素が2つ以上あれば例外、0または1ならその要素(無ければundefined)。 */
function singleOrUndefined<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  const matches = items.filter(predicate);
  if (matches.length > 1) throw new Error('複数の要素が条件に一致しました。');
  return matches[0];
}

describe('terrain_generation.yamlの地形生成定義', () => {
  let codex: WorldCodex;
  let generation: GenerationDefs;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    if (codex.generation === undefined) throw new Error('地形生成定義が読み込まれていません。');
    generation = codex.generation;
  });

  function scopeOf(name: string): GenerationScopeDef {
    const scope = generation.scopes.get(name);
    if (scope === undefined) throw new Error(`生成スコープ'${name}'が見つかりません。`);
    return scope;
  }

  it('地形生成定義がロードされ、期待される4つの軸を持つ', () => {
    expect(codex.generation).toBeDefined();
    expect(new Set(generation.axes.keys())).toEqual(
      new Set(['elevation', 'humidity', 'coastal_distance', 'ruggedness']),
    );
  });

  it('location_typesとlocationタグを持つobject_defsが過不足なく対応する', () => {
    // location_types→object_defs: すべての型が実在の土地object_defを指し、locationタグを持つ。
    const locationTag = codex.tagNames.getId('location');
    for (const type of generation.locationTypes) {
      const def = codex.objects.get(type.objectDefGlobalId);
      expect(def, `${type.name} のobject_defが実在する`).toBeDefined();
      expect(def.tags, `${type.name} のobject_defはlocationタグを持つ`).toContain(locationTag);
    }

    // object_defs→location_types: locationタグを持つ土地object_defはすべて、少なくとも1つの
    // location_typeから参照される（定義したのに絶対に生成されない土地を作らない）。
    const referencedDefIds = new Set(generation.locationTypes.map((t) => t.objectDefGlobalId));
    for (let id = 0; id < codex.objects.count; id++) {
      const def = codex.objects.get(id);
      if (def === undefined || !def.tags.includes(locationTag)) continue;
      expect(
        referencedDefIds.has(id),
        `locationタグを持つ '${def.name}' はいずれかのlocation_typeから参照される`,
      ).toBe(true);
    }
  });

  it('islandスコープが要求仕様を満たす', () => {
    const island = scopeOf('island');

    expect(island.siteCountMin, '生成される土地は10〜20個(要求)').toBe(10);
    expect(island.siteCountMax).toBe(20);
    expect(island.hullCoast, '外周のサイトを海岸帯へ寄せ、島が海岸に囲まれることを保証する').toBe(true);
    expect(island.coastBand).toBeGreaterThan(0);

    const mountain = singleOrUndefined(island.guarantees, (g) => g.locationType === 'mountain_peak');
    expect(mountain).toBeDefined();
    expect(mountain?.count, '島には必ず山がひとつ(要求)').toBe(1);
    expect(mountain?.axis).toBe('elevation');
    expect(mountain?.pick).toBe('max');
  });

  it('海岸型は海岸帯に限定され、内陸型は海岸帯から除外される', () => {
    const island = scopeOf('island');
    const coastalTypes = ['sandy_beach', 'rocky_coast', 'cliff_coast'];

    for (const type of generation.locationTypes) {
      const coastal = singleOrUndefined(type.hardLimits, (l) => l.axis === 'coastal_distance');
      expect(coastal, `${type.name} はcoastal_distanceのhard_limitを持つ`).toBeDefined();

      if (coastalTypes.includes(type.name))
        expect(coastal?.max, `海岸型 ${type.name} は海岸帯(coast_band以下)にしか出ない`).toBe(
          island.coastBand,
        );
      else
        expect(coastal?.min, `内陸型 ${type.name} は海岸帯には出ない(海岸過多の防止)`).toBe(
          island.coastBand + 1,
        );
    }
  });
});
