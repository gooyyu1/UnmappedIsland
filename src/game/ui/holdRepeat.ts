import type Phaser from 'phaser';

/**
 * 押し続けている間の繰り返しの速さ。1回目はHOLD後、そこからは間隔にDECAYを掛けてMINまで詰める。
 * MINが最高速度で、50ミリ秒＝秒間20枚。100枚のスタックでも10秒はかからない。
 *
 * **「カードが1枚ずつ出てくる」速さは1つだけ**にする。カードの端を押し続けて送るのも、束をまとめて
 * 運ぶときに2枚目以降がついてくるのも、生まれたカードが順に飛び立つ間隔（CardMotion）も同じ速さ。
 * 別々に持つと、片方だけ変えたときに別の出来事に見える。
 */
const HOLD_MS = 400;
const REPEAT_MS = 300;
export const REPEAT_MIN_MS = 50;
const REPEAT_DECAY = 0.8;

/**
 * 押し続けている間、1つずつ繰り返す時計。押し始めにstart、離すときにstopを呼ぶ。
 *
 * 繰り返す中身（step）は続けてよいかを返す——送り切って対象が消えた、上限まで数えた、といった
 * 「もう繰り返せない」はやってみた側にしか分からないため。
 */
export class HoldRepeat {
  private readonly scene: Phaser.Scene;
  private timer: Phaser.Time.TimerEvent | undefined;
  private delay = REPEAT_MS;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** 繰り返しを始める（既に動いていれば仕切り直す）。1回目はHOLD_MS後。 */
  start(step: () => boolean): void {
    this.stop();
    this.delay = REPEAT_MS;
    this.schedule(HOLD_MS, step);
  }

  stop(): void {
    this.timer?.remove();
    this.timer = undefined;
  }

  private schedule(delay: number, step: () => boolean): void {
    this.timer = this.scene.time.delayedCall(delay, () => {
      if (!step()) return;

      const next = this.delay;
      this.delay = Math.max(REPEAT_MIN_MS, this.delay * REPEAT_DECAY);
      this.schedule(next, step);
    });
  }
}
