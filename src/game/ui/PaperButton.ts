import type Phaser from 'phaser';
import { Button } from '../../ui/Button';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import type { BarIcon } from '../looks/barIcons';
import { COLOR, SIZE } from '../looks/theme';
import { SLOT_BUTTON_PAPER_TEXTURE } from '../../art/slotButtonArt';
import { buttonIcon } from './buttonIcon';

/** 紙のボタン1つぶんの中身。 */
export interface PaperButtonContent {
  /** 紙の下に敷く色。紙は染めてあるので、透けたところにこの色が出る。 */
  readonly fill: number;

  /** 中央へ置く絵（無ければ絵文字、buttonIcon）。 */
  readonly icon: BarIcon;

  /** 絵を敷くキャンバスの寸法（u単位）と、絵文字の大きさ（u単位）。 */
  readonly iconCanvas: { readonly width: number; readonly height: number };
  readonly glyphSize: number;

  /**
   * 敷く紙の番号。**ボタンごとに別の1枚を敷く**——同じ絵だと同じ染みが並び、模様として目に付く。
   * 枚数を超えた番号は先頭へ回る。
   */
  readonly paperIndex: number;
}

/**
 * 染めた紙を地に敷き、絵だけを中央に置くボタン（ScreenLayout.md 4.2節）。
 *
 * **色も角丸も絵に焼いてある**（recipes/slot_button_paper.json、カードの枠と同じ扱い）。実行時に
 * 染めて切り抜くと、どちらもWebGL専用の機能になり、WebGLの無い環境で色も角丸も消える。敷く紙は
 * ボタン専用の絵（`SLOT_BUTTON_PAPER_TEXTURE`）で、ボタン1つぶんが1枚——**カードの枠とは別の絵**で、
 * 同じ紙から切り出してあるだけ。枠線は紙の上へ引き直す（Buttonが描く枠線は紙の下になる）。
 *
 * **紙が読めなければ何も敷かず**、Buttonの平らな塗りがそのまま地になる。
 *
 * **紙として置かれるので影を落とす**（drawBoxのshadow）。立体的な縁は足さない——枠を持たせるとカードと
 * 同じ格に見えて、画面のメリハリが消える。
 */
export class PaperButton extends Button {
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, rect: Rect, content: PaperButtonContent) {
    const radius = metrics.px(SIZE.radius);
    const borderWidth = metrics.linePx(2);
    super(scene, rect, {
      fillColor: content.fill,
      borderColor: COLOR.paperButtonBorder,
      borderWidth,
      radius,
      shadowOffset: metrics.px(SIZE.paperButtonShadow),
    });

    this.addContent(...paper(scene, rect, content.paperIndex, radius, borderWidth));
    this.addCentered(buttonIcon(scene, metrics, content.icon, content.iconCanvas, content.glyphSize));
  }
}

/** ボタンの地に敷く紙と、その上へ引き直す枠線（紙が読めていなければ何も敷かない）。 */
function paper(
  scene: Phaser.Scene,
  rect: Rect,
  index: number,
  radius: number,
  borderWidth: number,
): Phaser.GameObjects.GameObject[] {
  if (!scene.textures.exists(SLOT_BUTTON_PAPER_TEXTURE)) return [];

  const sheet = scene.textures.get(SLOT_BUTTON_PAPER_TEXTURE);
  const sheetPaper = scene.add
    .image(0, 0, SLOT_BUTTON_PAPER_TEXTURE, index % sheet.frameTotal)
    .setOrigin(0, 0)
    .setDisplaySize(rect.width, rect.height);

  const frame = scene.add.graphics();
  frame.lineStyle(borderWidth, COLOR.paperButtonBorder, 1);
  frame.strokeRoundedRect(0, 0, rect.width, rect.height, radius);
  return [sheetPaper, frame];
}
