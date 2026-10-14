import { describe, expect, it } from 'vitest';

/** 同期のまま、指定した時間だけイベントループを手放さない。 */
function holdLoop(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until);
}

// 譲りが外れると、1件目で積んだタイマーが3件目の時点でまだ走っていない（vitest は検査の間で
// イベントループへ戻らないので）。理由は yieldBetweenTests.ts。
describe('検査の間で、イベントループへ戻る', () => {
  let fired = false;

  it('タイマーを積んで、同期のまま終わる', () => {
    setTimeout(() => {
      fired = true;
    }, 0);
    holdLoop(20);
  });

  it('同期のまま終わる検査が続く', () => {
    holdLoop(20);
  });

  it('前の検査で積んだタイマーが、もう走っている', () => {
    expect(fired).toBe(true);
  });
});
