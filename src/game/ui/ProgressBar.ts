import Phaser from 'phaser';
import type { ScreenMetrics } from '../layout/ScreenMetrics';
import { drawBox } from './shapes';
import { COLOR } from './theme';

/**
 * 減った分を赤い帯として残す時間と、それが縮み切るまでの時間（ScreenLayout.md ステータスエリア節）。
 * 溜めを置いてから縮めるのは、変化に気付く前に消えてしまわないようにするため。
 */
const LAG_DELAY_MS = 250;
const LAG_DURATION_MS = 700;

/** 警戒を示す枠の明滅（片道の時間と、最も薄いときの濃さ）。 */
const BLINK_DURATION_MS = 450;
const BLINK_MIN_ALPHA = 0.15;

/** 警戒を示す枠の太さ（通常の枠線より太くして、明滅していることが分かるようにする）。 */
const ALERT_BORDER_WIDTH = 5;

/**
 * 横方向の進捗バー（枠付きのトラックと、左詰めの塗り）。ステータスバー・探索ウィンドウのように
 * 「全体に対する割合」を見せる場所で共用する。
 *
 * 寸法はピクセルで受け取り、角の丸みだけを高さから決める（高さを変えても丸みの見え方が揃うため）。
 */
export class ProgressBar extends Phaser.GameObjects.Container {
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly barWidth: number;
  private readonly barHeight: number;
  private readonly borderWidth: number;
  private readonly alertBorderWidth: number;
  private readonly radius: number;

  /** 今の満たされ具合と、減る前の位置に残している赤い帯の右端（減っていなければ同じ値）。 */
  private ratio: number;
  private lagRatio: number;

  private lagTween: Phaser.Tweens.Tween | undefined;

  /** 警戒を示す枠。明滅は濃さのtweenだけで見せ、毎フレーム描き直さない。 */
  private readonly alertFrame: Phaser.GameObjects.Graphics;
  private alertColor: number | undefined;
  private blinkTween: Phaser.Tweens.Tween | undefined;

  constructor(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    x: number,
    y: number,
    width: number,
    height: number,
    ratio: number,
  ) {
    super(scene, x, y);

    this.barWidth = width;
    this.barHeight = height;
    this.borderWidth = Math.max(1, metrics.px(2));
    this.alertBorderWidth = Math.max(1, metrics.px(ALERT_BORDER_WIDTH));
    this.radius = height / 4;
    this.ratio = Phaser.Math.Clamp(ratio, 0, 1);
    this.lagRatio = this.ratio;

    this.bar = scene.add.graphics();
    this.add(this.bar);
    this.draw();

    // 警戒の枠は塗りより手前に重ねる（バーより後に作る）。
    this.alertFrame = scene.add.graphics().setVisible(false);
    this.add(this.alertFrame);

    // 動いている途中で画面を作り直されることがある。止めないと、捨てられたバーを動かし続ける。
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.lagTween?.stop();
      this.blinkTween?.stop();
    });

    scene.add.existing(this);
  }

  /**
   * 満たされ具合を、減った様子を見せずに今の値にする。目で追えなかった変化（バーが出ていない間に
   * 進んだ分）に使う（StatusBar.show参照）。
   */
  resetRatio(ratio: number): void {
    this.lagTween?.stop();
    this.lagTween = undefined;

    this.ratio = Phaser.Math.Clamp(ratio, 0, 1);
    this.lagRatio = this.ratio;
    this.draw();
  }

  /**
   * 満たされ具合を変える。**減ったときは、減る前の位置まで赤い帯を残し、少し遅れて縮める**
   * （格闘ゲームの体力バーと同じで、どれだけ減ったかを目で追えるようにするため）。
   * 増えたときは赤い帯を残さない——増えた分は塗りそのものが伸びて分かるため。
   */
  setRatio(ratio: number): void {
    const next = Phaser.Math.Clamp(ratio, 0, 1);
    if (next === this.ratio) return;

    // 縮み切る前にまた減ったら、前回の減り始めの位置から続ける（帯は右端が最も高かった位置に残る）。
    this.lagTween?.stop();
    this.lagTween = undefined;

    const decreased = next < this.ratio;
    this.lagRatio = decreased ? Math.max(this.lagRatio, this.ratio) : next;
    this.ratio = next;
    this.draw();

    if (!decreased) return;

    const lag = { value: this.lagRatio };
    this.lagTween = this.scene.tweens.add({
      targets: lag,
      value: next,
      delay: LAG_DELAY_MS,
      duration: LAG_DURATION_MS,
      ease: 'Sine.easeIn',
      onUpdate: () => {
        this.lagRatio = lag.value;
        this.draw();
      },
      onComplete: () => {
        this.lagTween = undefined;
      },
    });
  }

  /**
   * 警戒を示す枠を色で出す（undefinedで消す）。出ている間は濃さが明滅する。
   * どの域をどの色で示すかは呼び出し側の判断（StatusBar参照）。
   */
  setAlertBorder(color: number | undefined): void {
    if (color === this.alertColor) return;
    this.alertColor = color;

    if (color === undefined) {
      this.blinkTween?.stop();
      this.blinkTween = undefined;
      this.alertFrame.setVisible(false).setAlpha(1);
      return;
    }

    this.alertFrame.clear();
    drawBox(
      this.alertFrame,
      { x: 0, y: 0, width: this.barWidth, height: this.barHeight },
      { border: color, borderWidth: Math.max(this.borderWidth, this.alertBorderWidth), radius: this.radius },
    );
    this.alertFrame.setVisible(true);

    this.blinkTween ??= this.scene.tweens.add({
      targets: this.alertFrame,
      alpha: BLINK_MIN_ALPHA,
      duration: BLINK_DURATION_MS,
      yoyo: true,
      repeat: -1,
    });
  }

  /** トラック → 赤い帯 → 塗り → 枠線の順に重ねる。 */
  private draw(): void {
    const { barWidth: width, barHeight: height, radius } = this;

    this.bar.clear();
    drawBox(this.bar, { x: 0, y: 0, width, height }, { fill: COLOR.statusBarTrack, radius });

    const lagWidth = width * this.lagRatio;
    if (lagWidth > 0) {
      drawBox(this.bar, { x: 0, y: 0, width: lagWidth, height }, { fill: COLOR.statusBarLag, radius });
    }

    const fillWidth = width * this.ratio;
    if (fillWidth > 0) {
      drawBox(this.bar, { x: 0, y: 0, width: fillWidth, height }, { fill: COLOR.statusBarFill, radius });
    }

    drawBox(
      this.bar,
      { x: 0, y: 0, width, height },
      { border: COLOR.statusBarTrackBorder, borderWidth: this.borderWidth, radius },
    );
  }
}
