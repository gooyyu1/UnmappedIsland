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

  /**
   * 塗りの右端と、赤い帯の右端（悪化していなければ同じ値）。帯は常に両者の間に出る。
   * どちらが「今の値」かは向きで変わる: 減ると悪いバーは塗り、増えると悪いバーは帯の側が今の値で、
   * もう一方が遅れて追いつく（ScreenLayout.md ステータスエリア節）。
   */
  private ratio: number;
  private lagRatio: number;

  private lagTween: Phaser.Tweens.Tween | undefined;

  /** 帯を縮め始めずに溜めている最中か（setRatioのhold）。 */
  private holding = false;

  /** 警戒を示す枠。明滅は濃さのtweenだけで見せ、毎フレーム描き直さない。 */
  private readonly alertFrame: Phaser.GameObjects.Graphics;
  private alertColor: number | undefined;
  private blinkTween: Phaser.Tweens.Tween | undefined;

  /** 増えるほど悪い値か（PropertyDef.worsensUpward）。塗りの色と、帯をどちら向きに出すかが変わる。 */
  private readonly worsensUpward: boolean;

  constructor(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    x: number,
    y: number,
    width: number,
    height: number,
    ratio: number,
    worsensUpward = false,
  ) {
    super(scene, x, y);
    this.worsensUpward = worsensUpward;

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
    this.stopShrinking();
    this.holding = false;

    this.ratio = Phaser.Math.Clamp(ratio, 0, 1);
    this.lagRatio = this.ratio;
    this.draw();
  }

  /** 今の値。増えると悪いバーでは帯の側が先に動くので、そちらが今の値になる。 */
  private get currentRatio(): number {
    return this.worsensUpward ? this.lagRatio : this.ratio;
  }

  /**
   * 満たされ具合を変える。**悪化した分は赤い帯として残し、少し遅れて追いつかせる**（格闘ゲームの
   * 体力バーと同じで、どれだけ悪くなったかを目で追えるようにするため）。減ると悪いバーでは塗りが先に
   * 縮んで帯が後から縮み、増えると悪いバーでは帯が先に伸びて塗りが後から伸びる。好転した分に帯は
   * 残さない——良くなった分は塗りそのものの動きで分かるため。
   *
   * holdは「まだ値が動き続けている最中か」。trueの間は追いつかせず、帯を動き始めの位置に残したままに
   * するので、何度かに分けて悪化した分が合計として読める（ScreenLayout.md ステータスエリア節）。
   * holdをfalseに戻した時点から動き始めるため、値が変わらないtrue→falseの呼び出しにも意味がある。
   */
  setRatio(ratio: number, hold = false): void {
    const next = Phaser.Math.Clamp(ratio, 0, 1);
    if (next === this.currentRatio && hold === this.holding) return;

    // 追いつき切る前にまた悪化したら、前回の動き始めの位置から続ける（帯は最も悪かった位置に残る）。
    this.stopShrinking();

    if (this.worsensUpward) {
      if (next > this.lagRatio) this.lagRatio = next;
      else {
        this.ratio = next;
        this.lagRatio = next;
      }
    } else {
      if (next < this.ratio) this.lagRatio = Math.max(this.lagRatio, this.ratio);
      else if (next > this.ratio) this.lagRatio = next;
      this.ratio = next;
    }
    this.holding = hold;
    this.draw();

    if (this.holding || this.lagRatio <= this.ratio) return;

    // 追いつくのは、悪化のときに置いていかれた側（減ると悪いバーは帯、増えると悪いバーは塗り）。
    const lag = { value: this.worsensUpward ? this.ratio : this.lagRatio };
    this.lagTween = this.scene.tweens.add({
      targets: lag,
      value: this.worsensUpward ? this.lagRatio : this.ratio,
      delay: LAG_DELAY_MS,
      duration: LAG_DURATION_MS,
      ease: 'Sine.easeIn',
      onUpdate: () => {
        if (this.worsensUpward) this.ratio = lag.value;
        else this.lagRatio = lag.value;
        this.draw();
      },
      onComplete: () => {
        this.lagTween = undefined;
      },
    });
  }

  private stopShrinking(): void {
    this.lagTween?.stop();
    this.lagTween = undefined;
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
      const fill = this.worsensUpward ? COLOR.statusBarFillWorsening : COLOR.statusBarFill;
      drawBox(this.bar, { x: 0, y: 0, width: fillWidth, height }, { fill, radius });
    }

    drawBox(
      this.bar,
      { x: 0, y: 0, width, height },
      { border: COLOR.statusBarTrackBorder, borderWidth: this.borderWidth, radius },
    );
  }
}
