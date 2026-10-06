import type { TestOptions } from 'vitest';

/**
 * 実物のリポジトリの履歴を辿る検査の上限（`vite.config.ts` の `testTimeout` の「越えた検査は名乗らせる」）。
 *
 * かかる時間を決めるのは**コードではなく手元のクローンの状態**——履歴をどこまで取ったか、辿る区間が
 * どれだけ長いか——で、履歴が伸びるほど伸びる。浅いクローン（CI）では辿る履歴が手元に無いので一瞬で
 * 終わり、**既定の線はこの検査の速さを何も測っていない**。そこで、`timeoutOnWindows` と違って
 * **環境を問わず**広げる。
 *
 * 名乗るのは、履歴を読むスクリプトを実物で打つ検査ファイルだけ（tests/architecture/testTimeouts.test.ts
 * が両向きに見張る）。
 */
export const TIMEOUT_FOR_CLONE_HISTORY: TestOptions = { timeout: 120_000 };
