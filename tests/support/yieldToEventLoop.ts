import { setImmediate } from 'node:timers';

/**
 * イベントループへ一度返す。
 *
 * vitestのワーカーは、テストの進み具合をRPCで本体へ知らせて返事を待つ。**返事を受け取らないまま
 * 60秒ブロックすると** `Timeout calling "onTaskUpdate"` が未処理エラーとして立ち、テストが全部
 * 成功していても vitest は非ゼロで終わる（issue #828）。60秒はbirpcの既定値で、vitest 3.2.7には
 * これを延ばす設定が無い。
 *
 * 検査と検査の間は [`yieldBetweenTests`](yieldBetweenTests.ts) が返す。**1件で数十秒を超える検査は、
 * その中の区切りのよいところで自分で呼ぶ。**
 */
export async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
