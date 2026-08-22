import { LocationName } from './IslandMap';
import type { Site } from './IslandMap';
import type { Pcg32 } from './Pcg32';

/**
 * 命名処理（TerrainGeneration.md 3.6節）。同じLocationTypeが島に1つだけならその型を名前にし、
 * 複数あるときだけ亜種（variants）を1つずつ配って、名前と個体差の両方を決める。
 *
 * **島のどこに在るかを名前に出さない。** 地形の把握はプレイヤー自身の仕事なので、方角のように
 * 位置が分かる修飾語を付けると、行き先の名前を見ただけで島の形が割れてしまう。
 *
 * 決まるのは識別子の組み合わせだけで、表示文字列は持たない（LocationName参照）。
 */

export function assignNames(sites: readonly Site[], rng: Pcg32): void {
  const byType = new Map<string, Site[]>();
  for (const site of sites) {
    const group = byType.get(site.type!.name);
    if (group === undefined) byType.set(site.type!.name, [site]);
    else group.push(site);
  }

  for (const group of byType.values()) {
    const type = group[0].type!;
    if (group.length === 1) {
      group[0].name = new LocationName(type.name);
      continue;
    }

    // 亜種は引いた順に配り、足りない分は通し番号で埋める（足りないのは想定外の状態）。
    const variants = shuffled(type.variants, rng);
    group.forEach((site, index) => {
      const variant = variants.at(index);
      site.variant = variant;
      site.name =
        variant === undefined
          ? new LocationName(type.name, undefined, index + 1)
          : new LocationName(type.name, variant.id);
    });
  }
}

/** Fisher-Yatesの一様シャッフル。元の配列は変えない。 */
function shuffled<T>(values: readonly T[], rng: Pcg32): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
