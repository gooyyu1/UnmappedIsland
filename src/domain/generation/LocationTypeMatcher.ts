import type { GenerationDefs } from './GenerationDefs';
import type { GenerationScopeDef, CoverageGuaranteeDef } from './GenerationScopeDef';
import type { LocationTypeDef } from './LocationTypeDef';
import type { Site } from './IslandMap';

/**
 * 各サイトへのLocationTypeの割り当て（TerrainGeneration.md 3.2〜3.4節）。
 *
 * 1. guarantees（島全体のバランス保証、3.4節）: 「指定軸が最大/最小のサイトへ強制割当」を
 *    最近傍マッチングより先に行う（例: 最高標高のサイトは必ず山頂）。軸カバレッジの事後検証+
 *    再生成ではなく、決定的な強制割当で保証する（再生成はシード再現性と停止性を複雑にするため）。
 *    **どの保証もhard_limitsを満たすサイトを得られる配り方が在るなら、必ずそれを採る**
 *    （assignGuaranteedSites）。
 * 2. 最近傍マッチング（3.2節）: 正規化した重み付き距離
 *        D = sqrt( Σ w_i * ((v_i - ideal_i) / tolerance_i)^2 / Σ w_i )
 *    の最小の型を選ぶ。言及した軸だけをΣw_iで正規化するため、言及軸が少ない型が構造的に
 *    有利になる次元数バイアスは無い。toleranceは距離のスケールであり、除外はhard_limitsのみが
 *    担う（ドキュメントで未確定だった意味論の一義化）。同点は宣言順で先の型が勝つ（決定的）。
 * 3. 同じ型の抑制（3.4節）: 既に置いた同じ型の個数に応じてマッチング距離へ割増を掛け、
 *    max_sites_per_typeで打ち切る。同じ地形は環境も発見物も見た目も同じなので、並べても島は
 *    広くならない。**譲るのは「その型らしさ」が薄いサイトから**なので、最良距離の昇順に決める。
 * 4. フォールバック（3.3節）: hard_limitsで全型が弾かれたサイトは、is_fallbackの型のうち
 *    priority最大のものが受ける（フォールバックは最後の受け皿のため、自身のhard_limitsも無視する）。
 */
export function assignTypes(defs: GenerationDefs, scope: GenerationScopeDef, sites: readonly Site[]): void {
  const types = defs.locationTypes.filter((t) => t.appliesTo(scope.name));
  if (types.length === 0)
    throw new Error(`スコープ'${scope.name}'に適用できるlocation_typeが1つもありません。`);

  const counts = new Map<string, number>();
  const take = (site: Site, type: LocationTypeDef): void => {
    site.type = type;
    counts.set(type.name, (counts.get(type.name) ?? 0) + 1);
  };

  const forced = assignGuaranteedSites(scope, types, sites);
  for (const [site, type] of forced) take(site, type);

  // 迷いの少ないサイト（最良距離が小さい＝その型らしさが濃い）から決める。後に回ったサイトほど、
  // 埋まった型を諦めて他の型へ回る側になる。同値はindex順で決定的に。
  const pending = sites.filter((s) => !forced.has(s));
  const bestDistances = new Map<Site, number>(
    pending.map((s) => [s, bestDistanceIgnoringCrowding(types, s)]),
  );
  pending.sort((a, b) => bestDistances.get(a)! - bestDistances.get(b)! || a.index - b.index);

  for (const site of pending) take(site, nearestTypeAvoidingFull(types, site, scope, counts));
}

/** 混雑を無視した最良距離（決める順番だけに使う）。どの型もhard_limitsで弾くサイトは最後に回す。 */
function bestDistanceIgnoringCrowding(types: readonly LocationTypeDef[], site: Site): number {
  let best = Number.MAX_VALUE;
  for (const type of types) {
    if (type.preferences.length === 0) continue;
    if (!type.satisfiesHardLimits(site.axisValues)) continue;
    best = Math.min(best, type.normalizedDistanceFrom(site.axisValues));
  }
  return best;
}

/** 保証1件が要求するサイト1つぶんの受け口（countが2以上なら1件の保証から複数できる）。 */
interface GuaranteeOpening {
  readonly type: LocationTypeDef;

  /** 全サイトを、その保証が取りたい順（指定軸の最大/最小順）に並べたもの。 */
  readonly ordered: readonly Site[];

  /** orderedのうち、この型のhard_limitsを満たすサイトだけ。 */
  readonly eligible: readonly Site[];
}

/**
 * guarantees（3.4節）の強制割当先を決める。返り値は割り当ての順（受け口の順）に並ぶ。
 *
 * **どの保証もhard_limitsを満たすサイトを得られる配り方が在るなら、必ずそれを採る。** 保証を1件ずつ
 * 先着で固定すると、先に見た保証が取ったサイトのせいで、後の保証だけがhard_limitsを満たさないサイトへ
 * 回る（最高標高のサイトを山頂が取り、そこしか置けない火口が山腹へ降りる）。
 *
 * **取り合いになったときは、先に宣言した保証が優先する**（宣言順は、書き手が決められる唯一の順序）。
 * ただし優先が効くのは、**後の保証を置けなくしない範囲**まで——先の保証は、取ると後の保証が
 * hard_limitsを満たすサイトを失う候補を飛ばす。
 *
 * それでも相手の見つからない受け口は、hard_limitsを満たさないサイトからも補う（保証は絶対のため）。
 */
function assignGuaranteedSites(
  scope: GenerationScopeDef,
  types: readonly LocationTypeDef[],
  sites: readonly Site[],
): ReadonlyMap<Site, LocationTypeDef> {
  const openings: GuaranteeOpening[] = [];
  for (const guarantee of scope.guarantees) {
    const type = types.find((t) => t.name === guarantee.locationType);
    if (type === undefined)
      throw new Error(
        `guaranteesのlocation_type '${guarantee.locationType}' はスコープ'${scope.name}'に適用できません。`,
      );

    const ordered = orderForGuarantee(sites, guarantee);
    const eligible = ordered.filter((s) => type.satisfiesHardLimits(s.axisValues));
    for (let i = 0; i < guarantee.count; i += 1) openings.push({ type, ordered, eligible });
  }

  const matched = assignEligibleSitesInOrder(openings, sites);
  const assigned = new Set<Site>(matched.filter((s): s is Site => s !== undefined));
  const forced = new Map<Site, LocationTypeDef>();
  for (const [index, opening] of openings.entries()) {
    // 受け口がサイトより多ければ、余った受け口には当てる先が無い。
    const site = matched[index] ?? opening.ordered.find((s) => !assigned.has(s));
    if (site === undefined) continue;
    assigned.add(site);
    forced.set(site, opening.type);
  }
  return forced;
}

/**
 * 受け口ごとに、hard_limitsを満たすサイトを1つずつ当てる（当たらなければundefined）。
 *
 * **宣言順に、取りたい順で取らせる。** ただし取るのは、**そのサイトを抜いても残りの受け口が今までどおりの
 * 数を当てられる**ものだけ——後の保証の置き場を潰す候補は飛ばす。当てた数は全体で最大になり、
 * **undefinedが残るのは、どう配り直してもその受け口までは届かないときだけ**。
 */
function assignEligibleSitesInOrder(
  openings: readonly GuaranteeOpening[],
  sites: readonly Site[],
): (Site | undefined)[] {
  const available = new Set<Site>(sites);
  const assigned = new Array<Site | undefined>(openings.length).fill(undefined);

  for (const [index, opening] of openings.entries()) {
    const rest = openings.slice(index + 1);
    const reachable = maxAssignableCount(openings.slice(index), available);
    for (const site of opening.eligible) {
      if (!available.has(site)) continue;
      available.delete(site);
      if (maxAssignableCount(rest, available) === reachable - 1) {
        assigned[index] = site;
        break;
      }
      available.add(site); // このサイトを取ると、後の保証がhard_limitsを満たすサイトを失う。
    }
  }
  return assigned;
}

/**
 * その受け口群へ同時に当てられるサイトの最大数。**当てた先は後から振り替える**（増加路を辿る＝
 * 二部グラフの最大マッチング、crafting.tsの材料割り当てと同じ）ので、受け口を見る順では変わらない。
 */
function maxAssignableCount(openings: readonly GuaranteeOpening[], available: ReadonlySet<Site>): number {
  const openingOf = new Map<Site, number>();

  /**
   * その受け口へサイトを1つ当てられたか。既に当たっているサイトでも、**その相手を別のサイトへ
   * 振り替えられるなら奪う**（増加路の探索）。visitedはこの1回の探索で見たサイト——同じサイトを
   * 辿り直して回らないための印。
   */
  const tryTakeFor = (opening: number, visited: Set<Site>): boolean => {
    for (const site of openings[opening].eligible) {
      if (!available.has(site) || visited.has(site)) continue;
      visited.add(site);
      const incumbent = openingOf.get(site);
      if (incumbent !== undefined && !tryTakeFor(incumbent, visited)) continue;
      openingOf.set(site, opening);
      return true;
    }
    return false;
  };

  let count = 0;
  for (let opening = 0; opening < openings.length; opening += 1)
    if (tryTakeFor(opening, new Set())) count += 1;
  return count;
}

/** 指定軸の最大/最小順（同値はindex順で決定的に）。 */
function orderForGuarantee(sites: readonly Site[], guarantee: CoverageGuaranteeDef): Site[] {
  return [...sites].sort((a, b) => {
    let byAxis = a.axisValues.get(guarantee.axis)! - b.axisValues.get(guarantee.axis)!;
    if (guarantee.pick === 'max') byAxis = -byAxis;
    return byAxis !== 0 ? byAxis : a.index - b.index;
  });
}

function nearestTypeAvoidingFull(
  types: readonly LocationTypeDef[],
  site: Site,
  scope: GenerationScopeDef,
  counts: ReadonlyMap<string, number>,
): LocationTypeDef {
  // 上限まで埋まった型を避けて選ぶ。全滅したら上限を無視して選び直す——上限は「同じ地形を並べない」
  // ための強い希望であって、置けるかどうかの条件ではない（hard_limitsだけが絶対）。
  return nearestType(types, site, scope, counts, true) ?? nearestType(types, site, scope, counts, false)!;
}

function nearestType(
  types: readonly LocationTypeDef[],
  site: Site,
  scope: GenerationScopeDef,
  counts: ReadonlyMap<string, number>,
  respectMax: boolean,
): LocationTypeDef | undefined {
  let best: LocationTypeDef | undefined;
  let bestDistance = Number.MAX_VALUE;

  for (const type of types) {
    if (type.preferences.length === 0) continue; // 全軸無関心の型はフォールバック専用
    if (!type.satisfiesHardLimits(site.axisValues)) continue;

    const count = counts.get(type.name) ?? 0;
    if (respectMax && scope.maxSitesPerType > 0 && count >= scope.maxSitesPerType) continue;

    const distance =
      type.normalizedDistanceFrom(site.axisValues) * (1 + scope.crowdingPenaltyPerDuplicate * count);
    if (distance < bestDistance) {
      // 同点は宣言順で先の型が勝つ
      bestDistance = distance;
      best = type;
    }
  }

  if (best !== undefined) return best;
  if (respectMax) return undefined;

  const fallbacks = types.filter((t) => t.isFallback).sort((a, b) => b.fallbackPriority - a.fallbackPriority);
  const fallback = fallbacks.length > 0 ? fallbacks[0] : undefined;
  if (fallback === undefined)
    throw new Error(
      `サイト${site.index}（${formatAxes(site)}）にマッチするlocation_typeが無く、is_fallbackの型もありません。`,
    );
  return fallback;
}

function formatAxes(site: Site): string {
  return [...site.axisValues.entries()].map(([key, value]) => `${key}=${value}`).join(', ');
}
