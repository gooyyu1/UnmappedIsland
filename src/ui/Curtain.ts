import type Phaser from 'phaser';
import type { Rect } from './Rect';
import { addInputBlockingPanel } from './shapes';

/**
 * 場面転換の暗幕。指定した矩形を覆って暗転し、明転し切ったら自分を片付ける。
 *
 * 幕は敷いた時点から入力を遮る（addInputBlockingPanel）。まだ暗くなり切っていなくても、その範囲は次の場面へ
 * 移り始めているため、そこへの操作を受け付けてはならない。
 *
 * 層（depth）は指定しない。既定の層の中で最後に作られることによって、敷いた時点でその層の最も手前に
 * 居る。**覆えるのは幕より奥の層まで**で、手前の層を持つ表示物は暗転しても残る。
 */
export class Curtain {
  private readonly scene: Phaser.Scene;
  private readonly cover: Phaser.GameObjects.Rectangle;

  /** 覆う矩形と、暗転し切ったときの色。 */
  constructor(scene: Phaser.Scene, rect: Rect, color: number) {
    this.scene = scene;
    this.cover = addInputBlockingPanel(scene, rect, color).setAlpha(0);
  }

  /** durationミリ秒かけて暗転させる。時間をかけない場合はその場で暗転し切る。 */
  darken(duration: number): void {
    if (duration <= 0) {
      this.cover.setAlpha(1);
      return;
    }
    this.scene.tweens.add({ targets: this.cover, alpha: 1, duration, ease: 'Linear' });
  }

  /** durationミリ秒かけて明転させ、幕を片付ける。 */
  brighten(duration: number, onBrightened: () => void): void {
    this.scene.tweens.add({
      targets: this.cover,
      alpha: 0,
      duration,
      ease: 'Linear',
      onComplete: () => {
        this.cover.destroy();
        onBrightened();
      },
    });
  }
}
