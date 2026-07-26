import Phaser from 'phaser';
import type { ScreenMetrics } from '../layout/ScreenMetrics';
import { COLOR } from './theme';

/** ドーナツの外半径と輪の太さ（u単位）。 */
const RADIUS = 130;
const THICKNESS = 30;

/** 画面の内容に重ねて出すので、下が透けるだけの濃さにする。 */
const TRACK_ALPHA = 0.3;
const FILL_ALPHA = 0.85;

/**
 * 時間経過を見せるドーナツグラフ。全体を100%として、経過ぶんを真上から時計回りに塗る。
 *
 * 進捗バー（ProgressBar）と違い、画面の内容へ重ねて出すことを前提にした見た目にしている。
 */
/** これより狭い扇形は塗らない（0%・100%のときの潰れた図形を避ける）。 */
const MIN_SECTOR = 0.001;

export class ProgressRing extends Phaser.GameObjects.Container {
  private readonly graphics: Phaser.GameObjects.Graphics;

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
    this.setRatio(0);

    scene.add.existing(this);
  }

  /** 塗る割合（0〜1）を差し替える。時間の経過に合わせて毎フレーム呼ばれうる。 */
  setRatio(ratio: number): void {
    if (this.scene === undefined) return;

    this.graphics.clear();

    const top = -Math.PI / 2;
    const swept = Phaser.Math.Clamp(ratio, 0, 1) * Math.PI * 2;
    this.fillSector(COLOR.progressRingTrack, TRACK_ALPHA, top + swept, top + Math.PI * 2);
    this.fillSector(COLOR.progressRingFill, FILL_ALPHA, top, top + swept);
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
      return;
    }

    this.graphics.fillStyle(color, alpha);
    this.graphics.beginPath();
    this.graphics.arc(0, 0, this.outer, from, to, false);
    this.graphics.arc(0, 0, this.inner, to, from, true);
    this.graphics.closePath();
    this.graphics.fillPath();
  }
}
