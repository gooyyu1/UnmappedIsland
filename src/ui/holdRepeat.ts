import type Phaser from 'phaser';

/**
 * 押し続けている間の繰り返しの速さ。1回目はHOLD後、そこからは間隔にDECAYを掛けてMINまで詰める
 * （キーリピートと同じ加速。押し始めは1回ずつ数えられ、押し続けると一息に進む）。
 *
 * MINが最高速度で、50ミリ秒＝秒間20回。100個を送り切るのに10秒はかからない。
 */
const HOLD_MS = 400;
const REPEAT_MS = 300;
export const REPEAT_MIN_MS = 50;
const REPEAT_DECAY = 0.8;

/**
 * 押し続けている間だけ何かを出す受け口（説明の吹き出し）。**始まりと終わりの両方**を受け取る。
 * 長押しになった押下は「押された」ことにならず、離してもタップの動作は起きない。
 */
export interface HoldHandlers {
  readonly onStart: () => void;
  readonly onEnd: () => void;
  /** 長押しと見なすまでの時間。0なら押した瞬間に始まる（押せないものが理由をすぐ出すため）。 */
  readonly delayMs?: number;
}

/**
 * 押し続けて初めて1度だけ起きるものの時計。押し始めにbegin、押下が終わるときにendを呼ぶ。
 * 押せるボタンの説明も、押せない札の理由も、出し方はこれ1つ（Button・Card）。
 *
 * **引っ込めるのは出したのと同じ受け口。** 押している最中に中身が差し替わっても、出したものが
 * 出たまま残らない。
 */
export class Hold {
  private readonly scene: Phaser.Scene;
  private timer: Phaser.Time.TimerEvent | undefined;

  /** 今出している受け口（まだ出していなければundefined）。 */
  private started: HoldHandlers | undefined;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** 計時を始める（既に動いていれば仕切り直す）。受け口を持たない押下では何も起きない。 */
  begin(handlers: HoldHandlers | undefined): void {
    this.end();
    if (handlers === undefined) return;

    this.timer = this.scene.time.delayedCall(handlers.delayMs ?? HOLD_MS, () => {
      this.started = handlers;
      handlers.onStart();
    });
  }

  /**
   * 出しているものを引っ込め、計時も止める。**押下が終わるどの経路も通る**（離す・外れる・
   * 掴む操作に変わる・破棄）。返すのは**その押下が長押しになっていたか**。
   */
  end(): boolean {
    this.timer?.remove();
    this.timer = undefined;
    const started = this.started;
    this.started = undefined;
    started?.onEnd();
    return started !== undefined;
  }
}

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
