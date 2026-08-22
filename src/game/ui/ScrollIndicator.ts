import Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { scrollThumbSpan } from '../../ui/scroll';
import { drawBox } from '../../ui/shapes';
import { COLOR, SIZE } from '../looks/theme';

/** つまみの最小の長さ（u単位）。中身が長くても、これ以上は痩せさせない。 */
const MIN_THUMB_LENGTH = 48;

/** トラックとつまみの濃さ。下の絵を潰さない程度に薄く、つまみの縁が読める程度に濃く。 */
const TRACK_ALPHA = 0.28;
const THUMB_ALPHA = 0.85;

/** 送っている間の濃さと、止まっているときの濃さ。 */
const ACTIVE_ALPHA = 1;
const RESTING_ALPHA = 0.7;

/** 送るのが止まってから薄れ始めるまでの間と、薄れるのにかける時間（ミリ秒）。 */
const FADE_DELAY_MS = 800;
const FADE_MS = 400;

/**
 * 横スクロールできる帯の送り具合を示す、半透明のスクロールバー
 * （ScreenLayout.md 7.4節 フィールドエリア「スクロールバー」）。
 *
 * 呼び出し側は送り具合を渡すだけでよく、出す・出さないも濃さも気にしない。
 */
export class ScrollIndicator extends Phaser.GameObjects.Container {
  private readonly thumb: Phaser.GameObjects.Graphics;
  private readonly trackWidth: number;
  private readonly barHeight: number;
  private readonly minThumbLength: number;

  /** 今描いてあるつまみの長さ。長さが変わったときだけ描き直し、送るたびの移動は位置だけで行う。 */
  private thumbWidth = 0;

  private fadeTween: Phaser.Tweens.Tween | undefined;

  /** バーの左端・上端と長さをピクセルで受け取る。厚みは寸法トークン（SIZE.scrollBar）で決まる。 */
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number, width: number) {
    super(scene, x, y);

    this.trackWidth = width;
    this.barHeight = metrics.px(SIZE.scrollBar);
    this.minThumbLength = metrics.px(MIN_THUMB_LENGTH);

    const track = scene.add.graphics();
    drawBox(track, this.boxOf(width), {
      fill: COLOR.scrollBarTrack,
      fillAlpha: TRACK_ALPHA,
      radius: this.barHeight / 2,
    });
    this.thumb = scene.add.graphics();
    this.add([track, this.thumb]);
    this.setVisible(false).setAlpha(RESTING_ALPHA);

    // 動いている途中で画面を作り直されることがある。止めないと、捨てたバーを動かし続ける。
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.fadeTween?.stop());

    scene.add.existing(this);
  }

  /**
   * 送れる量と今の送り量を反映する（どちらも中身をずらす向きが負で、minOffsetが末尾）。
   * 中身が可視域に収まっていればminOffsetは0で、そのときはバーを出さない。
   */
  setScroll(offset: number, minOffset: number): void {
    if (minOffset >= 0) {
      this.setVisible(false);
      return;
    }

    const span = scrollThumbSpan(this.trackWidth, offset, minOffset, this.minThumbLength);
    if (span.width !== this.thumbWidth) {
      this.thumbWidth = span.width;
      this.thumb.clear();
      drawBox(this.thumb, this.boxOf(span.width), {
        fill: COLOR.scrollBarThumb,
        fillAlpha: THUMB_ALPHA,
        radius: this.barHeight / 2,
      });
    }

    const moved = span.x !== this.thumb.x || !this.visible;
    this.thumb.x = span.x;
    this.setVisible(true);
    if (moved) this.highlight();
  }

  /** 送っている間は濃くし、止まったら控えめな濃さへ戻す。 */
  private highlight(): void {
    this.fadeTween?.stop();
    this.setAlpha(ACTIVE_ALPHA);
    this.fadeTween = this.scene.tweens.add({
      targets: this,
      alpha: RESTING_ALPHA,
      delay: FADE_DELAY_MS,
      duration: FADE_MS,
      onComplete: () => {
        this.fadeTween = undefined;
      },
    });
  }

  /** トラック・つまみを描く矩形（バーのローカル座標）。 */
  private boxOf(width: number): Rect {
    return { x: 0, y: 0, width, height: this.barHeight };
  }
}
