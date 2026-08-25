import type { IslandMap } from '../domain/generation/IslandMap';

/**
 * 生成された島を測って、**拠点を出て何箇所かを回り、拠点へ戻る1日ぶんの移動時間**を出す
 * （ContentSkeleton.md 8.2節）。
 *
 * 材料は道1本ずつの移動時間だけで足りる。`base_minutes_per_distance` と両端の `move_cost` は
 * 生成の時点で `IslandEdge.travelMinutes` へ畳まれている（TerrainGeneration.md 3.5節）ので、
 * ここが積むのは経路だけになる。
 *
 * 引く線は2つ。**その日どこに用があるかは解かない**——定義からは決まらないので、行き先の選び方を
 * 2通り（`DESTINATION_CHOICES`）並べ、どれを1日と読むかは呼び出し側に残す。**道を見つける探索
 * 時間は数えない**——ここが測るのは道が出そろった後の1日で、道を見つけるまでは`startupReach.ts`が
 * 測る最初の段の話。
 */

/** 1日に回る箇所の数。表に出す範囲で、どれを1日と読むかはこの道具では決めない。 */
export const VISIT_COUNTS: readonly number[] = [1, 2, 3];

/**
 * 行き先の組を数え上げるもの。`others`は拠点から近い順に並んでいる。
 * `visit`へ渡した組は次の呼び出しまでしか有効でない（数え上げの途中で使い回す）。
 */
type DestinationEnumerator = (
  others: readonly number[],
  visitCount: number,
  visit: (destinations: readonly number[]) => void,
) => void;

/** 行き先の選び方1つ（`DESTINATION_CHOICES`）。 */
export interface DestinationChoice {
  /** レポートの行に出す呼び名。 */
  readonly label: string;

  readonly enumerate: DestinationEnumerator;
}

/**
 * 行き先の選び方。**どちらも「行き先の組を数え上げ、各組を回る最短の巡回の平均を採る」で、
 * 違うのは数え上げる組だけ。**
 *
 * - **一様** — 拠点以外の土地から等しく選ぶ。どの土地にも同じだけ用があるとしたときの姿。
 * - **近い順** — 拠点から近い順に採る。同じものが近くでも採れるとしたときの下限。
 */
export const DESTINATION_CHOICES: readonly DestinationChoice[] = [
  { label: '一様', enumerate: forEachCombination },
  { label: '近い順', enumerate: (others, visitCount, visit) => visit(others.slice(0, visitCount)) },
];

/** 拠点1つから見た、1日の移動時間。 */
export interface BaseDailyTravel {
  readonly siteIndex: number;

  /** 拠点から他の土地への片道（最短経路）の移動時間（分）の平均。島の広さそのもの。 */
  readonly oneWayMinutes: number;

  /** 行き先の選び方 → `VISIT_COUNTS`と同じ並びの、回って戻る移動時間（分）。 */
  readonly tourMinutes: ReadonlyMap<DestinationChoice, readonly number[]>;
}

/** 島1つ。 */
export interface IslandDailyTravel {
  readonly seed: number;

  /** 全土地を拠点として測ったもの。並びはサイトindex。 */
  readonly bases: readonly BaseDailyTravel[];

  /**
   * **最も条件の良い拠点**。プレイヤーは拠点を選べるので、選べる中で片道の平均が最も短い土地を
   * 採る（同じなら`siteIndex`の小さいほう）。良し悪しの判定ではなく順序の定義。
   */
  readonly bestBase: BaseDailyTravel;
}

/** 生成された島1つを測る。 */
export function dailyTravelOf(map: IslandMap): IslandDailyTravel {
  const distances = shortestPathMinutes(map);
  const bases = map.sites.map((site) => baseDailyTravelOf(distances, site.index));
  return {
    seed: map.seed,
    bases,
    bestBase: bases.reduce((best, base) => (base.oneWayMinutes < best.oneWayMinutes ? base : best)),
  };
}

function baseDailyTravelOf(distances: readonly number[][], base: number): BaseDailyTravel {
  const others = distances
    .map((_, site) => site)
    .filter((site) => site !== base)
    .sort((a, b) => distances[base][a] - distances[base][b]);
  const oneWaySum = others.reduce((sum, site) => sum + distances[base][site], 0);

  return {
    siteIndex: base,
    oneWayMinutes: oneWaySum / others.length,
    tourMinutes: new Map(
      DESTINATION_CHOICES.map((choice) => [
        choice,
        VISIT_COUNTS.map((visitCount) =>
          meanTourMinutes(distances, base, others, visitCount, choice.enumerate),
        ),
      ]),
    ),
  };
}

/** 数え上げた行き先の組それぞれを回って戻る、最短の巡回の平均（分）。 */
function meanTourMinutes(
  distances: readonly number[][],
  base: number,
  others: readonly number[],
  visitCount: number,
  enumerate: DestinationEnumerator,
): number {
  let sum = 0;
  let count = 0;
  enumerate(others, visitCount, (destinations) => {
    sum += bestTourMinutes(distances, base, [...destinations]);
    count++;
  });
  return sum / count;
}

/** その組を回って戻る最短の巡回。回る順は全列挙で比べる（箇所数は`VISIT_COUNTS`の範囲）。 */
function bestTourMinutes(distances: readonly number[][], base: number, visits: number[]): number {
  let best = Number.POSITIVE_INFINITY;

  const permute = (depth: number, from: number, minutes: number): void => {
    if (depth === visits.length) {
      best = Math.min(best, minutes + distances[from][base]);
      return;
    }
    for (let i = depth; i < visits.length; i++) {
      [visits[depth], visits[i]] = [visits[i], visits[depth]];
      permute(depth + 1, visits[depth], minutes + distances[from][visits[depth]]);
      [visits[depth], visits[i]] = [visits[i], visits[depth]];
    }
  };
  permute(0, base, 0);

  return best;
}

/** `others`から`visitCount`個を選ぶ組み合わせをすべて数え上げる。 */
function forEachCombination(
  others: readonly number[],
  visitCount: number,
  visit: (destinations: readonly number[]) => void,
): void {
  const destinations = new Array<number>(visitCount);

  const choose = (start: number, depth: number): void => {
    if (depth === visitCount) {
      visit(destinations);
      return;
    }
    for (let i = start; i <= others.length - (visitCount - depth); i++) {
      destinations[depth] = others[i];
      choose(i + 1, depth + 1);
    }
  };
  choose(0, 0);
}

/** 全点間の最短移動時間（分）。土地は高々20個なのでWarshall-Floyd法で足りる。 */
function shortestPathMinutes(map: IslandMap): number[][] {
  const n = map.sites.length;
  const distances = Array.from({ length: n }, (_, from) =>
    Array.from({ length: n }, (_, to) => (from === to ? 0 : Number.POSITIVE_INFINITY)),
  );
  for (const edge of map.edges) {
    distances[edge.a][edge.b] = Math.min(distances[edge.a][edge.b], edge.travelMinutes);
    distances[edge.b][edge.a] = distances[edge.a][edge.b];
  }

  for (let via = 0; via < n; via++)
    for (let from = 0; from < n; from++)
      for (let to = 0; to < n; to++) {
        const viaCost = distances[from][via] + distances[via][to];
        if (viaCost < distances[from][to]) distances[from][to] = viaCost;
      }

  return distances;
}
