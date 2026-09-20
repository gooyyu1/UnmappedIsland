import { describe, expect, it } from 'vitest';
import { assignTypes } from '../../src/domain/generation/LocationTypeMatcher';
import { Site } from '../../src/domain/generation/IslandMap';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import type { GenerationDefs } from '../../src/domain/generation/GenerationDefs';
import type { GenerationScopeDef } from '../../src/domain/generation/GenerationScopeDef';

/**
 * guarantees（カバレッジ保証、TerrainGeneration.md 3.4節）の強制割当が、**成立する配り方が在るなら
 * 必ずそれを採る**ことの検証。
 *
 * **同梱のterrain_generation.yamlではなく、この場で組んだ宣言で見る。** 保証が競合するには、同じ
 * サイトしか置けない保証が2件以上要る——同梱の宣言は保証が1件なので、競合そのものが起きない。
 */
describe('guaranteesの強制割当', () => {
  /**
   * 標高だけを軸に、保証を2件持つ島。`crater`は最上部（95以上）にしか置けず、`mountain_peak`は
   * 80以上ならどこでも置ける。**宣言順に先着で固定すると、`mountain_peak`が最高標高のサイトを取り、
   * `crater`がhard_limitsを満たさないサイトへ降りる。**
   */
  const yaml = (guarantees: readonly string[]): string => `
object_defs:
  peak_land: {}
  crater_land: {}
  slope_land: {}

axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 100}

location_types:
  mountain_peak:
    object_def: peak_land
    axis_preferences:
      elevation: {ideal: 100, tolerance: 20}
    hard_limits:
      elevation: {min: 80}
  crater:
    object_def: crater_land
    axis_preferences:
      elevation: {ideal: 100, tolerance: 20}
    hard_limits:
      elevation: {min: 95}
  slope:
    object_def: slope_land
    is_fallback: true
    priority: 1
    axis_preferences:
      elevation: {ideal: 0, tolerance: 40}

generation_scopes:
  island:
    site_count: {min: 3, max: 3}
    coast_band: 15
    hull_coast: false
    extra_edge_detour_factor: 1.8
    diameter_meters: 6700
    walk_meters_per_hour: 4000
    climb_meters_per_hour: 600
    elevation_axis: elevation
    elevation_top_meters: 400
    max_sites_per_type: 3
    crowding_penalty: 0.25
    guarantees:
${guarantees.map((line) => `      - ${line}`).join('\n')}
`;

  const PEAK_GUARANTEE = '{location_type: mountain_peak, count: 1, axis: elevation, pick: max}';
  const CRATER_GUARANTEE = '{location_type: crater, count: 1, axis: elevation, pick: max}';

  function load(guarantees: readonly string[]): { defs: GenerationDefs; scope: GenerationScopeDef } {
    const codex = new WorldCodexYamlLoader()
      .load('terrain_generation.yaml', yaml(guarantees))
      .buildAndReset();
    return { defs: codex.generation!, scope: codex.generation!.scopes.get('island')! };
  }

  /** 標高だけを持つサイト群（座標はマッチングに効かないので原点に置く）。 */
  function sitesWithElevations(elevations: readonly number[]): Site[] {
    return elevations.map((elevation, index) => {
      const site = new Site(index, 0, 0, false);
      site.axisValues.set('elevation', elevation);
      return site;
    });
  }

  function typeNamesOf(sites: readonly Site[]): string[] {
    return sites.map((s) => s.type!.name);
  }

  it('先に見た保証が譲れば両方が成り立つなら、譲らせる', () => {
    const { defs, scope } = load([PEAK_GUARANTEE, CRATER_GUARANTEE]);
    // 標高100のサイトはcraterにもmountain_peakにも置けるが、craterは95以上にしか置けない。
    const sites = sitesWithElevations([100, 85, 10]);

    assignTypes(defs, scope, sites);

    // 先着で固定する実装では、mountain_peakが標高100を取り、craterが標高85（hard_limits違反）へ降りる。
    expect(typeNamesOf(sites)).toEqual(['crater', 'mountain_peak', 'slope']);
  });

  it('保証の宣言順は、配り方を変えない', () => {
    const forward = sitesWithElevations([100, 85, 10]);
    const reversed = sitesWithElevations([100, 85, 10]);

    const first = load([PEAK_GUARANTEE, CRATER_GUARANTEE]);
    assignTypes(first.defs, first.scope, forward);
    const second = load([CRATER_GUARANTEE, PEAK_GUARANTEE]);
    assignTypes(second.defs, second.scope, reversed);

    expect(typeNamesOf(reversed)).toEqual(typeNamesOf(forward));
  });

  it('どう振り替えても足りないサイトへは、hard_limitsを満たさなくても保証を置く', () => {
    const { defs, scope } = load([PEAK_GUARANTEE, CRATER_GUARANTEE]);
    // 95以上のサイトが1つも無い島。craterは置けるサイトを持たないが、保証は絶対。
    const sites = sitesWithElevations([90, 85, 10]);

    assignTypes(defs, scope, sites);

    // 置けるサイトが在るmountain_peakを先に満たし、craterは残るサイトのうち最高標高のものへ降りる。
    expect(typeNamesOf(sites)).toEqual(['mountain_peak', 'crater', 'slope']);
  });
});
