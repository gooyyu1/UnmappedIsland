import type { AxisDef, GeneratorLayer } from './AxisDef';
import type { GenerationScopeDef } from './GenerationScopeDef';
import type { Site } from './IslandMap';
import { noiseAtIslandPoint } from './ValueNoise';
import { ISLAND_RADIUS } from './SitePlacer';

/**
 * 各サイトの軸値のサンプリング（TerrainGeneration.md 3.1節）。AxisDefのジェネレータ層
 * （distance_field / layered_noise）を[0,1]で計算して重み平均し、AxisDef.rangeの整数値へ
 * 量子化してSite.axisValuesに書き込む。`stretch_sites_to_range`の軸は、量子化の前に
 * 島全体のサンプルを[0,1]いっぱいへ引き伸ばす。
 */

/** 海岸帯の判定（generation_scopesのcoast_band・hull_coast）が対象にする、
 * 生成側が規約として知っている軸名（WorldVocabularyの"volume"・"weight"と同じ立ち位置）。
 * この名前の軸が定義されていなければ、海岸帯クランプは単に何もしない。 */
const COASTAL_DISTANCE_AXIS_NAME = 'coastal_distance';

export function assignAxisValues(
  axes: ReadonlyMap<string, AxisDef>,
  sites: readonly Site[],
  seed: number,
  scope: GenerationScopeDef,
): void {
  for (const axis of axes.values()) {
    const sampled = sites.map((site) => sampleAxis(axis, site, seed));
    const normalized = axis.stretchesSitesToRange ? stretchedToUnitRange(sampled) : sampled;

    for (let i = 0; i < sites.length; i++) {
      const value = axis.range.min + Math.round(normalized[i] * (axis.range.max - axis.range.min));
      sites[i].axisValues.set(axis.name, axis.range.clamp(value));
    }
  }

  // 外周リングのサイトを海岸帯へクランプし、島が必ず海岸（の型しかマッチしない領域）で
  // 囲まれることを保証する（3.4節のバランス保証の一部を配置の構造で担う）。
  for (const site of sites) {
    const coastal = site.axisValues.get(COASTAL_DISTANCE_AXIS_NAME);
    if (scope.clampsHullSitesToCoast && site.onCoastRing && coastal !== undefined) {
      site.axisValues.set(COASTAL_DISTANCE_AXIS_NAME, Math.min(coastal, scope.coastBandMaxDistance));
    }
  }
}

/** 1サイト分の、ジェネレータ層を重み平均した[0,1]のサンプル値。 */
function sampleAxis(axis: AxisDef, site: Site, seed: number): number {
  let weighted = 0;
  let weightSum = 0;
  for (const layer of axis.layers) {
    weighted += sampleLayer(layer, site, seed) * layer.weight;
    weightSum += layer.weight;
  }

  return weightSum > 0 ? weighted / weightSum : 0;
}

/**
 * サンプル値を、最小が0・最大が1へ来るよう一次変換したもの（AxisDef.stretchesSitesToRange）。
 * 全サイトが同じ値のときは区別が無いので、そろって下端に置く。
 */
function stretchedToUnitRange(sampled: readonly number[]): number[] {
  const lowest = Math.min(...sampled);
  const highest = Math.max(...sampled);
  if (highest === lowest) return sampled.map(() => 0);

  return sampled.map((value) => (value - lowest) / (highest - lowest));
}

/** ジェネレータ1層の[0,1]サンプル値。 */
function sampleLayer(layer: GeneratorLayer, site: Site, seed: number): number {
  switch (layer.type) {
    case 'distance_field': {
      // 島の縁からの距離場: 縁=0、中心=1。
      const radius = Math.sqrt(site.x * site.x + site.y * site.y);
      return 1.0 - Math.min(1.0, radius / ISLAND_RADIUS);
    }

    case 'layered_noise':
      return noiseAtIslandPoint(seed + layer.seedOffset, site.x, site.y, layer.octaves, layer.frequency);

    default:
      throw new Error(`未知のジェネレータ層: ${layer.type as string}`);
  }
}
