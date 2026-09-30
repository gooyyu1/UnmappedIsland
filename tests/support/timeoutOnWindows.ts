import type { TestOptions } from 'vitest';

/**
 * Windows でだけ名乗る時間の上限（`vite.config.ts` の `testTimeout` の「越えた検査は名乗らせる」）。
 *
 * Windows はプロセスの生成が1回10〜30msかかり、`.sh` を叩く検査は1件で数十個起こすので、全体を
 * 走らせた混んだ回には既定の線を越える。**それ以外の環境では何も渡さず、既定の線のまま**——速さの
 * 予算を緩めるのは、生成の遅い環境だけにする。
 */
export function timeoutOnWindows(ms: number): TestOptions {
  return process.platform === 'win32' ? { timeout: ms } : {};
}
