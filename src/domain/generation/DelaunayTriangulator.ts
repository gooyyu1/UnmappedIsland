import type { Site } from './IslandMap';
import { ISLAND_RADIUS } from './SitePlacer';

type Point = readonly [number, number];
type Triangle = readonly [number, number, number];

/**
 * Delaunay三角形分割（Bowyer-Watsonの逐次挿入法）。辺が交差しないという数学的性質を利用して、
 * 交差なしのパスネットワークの土台を作る（TerrainGeneration.md 3.5節）。サイト数は高々20のため、
 * 素朴なO(n²)実装で十分。出力は重複のない無向辺（A &lt; B に正規化、(A, B)の辞書順）のリスト。
 */
export function triangulate(sites: readonly Site[]): readonly [number, number][] {
  if (sites.length < 2) return [];
  if (sites.length === 2) return [[0, 1]];

  // すべてのサイト（半径ISLAND_RADIUS以内）を確実に内包するスーパートライアングル。
  // 頂点はsites.length以降のindexで表す。
  const m = ISLAND_RADIUS * 20;
  const points: Point[] = sites.map((s): Point => [s.x, s.y]);
  const superA = points.length;
  points.push([0, 3 * m]);
  const superB = points.length;
  points.push([-3 * m, -3 * m]);
  const superC = points.length;
  points.push([3 * m, -3 * m]);

  let triangles: Triangle[] = [[superA, superB, superC]];

  for (let p = 0; p < sites.length; p++) {
    // 外接円にpを含む三角形（bad triangles）を除去し、その穴の境界辺でpと再三角形化する。
    const bad = triangles.filter((t) => inCircumcircle(points, t, p));
    const badSet = new Set(bad);
    triangles = triangles.filter((t) => !badSet.has(t));

    const boundary = new Map<string, number>();
    for (const [a, b, c] of bad) {
      countEdge(boundary, a, b);
      countEdge(boundary, b, c);
      countEdge(boundary, c, a);
    }

    for (const [key, count] of boundary) {
      if (count !== 1) continue; // 2つのbad triangleで共有された辺は穴の内部
      const [ea, eb] = parseKey(key);
      triangles.push([ea, eb, p]);
    }
  }

  // スーパートライアングルの頂点を含む三角形を落とし、残りから無向辺を集める。
  const edgeKeys = new Set<string>();
  for (const [a, b, c] of triangles) {
    if (a >= sites.length || b >= sites.length || c >= sites.length) continue;
    addNormalizedEdge(edgeKeys, a, b);
    addNormalizedEdge(edgeKeys, b, c);
    addNormalizedEdge(edgeKeys, c, a);
  }

  const edges = Array.from(edgeKeys, (key): [number, number] => parseKey(key));
  edges.sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  return edges;
}

function normalize(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

function addNormalizedEdge(edgeKeys: Set<string>, a: number, b: number): void {
  const [na, nb] = normalize(a, b);
  edgeKeys.add(`${na},${nb}`);
}

function parseKey(key: string): [number, number] {
  const [a, b] = key.split(',').map(Number);
  return [a, b];
}

function countEdge(boundary: Map<string, number>, a: number, b: number): void {
  const [na, nb] = normalize(a, b);
  const key = `${na},${nb}`;
  boundary.set(key, (boundary.get(key) ?? 0) + 1);
}

/** 点pが三角形(a,b,c)の外接円の内部にあるか（行列式による判定）。 */
function inCircumcircle(points: readonly Point[], triangle: Triangle, p: number): boolean {
  const a = triangle[0];
  let [b, c] = [triangle[1], triangle[2]];
  // 反時計回りに揃える（行列式判定は向きに依存するため）。
  const orientation = cross(points[a], points[b], points[c]);
  if (orientation < 0) [b, c] = [c, b];

  const ax = points[a][0] - points[p][0],
    ay = points[a][1] - points[p][1];
  const bx = points[b][0] - points[p][0],
    by = points[b][1] - points[p][1];
  const cx = points[c][0] - points[p][0],
    cy = points[c][1] - points[p][1];

  const det =
    (ax * ax + ay * ay) * (bx * cy - cx * by) -
    (bx * bx + by * by) * (ax * cy - cx * ay) +
    (cx * cx + cy * cy) * (ax * by - bx * ay);

  return det > 0;
}

function cross(o: Point, p: Point, q: Point): number {
  return (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
}
