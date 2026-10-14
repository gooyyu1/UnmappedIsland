import { afterEach } from 'vitest';
import { yieldToEventLoop } from './yieldToEventLoop';

// 検査を1件終えるたびに、イベントループへ返す（`vite.config.ts` の `setupFiles` から全部のファイルに
// 掛かる）。**vitest は同じファイルの検査どうしの間でイベントループへ戻らない**ので、同期の子プロセス
// 起動を重ねる検査が並ぶと、ファイル1本ぶんで {@link yieldToEventLoop} の60秒を越える（プロセスの
// 起動が遅い Windows で `tests/scripts/daemon.test.ts` が踏んだ）。
afterEach(yieldToEventLoop);
