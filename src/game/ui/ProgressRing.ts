import Phaser from 'phaser';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { elapsedText } from '../looks/durationText';
import { cssColor } from '../../util/cssColor';
import { COLOR, FONT_FAMILY } from '../looks/theme';

/** ドーナツの外半径と輪の太さ（u単位）。 */
const RADIUS = 130;
const THICKNESS = 30;

/** 画面の内容に重ねて出すので、下が透けるだけの濃さにする。 */
const TRACK_ALPHA = 0.3;
const FILL_ALPHA = 0.85;

/**
 * 経過時間の文字の大きさと縁取りの太さ。**輪の外径（260u）より横へはみ出す大きさ**にして、輪は
 * 文字の後ろへ回す——輪だけでは何分経ったのかが読めないので、読ませたいほうを手前に置く。
 */
const ELAPSED_SIZE = 120;
const ELAPSED_STROKE = 10;

/** これより狭い扇形は塗らない（0%・100%のときの潰れた図形を避ける）。 */
const MIN_SECTOR = 0.001;

/**
 * 時間経過を見せるドーナツグラフ。全体を100%として、経過ぶんを真上から時計回りに塗る。
 *
 * 進捗バー（ProgressBar）と違い、画面の内容へ重ねて出すことを前提にした見た目にしている。
 */
export class ProgressRing extends Phaser.GameObjects.Container {
  private readonly graphics: Phaser.GameObjects.Graphics;

  /** 開始からの経過時間。輪の手前に出す（ELAPSED_SIZE）。 */
  private readonly elapsed: Phaser.GameObjects.Text;

  /** 輪の外半径と内半径。 */
  private readonly outer: number;
  private readonly inner: number;

  /** x・yはドーナツの中心。 */
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number) {
    super(scene, x, y);

    this.outer = metrics.px(RADIUS);
    this.inner = this.outer - metrics.px(THICKNESS);
    this.graphics = scene.add.graphics();
    this.add(this.graphics);

    this.elapsed = scene.add
      .text(0, 0, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(ELAPSED_SIZE)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.progressRingElapsed),
      })
      .setOrigin(0.5)
      .setStroke(cssColor(COLOR.progressRingElapsedOutline), metrics.px(ELAPSED_STROKE));
    this.add(this.elapsed);

    this.setProgress(0, 0);

    scene.add.existing(this);
  }

  /**
   * 塗る割合（0〜1）と、開始からの経過分を差し替える。時間の経過に合わせて毎フレーム呼ばれうる。
   *
   * 割合と経過分を1つの操作で受けるのは、輪と数字が同じ瞬間を指していなければならないため
   * ——別々に渡せるようにすると、呼ぶ側が片方だけ更新できてしまう。
   */
  setProgress(ratio: number, elapsedMinutes: number): void {
    if (this.scene === undefined) return;

    this.graphics.clear();

    const top = -Math.PI / 2;
    const swept = Phaser.Math.Clamp(ratio, 0, 1) * Math.PI * 2;
    this.fillSector(COLOR.progressRingTrack, TRACK_ALPHA, top + swept, top + Math.PI * 2);
    this.fillSector(COLOR.progressRingFill, FILL_ALPHA, top, top + swept);

    this.elapsed.setText(elapsedText(elapsedMinutes));
  }

  /**
   * 中心角fromからtoまでの、輪の一部を塗る。
   *
   * 太い線で円弧を描くのではなく、外周と内周をつないだ図形として塗る。太線は継ぎ目が重なるため、
   * 半透明にすると重なりが縞になって見えてしまうため。半周を超える分は割って、始点と終点が
   * 重なる潰れた図形にならないようにする。
   */
  private fillSector(color: number, alpha: number, from: number, to: number): void {
    const span = to - from;
    if (span < MIN_SECTOR) return;
    if (span > Math.PI) {
      this.fillSector(color, alpha, from, from + span / 2);
      this.fillSector(color, alpha, from + span / 2, to);
    } else {
      this.graphics.fillStyle(color, alpha);
      this.graphics.beginPath();
      this.graphics.arc(0, 0, this.outer, from, to, false);
      this.graphics.arc(0, 0, this.inner, to, from, true);
      this.graphics.closePath();
      this.graphics.fillPath();
    }
  }
}
