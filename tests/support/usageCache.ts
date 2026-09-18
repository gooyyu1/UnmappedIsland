import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 使用量の控え（`scripts/daemon/usage.sh --last` が読む形）の身代わり。**余力の関門を通る
 * スクリプトはどれもこれを読む**ので、控えの形——1行目が引けた時刻、以降が枠ごとの行——を覚えるのは
 * ここ1箇所でよい。
 */

export interface CachedUsage {
  readonly fiveHour?: number;
  readonly sevenDay?: number;
  /** `locked_reason`。省くと錠は掛かっていない。 */
  readonly locked?: string;
  /** 引けてからの経過秒。省くとたった今。 */
  readonly agedSeconds?: number;
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** 控えを置く。既定は余力たっぷり。 */
export function writeUsageCache(dir: string, usage: CachedUsage = {}): void {
  const locked = usage.locked ?? '-';
  const lines = [
    `five_hour ${usage.fiveHour ?? 5} 2026-09-05T01:00:00Z ${locked}`,
    `seven_day ${usage.sevenDay ?? 5} 2026-09-10T01:00:00Z ${locked}`,
  ];
  const at = nowSeconds() - (usage.agedSeconds ?? 0);
  writeFileSync(join(dir, 'usage-latest'), `${at}\n${lines.join('\n')}\n`, 'utf-8');
}

/**
 * 口を叩いた印を、たった今のことにして置く。**控えが無い・古い周は関門が自分で1回引きに行く**
 * （`headroom.sh`）ので、**間隔の番で追い返させて本物の網に触らせない**。
 */
export function writeUsagePolled(dir: string): void {
  writeFileSync(join(dir, 'usage-polled'), `${nowSeconds()}\n`, 'utf-8');
}
