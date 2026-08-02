import type { Site } from './IslandMap';
import type { Pcg32 } from './Pcg32';

/**
 * 命名処理（TerrainGeneration.md 3.6節）。LocationTypeの表示名をそのまま名前にし、同じ型が複数
 * あるときだけname_poolから引いた名前で区別する。
 *
 * **島のどこに在るかを名前に出さない。** 地形の把握はプレイヤー自身の仕事なので、方角のように
 * 位置が分かる修飾語を付けると、行き先の名前を見ただけで島の形が割れてしまう。
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
      group[0].name = type.displayName;
      continue;
    }

    // プールは引いた順に配り、足りない分は漢数字で埋める（プールが尽きるのは想定外の状態）。
    const pool = shuffled(type.namePool, rng);
    group.forEach((site, index) => {
      site.name = pool[index] ?? `${type.displayName}${toKanjiOrdinal(index + 1)}`;
    });
  }
}

/** Fisher-Yatesの一様シャッフル。元の配列は変えない。 */
function shuffled(values: readonly string[], rng: Pcg32): string[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function toKanjiOrdinal(ordinal: number): string {
  const kanji = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const number = ordinal <= 10 ? kanji[ordinal - 1] : ordinal.toString();
  return `（第${number}）`;
}
