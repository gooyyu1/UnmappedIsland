import type { AxisDef, GeneratorLayer } from './AxisDef';
import type { GenerationScopeDef } from './GenerationScopeDef';
import type { Site } from './IslandMap';
import { noiseAtIslandPoint } from './ValueNoise';
import { ISLAND_RADIUS } from './SitePlacer';

/**
 * 各サイトの軸値のサンプリング（TerrainGeneration.md 3.1節）。AxisDefのジェネレータ層
 * （distance_field / layered_noise）を[0,1]で計算して重み平均し、AxisDef.rangeの整数値へ
 * 量子化してSite.axisValuesに書き込む。
 */

/** 海岸帯の判定（generation_scopesのcoast_band・hull_coast）が対象にする、
 * 生成側が規約として知っている軸名（WorldVocabularyの"volume"・"weight"と同じ立ち位置）。
 * この名前の軸が定義されていなければ、海岸帯クランプは単に何もしない。 */
const COASTAL_DISTANCE_AXIS_NAME = 'coastal_distance';

export function sample(
  axes: ReadonlyMap<string, AxisDef>,
  sites: readonly Site[],
  seed: number,
  scope: GenerationScopeDef,
): void {
  for (const site of sites) {
    for (const axis of axes.values()) {
      let weighted = 0;
      let weightSum = 0;
      for (const layer of axis.layers) {
        weighted += sampleLayer(layer, site, seed) * layer.weight;
        weightSum += layer.weight;
      }

      const normalized = weightSum > 0 ? weighted / weightSum : 0;
      const value = axis.range.min + Math.round(normalized * (axis.range.max - axis.range.min));
      site.axisValues.set(axis.name, axis.range.clamp(value));
    }

    // 外周リングのサイトを海岸帯へクランプし、島が必ず海岸（の型しかマッチしない領域）で
    // 囲まれることを保証する（3.4節のバランス保証の一部を配置の構造で担う）。
    const coastal = site.axisValues.get(COASTAL_DISTANCE_AXIS_NAME);
    if (scope.hullCoast && site.onCoastRing && coastal !== undefined) {
      site.axisValues.set(COASTAL_DISTANCE_AXIS_NAME, Math.min(coastal, scope.coastBand));
    }
  }
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
