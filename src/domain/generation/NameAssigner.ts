import type { Site } from './IslandMap';

/**
 * 命名処理（TerrainGeneration.md 3.6節）。島の重心からの方角（8方位）+LocationTypeの表示名で
 * 「東の草原」のような仮称を作り、重複はフォールバック接尾辞（第一/第二…）で区別する。
 * name_pool（固有名詞プール）は今後の課題。
 */

const DIRECTIONS = ['東', '北東', '北', '北西', '西', '南西', '南', '南東'];

export function assignNames(sites: readonly Site[]): void {
  let centerX = 0;
  let centerY = 0;
  for (const site of sites) {
    centerX += site.x;
    centerY += site.y;
  }
  centerX /= sites.length;
  centerY /= sites.length;

  const counts = new Map<string, number>();
  const duplicated = new Set<string>();
  for (const site of sites) {
    const baseName = `${directionOf(site.x - centerX, site.y - centerY)}の${site.type!.displayName}`;
    const seen = counts.get(baseName);
    if (seen !== undefined) duplicated.add(baseName);
    counts.set(baseName, (seen ?? 0) + 1);
  }

  const used = new Map<string, number>();
  for (const site of sites) {
    const baseName = `${directionOf(site.x - centerX, site.y - centerY)}の${site.type!.displayName}`;
    if (!duplicated.has(baseName)) {
      site.name = baseName;
      continue;
    }

    const ordinal = (used.get(baseName) ?? 0) + 1;
    used.set(baseName, ordinal);
    site.name = `${baseName}${toKanjiOrdinal(ordinal)}`;
  }
}

/** 重心からのベクトルを8方位に割り当てる（45度刻み、東=0度を中心に反時計回り）。 */
function directionOf(dx: number, dy: number): string {
  const angle = Math.atan2(dy, dx); // (-π, π]
  const sector = Math.floor((angle + Math.PI / 8) / (Math.PI / 4));
  return DIRECTIONS[((sector % 8) + 8) % 8];
}

function toKanjiOrdinal(ordinal: number): string {
  const kanji = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const number = ordinal <= 10 ? kanji[ordinal - 1] : ordinal.toString();
  return `（第${number}）`;
}
