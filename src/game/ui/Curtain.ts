import type Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import { addInputBlockingPanel } from '../../ui/shapes';
import { COLOR } from '../looks/theme';

/**
 * 場面転換の暗幕。指定した矩形を覆って暗転し、明転し切ったら自分を片付ける。
 *
 * 幕は敷いた時点から入力を遮る（addInputBlockingPanel）。まだ暗くなり切っていなくても、その範囲は次の場面へ
 * 移り始めているため、そこへの操作を受け付けてはならない。
 *
 * 層（depth）は指定しない。既定の層のまま、敷いた時点で最も手前に居ることを描画順に委ねている
 * （画面の組み立ても同じ規約、PlayScene参照）。
 */
export class Curtain {
  private readonly scene: Phaser.Scene;
  private readonly cover: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, rect: Rect) {
    this.scene = scene;
    this.cover = addInputBlockingPanel(scene, rect, COLOR.curtain).setAlpha(0);
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
