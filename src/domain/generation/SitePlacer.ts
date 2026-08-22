import type { GenerationScopeDef } from './GenerationScopeDef';
import type { Pcg32 } from '../Pcg32';
import { Site } from './IslandMap';

/**
 * サイト（Site）の座標配置。半径ISLAND_RADIUSの円盤を島とみなし、次の2段で配置する。
 *
 * 1. 外周リング: 島を囲む海岸候補のサイトを、外周の円環（半径85〜95%）へ等間隔+ジッタで置く。
 *    個数は全体の約35%（4〜7個に制限）。島が必ず海岸に囲まれることと、海岸が多くなり
 *    すぎないことを、この配置枠の個数制御で同時に保証する（「島なので普通に生成すると海岸が
 *    多くなりすぎる」ことへの対策。円盤への一様散布は面積比で外周が多数になり、凸包だけを
 *    海岸にしても小さなサイト数では凸包が過半になってしまうため、リングを配置の段階で分ける）。
 * 2. 内陸: 残りのサイトをベストキャンディデート法（Mitchell）で内側（半径75%以内）へ散布する。
 *    Poisson-diskサンプリングは結果の個数が半径から決まり「10〜20個ちょうど」を直接指定
 *    できないため、個数を直接指定できるベストキャンディデート法を使う（TerrainGeneration.md
 *    3.5節の「Poisson-disk等」の実装上の置き換え）。interior_biasが高いほど中心へ寄せる。
 */

/** 島（抽象座標系）の半径。距離・ノイズ座標の正規化の基準。 */
export const ISLAND_RADIUS = 100.0;

/** 外周リングの半径の範囲（ISLAND_RADIUS比）。 */
const COAST_RING_MIN_RADIUS = 0.85;
const COAST_RING_MAX_RADIUS = 0.95;

/** 内陸サイトの最大半径（ISLAND_RADIUS比）。外周リングとの間に必ず隙間を作り、
 * 内陸サイトが海岸帯（coastal_distanceの下限）へ紛れ込まないようにする。 */
const INTERIOR_MAX_RADIUS = 0.75;

/** ベストキャンディデート法の1点あたりの候補数。 */
const CANDIDATES_PER_SITE = 10;

export function place(scope: GenerationScopeDef, rng: Pcg32): Site[] {
  // site_countのmaxは含む値なので、半開区間で引くために+1する。
  const total = rng.nextInt(scope.siteCountMin, scope.siteCountMax + 1);

  // 海岸（外周リング）の個数: 全体の約35%、ただし「島を囲める最低限」として4個以上、
  // 「多くなりすぎない」上限として7個以下。内陸にも最低3個は残す（山+内陸2種の余地）。
  let coastCount = Math.min(Math.max(Math.round(total * 0.35), 4), 7);
  coastCount = Math.min(coastCount, total - 3);

  const sites: Site[] = [];

  // 1. 外周リング: 等間隔の角度+ジッタ。
  const angleStep = (2 * Math.PI) / coastCount;
  const angleOffset = rng.nextDouble() * 2 * Math.PI;
  for (let i = 0; i < coastCount; i++) {
    const angle = angleOffset + angleStep * (i + (rng.nextDouble() - 0.5) * 0.6);
    const radius =
      ISLAND_RADIUS *
      (COAST_RING_MIN_RADIUS + rng.nextDouble() * (COAST_RING_MAX_RADIUS - COAST_RING_MIN_RADIUS));
    sites.push(new Site(sites.length, radius * Math.cos(angle), radius * Math.sin(angle), true));
  }

  // 2. 内陸: ベストキャンディデート法（既存サイトへの最小距離が最大の候補を採用）。
  // interior_bias(0〜1)は半径分布の指数を0.5(一様)→1.0(中心寄り)へ動かす。
  const radiusExponent = 0.5 + scope.interiorBias * 0.5;
  const interiorCount = total - coastCount;
  for (let i = 0; i < interiorCount; i++) {
    let bestX = 0;
    let bestY = 0;
    let bestScore = -1;
    for (let candidate = 0; candidate < CANDIDATES_PER_SITE; candidate++) {
      const angle = rng.nextDouble() * 2 * Math.PI;
      const radius = ISLAND_RADIUS * INTERIOR_MAX_RADIUS * Math.pow(rng.nextDouble(), radiusExponent);
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);

      let score = Number.MAX_VALUE;
      for (const existing of sites) {
        const dx = x - existing.x;
        const dy = y - existing.y;
        score = Math.min(score, dx * dx + dy * dy);
      }

      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }

    sites.push(new Site(sites.length, bestX, bestY, false));
  }

  return sites;
}
