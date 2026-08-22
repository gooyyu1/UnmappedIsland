import Phaser from 'phaser';
import type { AlertLevel } from '../../domain/AlertLevel';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { drawBox } from '../../ui/shapes';
import { COLOR, fadedFill, statusFillColorFor } from '../looks/theme';

/** 域ごとの警戒の枠の色（明滅させない域はundefined）。 */
function alertBorderColor(alert: AlertLevel): number | undefined {
  if (alert === 'danger') return COLOR.statusAlertDanger;
  if (alert === 'fatal') return COLOR.statusAlertFatal;
  return undefined;
}

/**
 * 変わった分を帯として残す時間と、それが追いつき切るまでの時間（StatusArea.md）。
 * 溜めを置いてから動かすのは、変化に気付く前に消えてしまわないようにするため。
 */
const LAG_DELAY_MS = 250;
const LAG_DURATION_MS = 700;

/**
 * トラックの枠線の太さ（u単位）。**枠線の外周を周りの何かに合わせる側**が、寄せる量を知るために
 * 読む（Card.addRailBar）。
 */
export const TRACK_BORDER_WIDTH = 2;

/** 警戒を示す枠の明滅（片道の時間と、最も薄いときの濃さ）。 */
const BLINK_DURATION_MS = 450;
const BLINK_MIN_ALPHA = 0.15;

/** 警戒を示す枠の太さ（通常の枠線より太くして、明滅していることが分かるようにする）。 */
const ALERT_BORDER_WIDTH = 5;

/** 警戒の枠の下に敷く暗い線が、枠からはみ出す太さ（濃い塗りの上でも輪郭が残るように）。 */
const ALERT_OUTLINE_EXTRA_WIDTH = 4;

/** バーの見せ方の選択肢（既定はステータスバーの見せ方）。 */
export interface ProgressBarOptions {
  /** 増えるほど悪い値か（PropertyDef.worsensUpward）。塗りの色と、帯をどちら向きに出すかが変わる。 */
  readonly worsensUpward?: boolean;

  /**
   * 今の満たされ具合から塗りの色を引く。省略すると域（alert）から引く（statusFillColorFor）。
   * 域を持たない量——耐久度・液体の残量——を映すバーだけが渡す。
   */
  readonly fillColor?: (ratio: number) => number;

  /**
   * 帯が今の値へ追いつき切ったときに呼ぶ。変化を見せ終わるまで並びに残している行を、そのとき
   * 外すために使う（statusRows・PlayScene.showStatuses）。
   */
  readonly onCaughtUp?: () => void;

  /**
   * 危険域・致命的域で枠を明滅させないか（既定は明滅する）。**明滅は「手を止めろ」という催促**
   * なので、催促する立場にないバーが渡す——カードの状態バーは「今どうなっているか」を色と長さで
   * 言うだけで、催促は札の縁とステータスエリアの役目（CardView.md 8節）。
   */
  readonly steady?: boolean;
}

/**
 * 横方向の進捗バー（枠付きのトラックと、左詰めの塗り）。ステータスバー・探索ウィンドウ・カードの
 * 状態バーのように「全体に対する割合」を見せる場所で共用する。
 *
 * 寸法はピクセルで受け取り、角の丸みだけを高さから決める（高さを変えても丸みの見え方が揃うため）。
 */
export class ProgressBar extends Phaser.GameObjects.Container {
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly barWidth: number;
  private readonly barHeight: number;
  private readonly borderWidth: number;
  private readonly alertBorderWidth: number;

  /** 警戒の枠の下に敷く暗い線の太さ（枠より少し太い）。 */
  private readonly alertOutlineWidth: number;
  private readonly radius: number;

  /**
   * 今の値と、そこへ遅れて追いつく側（変化前の値から動き出す）。**広い方が帯、狭い方が塗り**になるため、
   * 悪化では塗りが先に動いて帯が残り、好転では帯が先に伸びて塗りが後から満ちる。どちら向きの変化でも
   * 「変わった分」が帯として読める（StatusArea.md）。
   */
  private ratio: number;
  private shownRatio: number;

  private lagTween: Phaser.Tweens.Tween | undefined;

  /** 直前の変化が好転だったか。帯の色（失った分か、これから満ちる分か）がこれで決まる。 */
  private improving = false;

  /** 帯を動かし始めずに溜めている最中か（setRatioのhold）。 */
  private holding = false;

  /** 警戒を示す枠。明滅は濃さのtweenだけで見せ、毎フレーム描き直さない。 */
  private readonly alertFrame: Phaser.GameObjects.Graphics;
  private blinkTween: Phaser.Tweens.Tween | undefined;

  /** 今の域。塗りの色と、警戒の枠を出すかどうかの両方がこれで決まる。 */
  private alert: AlertLevel = 'safe';

  /**
   * 増えるほど悪い値か（PropertyDef.worsensUpward）。帯をどちら向きに出すかが変わる。
   * 同じバーの枠（ProgressBar）を差し替えのたびに使い回す側（Card.gaugeBars）は、映すものが
   * 変わるたびにこれも渡し直す（setWorsensUpward）ため、readonlyにはしない。
   */
  private worsensUpward: boolean;

  /** 塗りの色の引き方（ProgressBarOptions.fillColor）。 */
  private readonly fillColor: ((ratio: number) => number) | undefined;

  /** 危険域でも明滅させないか（ProgressBarOptions.steady）。 */
  private readonly steady: boolean;

  /** トラックの枠線の色（setBorderColor）。 */
  private borderColor: number = COLOR.statusBarTrackBorder;

  /** 追いつき切ったときの通知（ProgressBarOptions.onCaughtUp）。 */
  private readonly onCaughtUp: (() => void) | undefined;

  constructor(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    x: number,
    y: number,
    width: number,
    height: number,
    ratio: number,
    options: ProgressBarOptions = {},
  ) {
    super(scene, x, y);
    this.worsensUpward = options.worsensUpward === true;
    this.fillColor = options.fillColor;
    this.steady = options.steady === true;
    this.onCaughtUp = options.onCaughtUp;

    this.barWidth = width;
    this.barHeight = height;
    this.borderWidth = metrics.linePx(TRACK_BORDER_WIDTH);
    this.alertBorderWidth = metrics.linePx(ALERT_BORDER_WIDTH);
    this.alertOutlineWidth = this.alertBorderWidth + metrics.linePx(ALERT_OUTLINE_EXTRA_WIDTH);
    this.radius = height / 4;
    this.ratio = Phaser.Math.Clamp(ratio, 0, 1);
    this.shownRatio = this.ratio;

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
   * 渡した値に対して、帯がまだ追いついていないか（＝そこへ動かすとまだ見せる変化が残るか）。
   * 見せ終わるまで消したくない側が、消す前に訊く（StatusBar.isShowingChange）。
   */
  isBehind(ratio: number): boolean {
    return Phaser.Math.Clamp(ratio, 0, 1) !== this.shownRatio;
  }

  /**
   * トラックの枠線の色を変える。**周りの意匠に合わせる必要がある置き場所が渡す**——カードの状態バーは
   * 札の縁と同じ色で、種別（アイテム・動物・怪我…）ごとに変わる（CardView.md 8節）。
   */
  setBorderColor(color: number): void {
    if (color === this.borderColor) return;
    this.borderColor = color;
    this.draw();
  }

  /**
   * 増えるほど悪い値かを変える。**次に`setRatio`で変化を見せるときの帯の向きにだけ効く**——
   * 今の見た目（draw）はこれ単独では変わらないので、呼び直しは要らない。同じバーの枠を差し替えの
   * たびに使い回す側（Card.gaugeBars）が、映すものが変わるたびに渡し直す。
   */
  setWorsensUpward(worsensUpward: boolean): void {
    this.worsensUpward = worsensUpward;
  }

  /**
   * 満たされ具合を、変化を見せずに今の値にする。目で追えなかった変化（バーが出ていない間に
   * 進んだ分）に使う（StatusBar.show参照）。
   */
  resetRatio(ratio: number): void {
    this.stopChasing();
    this.holding = false;

    this.ratio = Phaser.Math.Clamp(ratio, 0, 1);
    this.shownRatio = this.ratio;
    this.draw();
  }

  /**
   * 満たされ具合を変える。**変わった分は帯として残し、少し遅れて追いつかせる**（格闘ゲームの体力バーと
   * 同じで、どれだけ変わったのかを目で追えるようにするため）。動くのは常に変化前の値の側で、今の値の側は
   * すぐそこへ移る——値そのものは待たせず、変化の量だけを目で追わせる。結果として、増えたときは帯が先に
   * 伸びて塗りが後から満ち、減ったときは塗りが先に縮んで帯が後から追いつく。
   *
   * 良し悪しを表すのは帯の色だけ（悪化なら赤、好転なら塗りを薄めた色）。増えると悪いバーでは、増えた分の
   * 帯が赤くなる。
   *
   * holdは「まだ値が動き続けている最中か」。trueの間は追いつかせず、帯を動き始めの位置に残したままに
   * するので、何度かに分けて変わった分が合計として読める（StatusArea.md）。
   * holdをfalseに戻した時点から動き始めるため、値が変わらないtrue→falseの呼び出しにも意味がある。
   */
  setRatio(ratio: number, hold = false): void {
    const next = Phaser.Math.Clamp(ratio, 0, 1);
    if (next === this.ratio && hold === this.holding) return;

    // 追いつき切る前にまた変わったら、今見えている位置から続ける（帯は変化の端に残る）。
    this.stopChasing();

    if (next !== this.ratio) this.improving = this.worsensUpward ? next < this.ratio : next > this.ratio;
    this.ratio = next;
    this.holding = hold;
    this.draw();

    if (this.holding || this.shownRatio === this.ratio) return;

    // 動かすのは変化前の値の側。今の値へ追いつくまでの差が帯になる。
    const chasing = { value: this.shownRatio };
    this.lagTween = this.scene.tweens.add({
      targets: chasing,
      value: this.ratio,
      delay: LAG_DELAY_MS,
      duration: LAG_DURATION_MS,
      ease: 'Sine.easeIn',
      onUpdate: () => {
        this.shownRatio = chasing.value;
        this.draw();
      },
      onComplete: () => {
        this.lagTween = undefined;
        // 端数を残すとisBehindが真のままになるため、追いついたことを値で確定させる。
        this.shownRatio = this.ratio;
        this.draw();
        this.onCaughtUp?.();
      },
    });
  }

  private stopChasing(): void {
    this.lagTween?.stop();
    this.lagTween = undefined;
  }

  /**
   * 今どの域にいるかを伝える。塗りの色（statusFillColorFor）が変わり、危険域・致命的域では枠が明滅する
   * （StatusArea.md）。域を持たないバー（探索率）は安全域のままで、緑の塗りになる。
   */
  setAlert(alert: AlertLevel): void {
    if (alert === this.alert) return;
    this.alert = alert;
    this.draw();

    const color = this.steady ? undefined : alertBorderColor(alert);
    if (color === undefined) {
      this.blinkTween?.stop();
      this.blinkTween = undefined;
      this.alertFrame.setVisible(false).setAlpha(1);
    } else {
      // 明るい枠は、濃い塗りの上では沈む。必ず暗い線を先に敷き、その上へ載せて輪郭を保つ。
      const box = { x: 0, y: 0, width: this.barWidth, height: this.barHeight };
      const width = Math.max(this.borderWidth, this.alertBorderWidth);
      this.alertFrame.clear();
      drawBox(this.alertFrame, box, {
        border: COLOR.statusAlertOutline,
        borderWidth: this.alertOutlineWidth,
        radius: this.radius,
      });
      drawBox(this.alertFrame, box, { border: color, borderWidth: width, radius: this.radius });
      this.alertFrame.setVisible(true);

      this.blinkTween ??= this.scene.tweens.add({
        targets: this.alertFrame,
        alpha: BLINK_MIN_ALPHA,
        duration: BLINK_DURATION_MS,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  /** トラック → 変化の帯 → 塗り → 枠線の順に重ねる。帯は塗りより広い側なので、はみ出した分だけが見える。 */
  private draw(): void {
    const { barWidth: width, barHeight: height, radius } = this;

    this.bar.clear();
    drawBox(this.bar, { x: 0, y: 0, width, height }, { fill: COLOR.statusBarTrack, radius });

    const fill = this.fillColor?.(this.ratio) ?? statusFillColorFor(this.alert);
    const bandWidth = width * Math.max(this.ratio, this.shownRatio);
    if (bandWidth > 0) {
      // 失った分は赤、これから満ちる分は塗りを淡くした色（何が増える途中なのかが色で分かる）。
      const band = this.improving ? fadedFill(fill) : COLOR.statusBarLag;
      drawBox(this.bar, { x: 0, y: 0, width: bandWidth, height }, { fill: band, radius });
    }

    const fillWidth = width * Math.min(this.ratio, this.shownRatio);
    if (fillWidth > 0) {
      drawBox(this.bar, { x: 0, y: 0, width: fillWidth, height }, { fill, radius });
    }

    drawBox(
      this.bar,
      { x: 0, y: 0, width, height },
      { border: this.borderColor, borderWidth: this.borderWidth, radius },
    );
  }
}
