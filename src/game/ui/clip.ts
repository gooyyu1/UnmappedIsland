import Phaser from 'phaser';
import type { Rect } from '../layout/ScreenMetrics';
import { COLOR } from './theme';

/**
 * 表示物を矩形で切り抜く（矩形は画面座標）。返すのは切り抜きを解く後始末で、対象を捨てるときに呼ぶ
 * ——マスクの形は表示物ではないので、表示リストの片付けでは消えない。
 *
 * **手段はレンダラで分かれる。** Phaser 4のマスクは、WebGLではフィルタの一種
 * （`filters.internal.addMask`）、Canvasでは`setMask`で、**互いに排他**（setMaskはWebGLで警告を
 * 出して何もしない）。どちらか片方だけでは、そのレンダラでない環境で切り抜きが効かず、はみ出した
 * ものがそのまま出てしまう。
 *
 * 切り抜きを増やすときは、まず**切り抜かずに済ませられないか**を考えること（DesignNotes.md
 * 「Phaserのフィルタ」）。WebGL側は画面サイズの描画バッファを1枚使う。
 */
export function clipToRect(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Container,
  rect: Rect,
): () => void {
  const shape = scene.make.graphics({});
  shape.fillStyle(COLOR.cardFace, 1);
  shape.fillRect(rect.x, rect.y, rect.width, rect.height);

  if (scene.renderer.type === Phaser.CANVAS) {
    target.setMask(new Phaser.Display.Masks.GeometryMask(scene, shape));
  } else {
    target.enableFilters();
    target.filters?.internal.addMask(shape);
  }
  return () => shape.destroy();
}
