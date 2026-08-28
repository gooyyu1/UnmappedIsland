import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { worldCodexPath } from './worldCodexFiles';

/**
 * 海区の網（`docs/world/Voyage.md` 3節）を、`voyage.yaml` の宣言そのものから組み立てたもの。
 *
 * **辺の出どころは航路の `spawn` だけ。** 見張り切った海区が立てる航路（`exploration_progress` の
 * `on_max`）と、その航路が渡す先（`destination_zone`）を突き合わせると、どの海区とどの海区が
 * 繋がっているかが1つに決まる——**盤面に実際に出る辺**がこれなので、他の宣言（本土までの残り海区数・
 * 荒天の押し流し先）はこれと突き合わせて検査できる。
 *
 * 隣は海区の側が `zone_toward_*` に1度だけ書くようになった（`GameElementDefinition.md` 6.9節）が、
 * **1箇所へ集まったことと、その1箇所が正しいことは別**なので、辺との突き合わせは残す。
 */
export interface SeaChart {
  /** `sea_zone` traitを名乗る型の名前（宣言順）。 */
  readonly zones: readonly string[];
  /** 辺で繋がった相手（海区と本土。名前順）。 */
  readonly neighbours: ReadonlyMap<string, readonly string[]>;
  /** その海区から本土まで、その海区を含めて最短で何区間か（本土は0）。 */
  readonly distanceToMainland: ReadonlyMap<string, number>;
  /** 海区の生YAML（つまみや押し流し先を読むため）。 */
  readonly bodies: ReadonlyMap<string, unknown>;
  /** traitの生YAML（海区が上書きしていない宣言はこちらに在る）。 */
  readonly traitBodies: ReadonlyMap<string, unknown>;
  /** 航路の型が渡す先（`route_to_shore` のように型で行き先を書かないものは含まない）。 */
  readonly routeDestinations: ReadonlyMap<string, string>;
  /** 航路の生YAML（行き先の残り海区数を読むため）。 */
  readonly routeBodies: ReadonlyMap<string, unknown>;
}

/** 生YAMLのマッピングを名前で辿った先。途中で辿れなくなればundefined。 */
export function nodeAt(node: unknown, ...path: readonly string[]): unknown {
  let current = node;
  for (const key of path) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** 名前で引ける節（`traits:`・`object_defs:` など）の中身を、名前と組で返す。それ以外は空。 */
export function namedEntries(node: unknown): readonly (readonly [string, unknown])[] {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return [];
  return Object.entries(node as Record<string, unknown>);
}

/** 1つでもリストでも書ける宣言（`spawn`・`move`・`destroy`）を、いつでもリストとして読む。 */
function asList(node: unknown): readonly unknown[] {
  if (node === undefined) return [];
  return Array.isArray(node) ? node : [node];
}

/** その型が名乗るtrait。 */
function traitsOf(body: unknown): readonly string[] {
  const traits = nodeAt(body, 'traits');
  return Array.isArray(traits) ? traits.filter((trait): trait is string => typeof trait === 'string') : [];
}

/**
 * 型を指す値（`GameElementDefinition.md` 6.9節）を持つプロパティが名乗る型の名前。そのプロパティを
 * 持たないか、型以外の値なら undefined。
 */
export function objectValueAt(node: unknown, ...path: readonly string[]): string | undefined {
  const named = nodeAt(node, ...path, 'value', 'object');
  return typeof named === 'string' ? named : undefined;
}

/** `voyage.yaml` の `object_defs` を読み、海区の網を組み立てる。 */
export function readSeaChart(): SeaChart {
  const file: unknown = parse(readFileSync(worldCodexPath('voyage.yaml'), 'utf8'));
  const defs = namedEntries(nodeAt(file, 'object_defs'));

  const zones: string[] = [];
  const bodies = new Map<string, unknown>();
  const routeDestinations = new Map<string, string>();
  const routeBodies = new Map<string, unknown>();
  for (const [name, body] of defs) {
    const traits = traitsOf(body);
    if (traits.includes('sea_zone')) {
      zones.push(name);
      bodies.set(name, body);
    }
    if (!traits.includes('sea_route')) continue;
    routeBodies.set(name, body);
    // 航路が渡す先は、その型が名乗る`destination_zone`（渡る手はtraitが1本だけ持つ）。
    const destination = objectValueAt(body, 'props', 'destination_zone');
    if (destination !== undefined) routeDestinations.set(name, destination);
  }

  const neighbours = new Map<string, Set<string>>();
  const connect = (from: string, to: string): void => {
    for (const [a, b] of [
      [from, to],
      [to, from],
    ]) {
      const found = neighbours.get(a) ?? new Set<string>();
      found.add(b);
      neighbours.set(a, found);
    }
  };

  for (const zone of zones) {
    for (const spawned of asList(
      nodeAt(bodies.get(zone), 'props', 'exploration_progress', 'on_max', 'spawn'),
    )) {
      const routeName = nodeAt(spawned, 'object');
      if (typeof routeName !== 'string') continue;
      const destination = routeDestinations.get(routeName);
      if (destination === undefined) continue;

      // 見張りは辺1本の両端へ1本ずつ立てる——自分に立つ航路は自分から出る辺、隣へ立てる航路は
      // その隣から出る辺（voyage.yaml）。どちらも同じ1本を指すので、辺として繋ぐのは1度でよい。
      // 隣へ立てる先は、海区が名乗る隣（`zone_toward_*`）をプロパティ名で引いている。
      const intoProp = nodeAt(spawned, 'into_object', 'prop');
      const placedInto =
        typeof intoProp === 'string' ? objectValueAt(bodies.get(zone), 'props', intoProp) : undefined;
      connect(placedInto ?? zone, destination);
    }
  }

  return {
    zones,
    neighbours: new Map([...neighbours].map(([name, found]) => [name, [...found].sort()])),
    distanceToMainland: distancesFromMainland(neighbours),
    bodies,
    traitBodies: new Map(namedEntries(nodeAt(file, 'traits'))),
    routeDestinations,
    routeBodies,
  };
}

/**
 * その海区から本土まで、渡る海区を順に並べたうち最も短いもの（`from` 自身から始まり、本土の手前で
 * 終わる）。**辺の数だけで選ぶ**ので、海区が名乗る残り海区数（`zones_to_mainland`）とは独立に出る。
 */
export function shortestRouteToMainland(chart: SeaChart, from: string): readonly string[] {
  const route: string[] = [];
  for (let current = from; current !== 'mainland';) {
    route.push(current);
    const remaining = chart.distanceToMainland.get(current);
    const next = (chart.neighbours.get(current) ?? []).find(
      (neighbour) => chart.distanceToMainland.get(neighbour) === (remaining as number) - 1,
    );
    if (next === undefined) throw new Error(`${current} から本土へ近づく隣が無い`);
    current = next;
  }
  return route;
}

/** 本土から辺を辿った幅優先の距離。届かない海区は入らない（行き止まりの検出はこれで足りる）。 */
function distancesFromMainland(neighbours: ReadonlyMap<string, ReadonlySet<string>>): Map<string, number> {
  const distances = new Map<string, number>([['mainland', 0]]);
  for (let frontier = ['mainland']; frontier.length > 0;) {
    const next: string[] = [];
    for (const name of frontier)
      for (const neighbour of neighbours.get(name) ?? []) {
        if (distances.has(neighbour)) continue;
        distances.set(neighbour, (distances.get(name) as number) + 1);
        next.push(neighbour);
      }
    frontier = next;
  }
  return distances;
}
