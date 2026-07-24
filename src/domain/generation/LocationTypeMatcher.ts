import type { GenerationDefs } from '../defs/generation/GenerationDefs';
import type { GenerationScopeDef, GuaranteeDef } from '../defs/generation/GenerationScopeDef';
import type { LocationTypeDef } from '../defs/generation/LocationTypeDef';
import type { Site } from './IslandMap';

/**
 * 各サイトへのLocationTypeの割り当て（TerrainGeneration.md 3.2〜3.4節）。
 *
 * 1. guarantees（島全体のバランス保証、3.4節）: 「指定軸が最大/最小のサイトへ強制割当」を
 *    最近傍マッチングより先に行う（例: 最高標高のサイトは必ず山頂）。軸カバレッジの事後検証+
 *    再生成ではなく、決定的な強制割当で保証する（再生成はシード再現性と停止性を複雑にするため）。
 * 2. 最近傍マッチング（3.2節）: 正規化した重み付き距離
 *        D = sqrt( Σ w_i * ((v_i - ideal_i) / tolerance_i)^2 / Σ w_i )
 *    の最小の型を選ぶ。言及した軸だけをΣw_iで正規化するため、言及軸が少ない型が構造的に
 *    有利になる次元数バイアスは無い。toleranceは距離のスケールであり、除外はhard_limitsのみが
 *    担う（ドキュメントで未確定だった意味論の一義化）。同点は宣言順で先の型が勝つ（決定的）。
 * 3. フォールバック（3.3節）: hard_limitsで全型が弾かれたサイトは、is_fallbackの型のうち
 *    priority最大のものが受ける（フォールバックは最後の受け皿のため、自身のhard_limitsも無視する）。
 */
export function assignTypes(defs: GenerationDefs, scope: GenerationScopeDef, sites: readonly Site[]): void {
  const types = defs.locationTypes.filter((t) => t.appliesTo(scope.name));
  if (types.length === 0)
    throw new Error(`スコープ'${scope.name}'に適用できるlocation_typeが1つもありません。`);

  const forced = new Set<Site>();

  for (const guarantee of scope.guarantees) {
    const type = types.find((t) => t.name === guarantee.locationType);
    if (type === undefined)
      throw new Error(
        `guaranteesのlocation_type '${guarantee.locationType}' はスコープ'${scope.name}'に適用できません。`,
      );

    // hard_limitsを満たすサイトを優先し、足りなければ全サイトから補う（保証は絶対のため）。
    const candidates = sites.filter((s) => !forced.has(s));
    const ordered = orderForGuarantee(candidates, guarantee, type);
    for (const site of ordered.slice(0, guarantee.count)) {
      site.type = type;
      forced.add(site);
    }
  }

  for (const site of sites) {
    if (forced.has(site)) continue;
    site.type = matchNearest(types, site);
  }
}

function orderForGuarantee(
  candidates: readonly Site[],
  guarantee: GuaranteeDef,
  type: LocationTypeDef,
): Site[] {
  const ordered = [...candidates];
  // 指定軸の最大/最小順（同値はindex順で決定的に）。
  ordered.sort((a, b) => {
    let byAxis = a.axisValues.get(guarantee.axis)! - b.axisValues.get(guarantee.axis)!;
    if (guarantee.pick === 'max') byAxis = -byAxis;
    return byAxis !== 0 ? byAxis : a.index - b.index;
  });

  // hard_limitsを満たすサイトを先に。
  return [
    ...ordered.filter((s) => passesHardLimits(type, s)),
    ...ordered.filter((s) => !passesHardLimits(type, s)),
  ];
}

function matchNearest(types: readonly LocationTypeDef[], site: Site): LocationTypeDef {
  let best: LocationTypeDef | undefined;
  let bestDistance = Number.MAX_VALUE;

  for (const type of types) {
    if (type.preferences.length === 0) continue; // 全軸無関心の型はフォールバック専用
    if (!passesHardLimits(type, site)) continue;

    const distance = normalizedDistance(type, site);
    if (distance < bestDistance) {
      // 同点は宣言順で先の型が勝つ
      bestDistance = distance;
      best = type;
    }
  }

  if (best !== undefined) return best;

  const fallbacks = types.filter((t) => t.isFallback).sort((a, b) => b.priority - a.priority);
  const fallback = fallbacks.length > 0 ? fallbacks[0] : undefined;
  if (fallback === undefined)
    throw new Error(
      `サイト${site.index}（${formatAxes(site)}）にマッチするlocation_typeが無く、is_fallbackの型もありません。`,
    );
  return fallback;
}

/** 正規化した重み付きユークリッド距離（3.2節）。言及した軸だけをΣweightで正規化する。 */
export function normalizedDistance(type: LocationTypeDef, site: Site): number {
  let sum = 0;
  let weightSum = 0;
  for (const preference of type.preferences) {
    const deviation = (site.axisValues.get(preference.axis)! - preference.ideal) / preference.tolerance;
    sum += preference.weight * deviation * deviation;
    weightSum += preference.weight;
  }

  return Math.sqrt(sum / weightSum);
}

function passesHardLimits(type: LocationTypeDef, site: Site): boolean {
  for (const limit of type.hardLimits) {
    if (!limit.allows(site.axisValues.get(limit.axis)!)) return false;
  }
  return true;
}

function formatAxes(site: Site): string {
  return [...site.axisValues.entries()].map(([key, value]) => `${key}=${value}`).join(', ');
}
