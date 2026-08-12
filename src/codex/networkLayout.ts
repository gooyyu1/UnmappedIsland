/**
 * 階層レイアウト（Sugiyama法の簡易版）。左が素材、右が成果物になるよう、ノードを層（列）へ
 * 割り当てて座標を決める。グラフの意味は知らず、ノードの寸法と辺だけを受け取る純関数。
 *
 * 依存を持たない自前実装で済ませている——現在の規模（ノード100未満）では交差削減が
 * 簡易でも読める図になる。図が大きく・複雑になって読めなくなったら、elkjs等の
 * レイアウトライブラリの導入を検討する（docs/world/WorldCodexViewer.md）。
 */

export interface LayoutNode {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

export interface LayoutEdge {
  readonly from: string;
  readonly to: string;
}

export interface LayoutResult {
  /** ノードidごとの左上座標。 */
  readonly positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>;

  /** 戻り辺（ループを断ち切った辺）のedges内index。表示側はこれだけ別の描き方をする。 */
  readonly backEdgeIndexes: ReadonlySet<number>;

  readonly width: number;
  readonly height: number;
}

/** 列の間隔（線を描く余白）と、同じ列の中のノードの間隔。 */
const COLUMN_GAP = 90;
const ROW_GAP = 18;
const PADDING = 24;

export function layoutLayered(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): LayoutResult {
  const nodeIds = nodes.map((node) => node.id);
  const indexById = new Map(nodeIds.map((id, index) => [id, index]));

  // 1. DFSで戻り辺を見つけてループを断ち切る（残りはDAGになる）。
  const backEdgeIndexes = findBackEdges(nodeIds, edges, indexById);
  const forwardEdges = edges.filter((_, index) => !backEdgeIndexes.has(index));

  // 2. 最長経路で層（列）を決める。入ってくる辺が無いノード（土地など）が層0＝最左になる。
  const layers = assignLayers(nodeIds, forwardEdges, indexById);

  // 3. 隣接ノードの位置の平均（バリセンタ）で層内の並びを整え、交差を減らす。
  const ordered = orderWithinLayers(nodes, edges, layers, indexById);

  // 4. 座標へ落とす。列のx幅はその列で最も広いノードに合わせ、列は縦方向に中央揃えする。
  return toPositions(nodes, ordered, backEdgeIndexes);
}

function findBackEdges(
  nodeIds: readonly string[],
  edges: readonly LayoutEdge[],
  indexById: ReadonlyMap<string, number>,
): Set<number> {
  const outgoing = new Map<number, { edgeIndex: number; to: number }[]>();
  for (const [edgeIndex, edge] of edges.entries()) {
    const from = indexById.get(edge.from);
    const to = indexById.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const list = outgoing.get(from) ?? [];
    list.push({ edgeIndex, to });
    outgoing.set(from, list);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Array<number>(nodeIds.length).fill(WHITE);
  const backEdges = new Set<number>();

  const visit = (start: number): void => {
    // 明示的なスタックで深さ優先（再帰だとノード数分の深さになりうるため）。
    const stack: { node: number; nextChild: number }[] = [{ node: start, nextChild: 0 }];
    color[start] = GRAY;
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const children = outgoing.get(frame.node) ?? [];
      if (frame.nextChild >= children.length) {
        color[frame.node] = BLACK;
        stack.pop();
        continue;
      }
      const { edgeIndex, to } = children[frame.nextChild++];
      if (color[to] === GRAY) backEdges.add(edgeIndex);
      else if (color[to] === WHITE) {
        color[to] = GRAY;
        stack.push({ node: to, nextChild: 0 });
      }
    }
  };

  for (let index = 0; index < nodeIds.length; index++) if (color[index] === WHITE) visit(index);
  return backEdges;
}

/** DAGの最長経路による層割り当て。layer(v) = max(layer(u) + 1)（uはvへ入る辺の出元）。 */
function assignLayers(
  nodeIds: readonly string[],
  forwardEdges: readonly LayoutEdge[],
  indexById: ReadonlyMap<string, number>,
): number[] {
  const incomingCount = new Array<number>(nodeIds.length).fill(0);
  const outgoing = new Map<number, number[]>();
  for (const edge of forwardEdges) {
    const from = indexById.get(edge.from);
    const to = indexById.get(edge.to);
    if (from === undefined || to === undefined) continue;
    incomingCount[to]++;
    const list = outgoing.get(from) ?? [];
    list.push(to);
    outgoing.set(from, list);
  }

  const layers = new Array<number>(nodeIds.length).fill(0);
  const queue: number[] = [];
  for (let index = 0; index < nodeIds.length; index++) if (incomingCount[index] === 0) queue.push(index);

  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const to of outgoing.get(node) ?? []) {
      layers[to] = Math.max(layers[to], layers[node] + 1);
      if (--incomingCount[to] === 0) queue.push(to);
    }
  }
  return layers;
}

/** 層ごとのノードindexの並び。バリセンタ（隣接ノードの並び位置の平均）で数回整える。 */
function orderWithinLayers(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  layers: readonly number[],
  indexById: ReadonlyMap<string, number>,
): number[][] {
  const layerCount = Math.max(0, ...layers) + 1;
  const ordered: number[][] = Array.from({ length: layerCount }, () => []);
  for (const [index, layer] of layers.entries()) ordered[layer].push(index);

  const neighbors = new Map<number, number[]>();
  const connect = (node: number, other: number): void => {
    const list = neighbors.get(node);
    if (list === undefined) neighbors.set(node, [other]);
    else list.push(other);
  };
  for (const edge of edges) {
    const from = indexById.get(edge.from);
    const to = indexById.get(edge.to);
    if (from === undefined || to === undefined) continue;
    connect(from, to);
    connect(to, from);
  }

  // 並び位置（層内の何番目か）を全ノードで持ち、各層を「隣接ノードの並び位置の平均」で並べ直す。
  const rank = new Array<number>(nodes.length).fill(0);
  const updateRanks = (): void => {
    for (const layer of ordered) for (const [position, node] of layer.entries()) rank[node] = position;
  };
  updateRanks();

  for (let sweep = 0; sweep < 4; sweep++) {
    for (const layer of ordered) {
      const barycenter = (node: number): number => {
        const adjacent = neighbors.get(node) ?? [];
        if (adjacent.length === 0) return rank[node];
        return adjacent.reduce((sum, other) => sum + rank[other], 0) / adjacent.length;
      };
      // Array.prototype.sortは安定なので、平均が同じノードは元の並びを保つ（決定的）。
      layer.sort((a, b) => barycenter(a) - barycenter(b));
      updateRanks();
    }
  }
  return ordered;
}

function toPositions(
  nodes: readonly LayoutNode[],
  ordered: readonly (readonly number[])[],
  backEdgeIndexes: ReadonlySet<number>,
): LayoutResult {
  const layerHeights = ordered.map(
    (layer) =>
      layer.reduce((sum, node) => sum + nodes[node].height, 0) + ROW_GAP * Math.max(0, layer.length - 1),
  );
  const maxHeight = Math.max(0, ...layerHeights);

  const positions = new Map<string, { x: number; y: number }>();
  let x = PADDING;
  for (const [layerIndex, layer] of ordered.entries()) {
    const layerWidth = Math.max(0, ...layer.map((node) => nodes[node].width));
    let y = PADDING + (maxHeight - layerHeights[layerIndex]) / 2;
    for (const node of layer) {
      // 列の中では中央揃え（幅の違うノードが同じ列に混ざるため）。
      positions.set(nodes[node].id, { x: x + (layerWidth - nodes[node].width) / 2, y });
      y += nodes[node].height + ROW_GAP;
    }
    x += layerWidth + COLUMN_GAP;
  }

  return {
    positions,
    backEdgeIndexes,
    width: x - COLUMN_GAP + PADDING,
    height: maxHeight + PADDING * 2,
  };
}
