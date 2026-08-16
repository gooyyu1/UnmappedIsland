import { OBJECT_ART } from '../assets/objectArt';
import type { CraftingNetwork, NetworkEdge, NetworkNode } from './craftingGraph';
import { buildCraftingNetwork, objectNodeId } from './craftingGraph';
import type { CodexView } from './CodexView';
import { escapeHtml } from './CodexView';
import type { LayoutNode } from './networkLayout';
import { layoutLayered } from './networkLayout';

/**
 * クラフトネットワークのページ。
 * 全体図を1枚のSVGに描き、`#/network/<識別子>` ではその型の上流（材料側）・下流（成果物側）を
 * ハイライトする。ページ全体の組み立てはpages.tsと同じく文字列を返すだけで、DOMには触らない。
 */

/**
 * ノードの寸法。オブジェクトは絵と名前、タグは1行のラベルが収まる大きさ。
 * 工程はラベルを持たない小さな丸——名前を並べても情報価値の割に横幅を食う。読み手に要るのは
 * 「ここが合流・分岐の結節点」という印で、名前はツールチップ（title）で足りる。
 */
const OBJECT_NODE = { width: 104, height: 92 };
const STEP_NODE = { width: 16, height: 16 };
const TAG_NODE = { width: 84, height: 24 };
const ART_SIZE = 56;
const FONT_SIZE = 11;

/** ハイライトしたノードのDOM id（main.tsがスクロール先に使う）。 */
export function networkNodeDomId(objectName: string): string {
  return `net-${objectNodeId(objectName)}`;
}

export function renderNetworkPage(view: CodexView, highlightObjectName?: string): string {
  const network = buildCraftingNetwork(view.objectDefs(), view.codex);
  const highlightId = highlightObjectName === undefined ? undefined : objectNodeId(highlightObjectName);
  const highlight =
    highlightId !== undefined && network.nodes.some((node) => node.id === highlightId)
      ? collectHighlight(network, highlightId)
      : undefined;

  const svg = renderSvg(view, network, highlight);
  const highlightNote =
    highlight === undefined
      ? ''
      : `<p class="muted">「${escapeHtml(view.objectLabel(highlightObjectName!))}」の材料側（左）と` +
        `成果物側（右）を強調しています。<a href="#/network">強調を解除</a></p>`;

  return (
    `<p class="breadcrumb"><a href="#/">← オブジェクト一覧</a></p>` +
    `<h1>クラフトネットワーク</h1>` +
    `<p class="muted">何から何が作れるか（探索・combination・レシピ）の全体図。素材ほど左に並ぶ。` +
    `型は押すとそのチェーンを強調し、強調中の型をもう一度押すとその型のページへ。` +
    `小さな丸は操作の結節点（名前は重ねると出て、押すと宣言元の型のページへ）、破線は消費されない` +
    `入力（道具）やタグへの所属、点線の戻り線は循環。</p>` +
    highlightNote +
    `<p class="network-toolbar">` +
    `<button type="button" data-network-zoom="out" aria-label="縮小">−</button>` +
    `<span class="network-zoom-level" data-network-zoom-level>100%</span>` +
    `<button type="button" data-network-zoom="in" aria-label="拡大">＋</button>` +
    `<button type="button" data-network-zoom="reset">リセット</button>` +
    `</p>` +
    `<div class="network-scroll">${svg}</div>`
  );
}

// ------------------------------------------------------------------
// ハイライト（上流＋下流の到達集合）
// ------------------------------------------------------------------

interface Highlight {
  readonly nodes: ReadonlySet<string>;
  readonly edges: ReadonlySet<number>;
  readonly target: string;
}

function collectHighlight(network: CraftingNetwork, startId: string): Highlight {
  const forward = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, value: string): void => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [value]);
    else list.push(value);
  };
  for (const edge of network.edges) {
    push(forward, edge.from, edge.to);
    push(reverse, edge.to, edge.from);
  }

  const reach = (adjacency: ReadonlyMap<string, readonly string[]>): Set<string> => {
    const seen = new Set<string>();
    const queue = [startId];
    while (queue.length > 0)
      for (const next of adjacency.get(queue.shift()!) ?? [])
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    return seen;
  };

  const upstream = reach(reverse);
  const downstream = reach(forward);
  const nodes = new Set<string>([startId, ...upstream, ...downstream]);

  // 線は「startへ向かう途中」（行き先が上流）か「startから離れる途中」（出元が下流）のものだけを
  // 強調する。上流どうしでも別の系統へ向かう線は、startのチェーンには乗っていない。
  const edges = new Set<number>();
  for (const [index, edge] of network.edges.entries()) {
    const towardStart = upstream.has(edge.to) || edge.to === startId;
    const fromStart = downstream.has(edge.from) || edge.from === startId;
    if (towardStart || fromStart) edges.add(index);
  }
  return { nodes, edges, target: startId };
}

// ------------------------------------------------------------------
// SVG描画
// ------------------------------------------------------------------

function renderSvg(view: CodexView, network: CraftingNetwork, highlight: Highlight | undefined): string {
  const layoutNodes: LayoutNode[] = network.nodes.map((node) => ({
    id: node.id,
    ...(node.kind === 'object' ? OBJECT_NODE : node.kind === 'step' ? STEP_NODE : TAG_NODE),
  }));
  const layout = layoutLayered(layoutNodes, network.edges);
  const sizeById = new Map(layoutNodes.map((node) => [node.id, node]));

  const edges = network.edges
    .map((edge, index) =>
      edgeHtml(edge, index, layout.positions, sizeById, layout.backEdgeIndexes, highlight),
    )
    .join('');
  const nodes = network.nodes.map((node) => nodeHtml(view, node, layout.positions, highlight)).join('');

  return (
    `<svg class="network" width="${layout.width}" height="${layout.height}" ` +
    `viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="クラフトネットワーク">` +
    `<defs>` +
    `<marker id="net-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M0,0 L8,4 L0,8 z" class="net-arrow-head"/></marker>` +
    `<marker id="net-arrow-hl" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M0,0 L8,4 L0,8 z" class="net-arrow-head-hl"/></marker>` +
    `</defs>` +
    edges +
    nodes +
    `</svg>`
  );
}

function edgeHtml(
  edge: NetworkEdge,
  index: number,
  positions: ReadonlyMap<string, { x: number; y: number }>,
  sizeById: ReadonlyMap<string, LayoutNode>,
  backEdgeIndexes: ReadonlySet<number>,
  highlight: Highlight | undefined,
): string {
  const from = positions.get(edge.from);
  const to = positions.get(edge.to);
  const fromSize = sizeById.get(edge.from);
  const toSize = sizeById.get(edge.to);
  if (from === undefined || to === undefined || fromSize === undefined || toSize === undefined) return '';

  const startX = from.x + fromSize.width;
  const startY = from.y + fromSize.height / 2;
  const endX = to.x;
  const endY = to.y + toSize.height / 2;

  const isBack = backEdgeIndexes.has(index);
  let path: string;
  if (isBack) {
    // 戻り辺（右から左へ）。図の他の線と見分けられるよう、下へ膨らむ曲線で回す。
    const dip = 70;
    path = `M ${startX} ${startY} C ${startX + dip} ${startY + dip}, ${endX - dip} ${endY + dip}, ${endX} ${endY}`;
  } else {
    const bend = Math.max(30, (endX - startX) * 0.45);
    path = `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
  }

  const highlighted = highlight?.edges.has(index) ?? false;
  const classes = ['net-edge', `net-${edge.kind}`];
  if (edge.kind === 'membership' || edge.consumed === false) classes.push('net-dashed');
  if (isBack) classes.push('net-back');
  if (highlight !== undefined) classes.push(highlighted ? 'net-hl' : 'net-dim');
  const marker = highlighted ? 'net-arrow-hl' : 'net-arrow';

  const label =
    edge.countLabel === undefined
      ? ''
      : `<text class="net-count${highlight === undefined ? '' : highlighted ? ' net-hl' : ' net-dim'}" ` +
        `x="${endX - 16}" y="${endY - 7}" text-anchor="end">${escapeHtml(edge.countLabel)}</text>`;

  return `<path class="${classes.join(' ')}" d="${path}" marker-end="url(#${marker})"/>` + label;
}

function nodeHtml(
  view: CodexView,
  node: NetworkNode,
  positions: ReadonlyMap<string, { x: number; y: number }>,
  highlight: Highlight | undefined,
): string {
  const position = positions.get(node.id);
  if (position === undefined) return '';

  const state =
    highlight === undefined
      ? ''
      : node.id === highlight.target
        ? ' net-target'
        : highlight.nodes.has(node.id)
          ? ' net-hl'
          : ' net-dim';

  if (node.kind === 'object') return objectNodeHtml(view, node.objectName, position, state);
  if (node.kind === 'step') return stepNodeHtml(view, node, position, state);
  return pillNodeHtml(
    `#/by-tag/${encodeURIComponent(node.tagName)}`,
    node.tagName,
    node.tagName,
    TAG_NODE,
    'net-tag',
    position,
    state,
  );
}

function objectNodeHtml(
  view: CodexView,
  objectName: string,
  position: { x: number; y: number },
  state: string,
): string {
  const { width, height } = OBJECT_NODE;
  const url = OBJECT_ART.get(objectName);
  const artX = position.x + (width - ART_SIZE) / 2;
  const art =
    url === undefined
      ? `<rect class="net-art-missing" x="${artX}" y="${position.y + 6}" width="${ART_SIZE}" height="${ART_SIZE}" rx="6"/>`
      : `<image href="${url}" x="${artX}" y="${position.y + 6}" width="${ART_SIZE}" height="${ART_SIZE}" preserveAspectRatio="xMidYMid meet"/>`;

  // クリックの行き先は2段階: まだ強調されていない型はまず強調（このネットワークの中でチェーンを
  // 見せる）、すでに強調されている型（対象とそのチェーン上）はその型のページへ。図を眺めている
  // 段階でいきなりページへ飛ばされるより、まず文脈（チェーン）を見せるほうが探索の流れに合う。
  const emphasized = state === ' net-target' || state === ' net-hl';
  const href = emphasized
    ? `#/object/${encodeURIComponent(objectName)}`
    : `#/network/${encodeURIComponent(objectName)}`;

  return (
    `<a class="net-node net-object${state}" id="${networkNodeDomId(objectName)}" href="${href}">` +
    `<rect class="net-node-box" x="${position.x}" y="${position.y}" width="${width}" height="${height}" rx="8"/>` +
    `<title>${escapeHtml(objectName)}</title>` +
    art +
    svgText(view.objectLabel(objectName), position.x + width / 2, position.y + height - 12, width - 10) +
    `</a>`
  );
}

/** 工程はラベル無しの小さな丸。名前はツールチップに置き、クリックで宣言元の型のページへ。 */
function stepNodeHtml(
  view: CodexView,
  node: NetworkNode & { kind: 'step' },
  position: { x: number; y: number },
  state: string,
): string {
  const label =
    node.stepKind === 'recipe'
      ? node.stepName
      : view.interactionLabel(node.ownerName, node.stepName, node.stepKind === 'combination');
  return (
    `<a class="net-node net-step${state}" href="#/object/${encodeURIComponent(node.ownerName)}">` +
    `<circle class="net-step-dot" cx="${position.x + STEP_NODE.width / 2}" ` +
    `cy="${position.y + STEP_NODE.height / 2}" r="${STEP_NODE.width / 2}"/>` +
    `<title>${escapeHtml(`${label}（${node.ownerName}.${node.stepName}）`)}</title>` +
    `</a>`
  );
}

function pillNodeHtml(
  href: string,
  label: string,
  identifier: string,
  size: { width: number; height: number },
  kindClass: string,
  position: { x: number; y: number },
  state: string,
): string {
  return (
    `<a class="net-node ${kindClass}${state}" href="${href}">` +
    `<rect class="net-node-box" x="${position.x}" y="${position.y}" ` +
    `width="${size.width}" height="${size.height}" rx="${size.height / 2}"/>` +
    `<title>${escapeHtml(identifier)}</title>` +
    svgText(
      label,
      position.x + size.width / 2,
      position.y + size.height / 2 + FONT_SIZE / 2 - 1,
      size.width - 14,
    ) +
    `</a>`
  );
}

/** 中央揃えのテキスト。推定幅がノードからはみ出すときはtextLengthで詰める（SVGは自動で折り返さない）。 */
function svgText(text: string, centerX: number, baselineY: number, maxWidth: number): string {
  // 全角をfontSize・半角を55%として推定する（正確な計測はDOMが要るため、詰めるかどうかの目安だけ）。
  let estimated = 0;
  // eslint-disable-next-line no-control-regex
  for (const char of text) estimated += /[\x00-\xff]/.test(char) ? FONT_SIZE * 0.55 : FONT_SIZE;
  const clamp = estimated > maxWidth ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<text class="net-label" x="${centerX}" y="${baselineY}" text-anchor="middle"${clamp}>${escapeHtml(text)}</text>`;
}

/** objectNameがネットワークに居るか（型のページが「ネットワークで見る」リンクを出すかの判定）。 */
export function isInCraftingNetwork(view: CodexView, objectName: string): boolean {
  const network = buildCraftingNetwork(view.objectDefs(), view.codex);
  return network.nodes.some((node) => node.id === objectNodeId(objectName));
}
