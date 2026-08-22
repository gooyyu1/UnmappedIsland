import type { GenerationDefs } from './GenerationDefs';
import { Pcg32 } from './Pcg32';
import { IslandMap } from './IslandMap';
import { place } from './SitePlacer';
import { sample } from './AxisSampler';
import { assignTypes } from './LocationTypeMatcher';
import { triangulate } from './DelaunayTriangulator';
import { build } from './PathNetworkBuilder';
import { assignNames } from './NameAssigner';

/**
 * 地形生成パイプラインのオーケストレータ（TerrainGeneration.md 2節）。
 *
 *   サイト配置（SitePlacer） → 軸サンプリング（AxisSampler） → LocationTypeマッチング
 *   （LocationTypeMatcher、guarantees含む） → Delaunay三角形分割 → MST+復活辺の
 *   パスネットワーク（PathNetworkBuilder） → 命名（NameAssigner）
 *
 * を順に実行し、結果をIslandMapとして返す。WorldObjectには一切触れない純粋な計算で、
 * 乱数はseedだけに依存する（同じ定義+同じシード→常に同じIslandMap）。乱数を引くのは配置と命名で、
 * **それぞれ別の列を使う**（RandomPurpose）——軸は座標を鍵にしたノイズ（ValueNoise）、型・三角形
 * 分割・パスネットワークは乱数を引かない。世界への実体化はIslandSpawnerが担う。
 *
 * 生成スコープを差し替えれば同じロジックがそのまま走る（島と構造物内部で生成ロジックを
 * 共有するという方針、3.7節。structure_interiorスコープの定義・再帰実行は今後の課題）。
 */
export function generate(defs: GenerationDefs | undefined, scopeName: string, seed: number): IslandMap {
  if (defs === undefined)
    throw new Error('地形生成の定義（terrain_generation.yaml）がロードされていません。');
  const scope = defs.scopes.get(scopeName);
  if (scope === undefined) throw new Error(`生成スコープ '${scopeName}' が定義されていません。`);

  const sites = place(scope, Pcg32.forPurpose(seed, 'sites'));
  sample(defs.axes, sites, seed, scope);
  assignTypes(defs, scope, sites);
  const delaunayEdges = triangulate(sites);
  const edges = build(sites, delaunayEdges, scope);
  assignNames(sites, Pcg32.forPurpose(seed, 'names'));

  return new IslandMap(scopeName, seed, sites, edges);
}
