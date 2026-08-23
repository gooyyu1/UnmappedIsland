import { describe, expect, it } from 'vitest';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import type { WorldCodex } from '../../src/domain/WorldCodex';

/**
 * 地形生成定義（axes/location_types/generation_scopesの3ルートキー、terrain_generation.yaml相当）の
 * ローダーに対する自動テスト。object_defs/traitsと同じ厳格モード（重複・未知キー・参照不在はエラー）で
 * 読めることを確認する。
 */
describe('WorldCodexYamlLoader（地形生成定義）', () => {
  const validYaml = `
object_defs:
  meadow: {}
  peak: {}

axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 70}
        - {type: layered_noise, octaves: 3, frequency: 2, seed_offset: 11, weight: 30}

location_types:
  meadow:
    object_def: meadow
    applicable_scopes: [island]
    axis_preferences:
      elevation: {ideal: 30, tolerance: 25, weight: 100}
    hard_limits:
      elevation: {max: 60}
  peak:
    object_def: peak
    move_cost: 2.5
    axis_preferences:
      elevation: {ideal: 100, tolerance: 15}

generation_scopes:
  island:
    site_count: {min: 10, max: 20}
    coast_band: 15
    hull_coast: true
    interior_bias: 0.6
    guarantees:
      - {location_type: peak, count: 1, axis: elevation, pick: max}
`;

  function load(yaml: string): WorldCodex {
    return new WorldCodexYamlLoader().load('terrain_generation.yaml', yaml).buildAndReset();
  }

  it('妥当なaxes/location_types/generation_scopesからGenerationDefsを組み立てる', () => {
    const codex = load(validYaml);
    const generation = codex.generation;

    expect(generation).toBeDefined();
    if (generation === undefined) return;

    const elevation = generation.axes.get('elevation');
    expect(elevation).toBeDefined();
    if (elevation === undefined) return;
    expect(elevation.range.min).toBe(0);
    expect(elevation.range.max).toBe(100);
    expect(elevation.layers).toHaveLength(2);
    expect(elevation.layers[0].type).toBe('distance_field');
    expect(elevation.layers[0].weight).toBe(70);
    expect(elevation.layers[1].type).toBe('layered_noise');
    expect(elevation.layers[1].octaves).toBe(3);
    expect(elevation.layers[1].seedOffset).toBe(11);

    expect(generation.locationTypes).toHaveLength(2);
    const meadow = generation.locationTypes[0];
    expect(meadow.name).toBe('meadow');
    expect(meadow.objectDefGlobalId).toBe(codex.objectNames.getId('meadow'));
    expect(meadow.appliesTo('island')).toBe(true);
    expect(meadow.appliesTo('structure_interior')).toBe(false);
    expect(meadow.moveCost).toBe(1); // move_cost省略時は1(等倍)
    expect(meadow.preferences[0].tolerance).toBe(25);
    expect(meadow.hardLimits[0].allows(60)).toBe(true);
    expect(meadow.hardLimits[0].allows(61)).toBe(false);

    const peak = generation.locationTypes[1];
    expect(peak.appliesTo('island')).toBe(true); // applicable_scopes省略時は全スコープに適用される
    expect(peak.preferences[0].weight).toBe(100); // weight省略時は100(等倍)

    const island = generation.scopes.get('island');
    expect(island).toBeDefined();
    if (island === undefined) return;
    expect(island.siteCountMin).toBe(10);
    expect(island.siteCountMax).toBe(20);
    expect(island.coastBandMaxDistance).toBe(15);
    expect(island.clampsHullSitesToCoast).toBe(true);
    expect(island.interiorBias).toBe(0.6);
    expect(island.guarantees).toHaveLength(1);
    expect(island.guarantees[0].locationType).toBe('peak');
    expect(island.guarantees[0].pick).toBe('max');
  });

  it('地形生成のセクションが無ければgenerationはundefinedになる', () => {
    const codex = load(`
object_defs:
  stone: {}
`);
    expect(codex.generation).toBeUndefined();
  });

  it('axes/location_types/generation_scopesは複数ファイルにまたがってマージされる', () => {
    // axes/location_types/generation_scopesはobject_defs/traitsと同様、複数ファイルへ分割できる。
    const codex = new WorldCodexYamlLoader()
      .load(
        'a.yaml',
        `
object_defs:
  meadow: {}
axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 100}
`,
      )
      .load(
        'b.yaml',
        `
location_types:
  meadow:
    object_def: meadow
    axis_preferences:
      elevation: {ideal: 30, tolerance: 25}
`,
      )
      .buildAndReset();

    expect(codex.generation).toBeDefined();
    expect(codex.generation?.axes.has('elevation')).toBe(true);
    expect(codex.generation?.locationTypes).toHaveLength(1);
  });

  it('location_typesが存在しないobject_defを参照するとエラーになる', () => {
    expect(() =>
      load(`
axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 100}
location_types:
  meadow:
    object_def: no_such_def
    axis_preferences:
      elevation: {ideal: 30, tolerance: 25}
`),
    ).toThrowError(/no_such_def/);
  });

  it('亜種が、その土地のobject_defに無いプロパティを上書きするとエラーになる', () => {
    // 持たないプロパティへの書き込みは黙って消えるので、書き間違いをロード時に止める。
    expect(() =>
      load(`
object_defs:
  meadow:
    props:
      berry_find: {value: 15}
axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 100}
location_types:
  meadow:
    object_def: meadow
    variants:
      - {id: berry, props: {berry_find: 30}}
      - {id: spring, props: {no_such_prop: 30}}
    axis_preferences:
      elevation: {ideal: 30, tolerance: 25}
`),
    ).toThrowError(/no_such_prop/);
  });

  it('同じidの亜種が並ぶとエラーになる', () => {
    expect(() =>
      load(`
object_defs:
  meadow: {}
axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 100}
location_types:
  meadow:
    object_def: meadow
    variants:
      - {id: dewy}
      - {id: dewy}
    axis_preferences:
      elevation: {ideal: 30, tolerance: 25}
`),
    ).toThrowError(/variants/);
  });

  it('axis_preferencesが未知の軸を参照するとエラーになる', () => {
    expect(() =>
      load(`
object_defs:
  meadow: {}
axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 100}
location_types:
  meadow:
    object_def: meadow
    axis_preferences:
      no_such_axis: {ideal: 30, tolerance: 25}
`),
    ).toThrowError(/no_such_axis/);
  });

  it('hard_limitsが未知の軸を参照するとエラーになる', () => {
    expect(() =>
      load(`
object_defs:
  meadow: {}
axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 100}
location_types:
  meadow:
    object_def: meadow
    axis_preferences:
      elevation: {ideal: 30, tolerance: 25}
    hard_limits:
      no_such_axis: {max: 50}
`),
    ).toThrowError(/no_such_axis/);
  });

  it('guaranteesが未知のlocation_typeを参照するとエラーになる', () => {
    expect(() =>
      load(`
object_defs:
  meadow: {}
axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 100}
location_types:
  meadow:
    object_def: meadow
    axis_preferences:
      elevation: {ideal: 30, tolerance: 25}
generation_scopes:
  island:
    site_count: {min: 10, max: 20}
    guarantees:
      - {location_type: no_such_type, axis: elevation, pick: max}
`),
    ).toThrowError(/no_such_type/);
  });

  it('複数ファイルにまたがるaxisの重複はエラーになる', () => {
    const axisYaml = `
axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 100}
`;
    expect(() => new WorldCodexYamlLoader().load('a.yaml', axisYaml).load('b.yaml', axisYaml)).toThrowError(
      /elevation/,
    );
  });

  it('未知のジェネレータ種別はエラーになる', () => {
    expect(() =>
      load(`
axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: blob_scatter, weight: 100}
`),
    ).toThrowError(/blob_scatter/);
  });

  it('axis_preferencesを持たない非フォールバック型はエラーになる', () => {
    // 全軸無関心の型は最近傍マッチングの距離が定義できないため、フォールバック専用。
    expect(() =>
      load(`
object_defs:
  meadow: {}
location_types:
  meadow:
    object_def: meadow
`),
    ).toThrowError(/is_fallback/);
  });
});
