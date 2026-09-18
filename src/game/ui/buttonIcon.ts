import type Phaser from 'phaser';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import type { BarIcon } from '../looks/barIcons';
import { iconTexture } from '../../art/iconArt';
import { addLabel } from '../../ui/labels';

/**
 * 絵があればそれを、無ければ絵文字を、ボタンの中央へ置く（iconArt参照）。canvasは絵を敷く寸法、
 * glyphSizeは絵文字の大きさで、**スロットのボタンと桟のアイコンの違いはこの2値だけ**なので仕組みは
 * 分けない。
 *
 * **どの絵も同じ大きさで敷く。** どれも同じ寸法のキャンバスに、物だけが実物の大小——開いた地図 >
 * Tシャツ > 巻いた包帯——のとおり描き分けてある（card_art.pyの--canvas）。UIが物の大きさを測って
 * 揃えると、その差が消えてしまう。周りは透けているので、ボタンの地の色が下に出る。
 *
 * 置くのは原点（0, 0）で、どこへ寄せるかは呼び出し側（Button.addCentered）が決める。
 */
export function buttonIcon(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  spec: BarIcon,
  canvas: { readonly width: number; readonly height: number },
  glyphSize: number,
): Phaser.GameObjects.Image | Phaser.GameObjects.Text {
  const texture = spec.art === undefined ? undefined : iconTexture(spec.art);
  if (texture !== undefined && scene.textures.exists(texture)) {
    return scene.add.image(0, 0, texture).setDisplaySize(metrics.px(canvas.width), metrics.px(canvas.height));
  }
  return addLabel(scene, metrics, 0, 0, spec.icon, { size: glyphSize });
}
