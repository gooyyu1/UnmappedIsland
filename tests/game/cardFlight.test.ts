import { describe, expect, it } from 'vitest';
import { flightProgress } from '../../src/game/looks/cardFlight';

/**
 * 飛びの速さそのものを留めるテスト（CardInteraction.md 6節）。「以前より遅くなった」という報告に
 * ブラウザを開かずに答えられるよう、ここに数として置いてある。
 */
const FLY_MS = 260;

/** 経過を刻んで進め、進み具合が1に達した（＝着いた）時点の経過を返す。 */
function elapsedAtArrival(frameMs: number, delay: number): number {
  for (let elapsed = 0; elapsed <= 10_000; elapsed += frameMs) {
    if (flightProgress(elapsed, delay) >= 1) return elapsed;
  }
  throw new Error('着かなかった');
}

describe('flightProgress（CardInteraction.md 6節 カードの移動アニメーション）', () => {
  it('飛び立つまでは出発点に居る', () => {
    expect(flightProgress(0, 100)).toBe(0);
    expect(flightProgress(99, 100)).toBe(0);
    expect(flightProgress(100, 100)).toBe(0);
  });

  it('飛び立ってから260ミリ秒で着く', () => {
    expect(flightProgress(FLY_MS - 1, 0)).toBeLessThan(1);
    expect(flightProgress(FLY_MS, 0)).toBe(1);
    // 待ったぶんはそのまま後ろへずれる。
    expect(flightProgress(100 + FLY_MS - 1, 100)).toBeLessThan(1);
    expect(flightProgress(100 + FLY_MS, 100)).toBe(1);
  });

  it('着いた後も行き先を通り越さない', () => {
    expect(flightProgress(FLY_MS * 10, 0)).toBe(1);
  });

  it('フレームの間隔が粗くても、飛び立ちから着地までの経過は変わらない', () => {
    // 1フレームぶん以上は行き過ぎようがない。60fpsでも1桁fpsでも、着くのは経過260ミリ秒の直後。
    for (const frameMs of [1, 16, 50, 100]) {
      expect(elapsedAtArrival(frameMs, 0)).toBeGreaterThanOrEqual(FLY_MS);
      expect(elapsedAtArrival(frameMs, 0)).toBeLessThan(FLY_MS + frameMs);
    }
  });

  it('行き先へ近づくほど遅くなる', () => {
    const firstQuarter = flightProgress(FLY_MS * 0.25, 0) - flightProgress(0, 0);
    const lastQuarter = flightProgress(FLY_MS, 0) - flightProgress(FLY_MS * 0.75, 0);
    expect(firstQuarter).toBeGreaterThan(lastQuarter);
  });
});
