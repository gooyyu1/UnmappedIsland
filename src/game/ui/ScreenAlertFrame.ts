import Phaser from 'phaser';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { COLOR } from '../looks/theme';

/** 枠の太さと、明滅の片道の時間・最も薄いときの濃さ。 */
const FRAME_WIDTH = 20;
const BLINK_DURATION_MS = 450;
const BLINK_MIN_ALPHA = 0.1;

/**
 * 致命的域のステータスがある間、画面全体の内周を赤く明滅させる枠（StatusArea.md）。
 * 画面のどこを見ていても気付けるようにするためのもので、入力は遮らない。
 *
 * 常に最前面へ出す必要があるため、置く側がdepthを与える（PlayScene参照）。
 */
export class ScreenAlertFrame extends Phaser.GameObjects.Graphics {
  private blinkTween: Phaser.Tweens.Tween | undefined;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics) {
    super(scene);

    const width = metrics.linePx(FRAME_WIDTH);
    // 線の中心を内側へ寄せて、枠が画面の内周に収まるように描く。
    this.lineStyle(width, COLOR.statusAlertFatal, 1);
    this.strokeRect(width / 2, width / 2, metrics.width - width, metrics.height - width);
    this.setVisible(false);

    this.once(Phaser.GameObjects.Events.DESTROY, () => this.blinkTween?.stop());
    scene.add.existing(this);
  }

  /** 致命的域のステータスがあるか。ある間だけ明滅する。 */
  setAlerting(alerting: boolean): void {
    if (alerting === this.visible) return;

    if (!alerting) {
      this.blinkTween?.stop();
      this.blinkTween = undefined;
      this.setVisible(false).setAlpha(1);
      return;
    }

    this.setVisible(true);
    this.blinkTween = this.scene.tweens.add({
      targets: this,
      alpha: BLINK_MIN_ALPHA,
      duration: BLINK_DURATION_MS,
      yoyo: true,
      repeat: -1,
    });
  }
}
