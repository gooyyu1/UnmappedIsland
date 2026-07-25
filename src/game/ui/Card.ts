import Phaser from 'phaser';
import type { ScreenMetrics } from '../layout/ScreenMetrics';
import { COLOR, FONT_FAMILY, SIZE, cssColor } from './theme';
import { drawBox } from './shapes';
import { wrapByCharacter } from './textLayout';

/** カード名の最大行数。これを超える分は表示しない（モックの-webkit-line-clamp: 3に対応）。 */
const NAME_MAX_LINES = 3;

/**
 * フィールド・ハンド・ポートレイトに共通のカード。
 * 大きなアイコンを中央に敷き、名前を左上へ重ねる（ScreenLayout.md デザインメモ）。
 */
export class Card extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number, icon: string, name: string) {
    super(scene, x, y);

    const width = metrics.px(SIZE.cardWidth);
    const height = metrics.px(SIZE.cardHeight);

    const face = scene.add.graphics();
    drawBox(
      face,
      { x: 0, y: 0, width, height },
      {
        fill: COLOR.cardFace,
        fillAlpha: 0.85,
        border: COLOR.cardBorder,
        borderWidth: Math.max(1, metrics.px(2)),
        radius: metrics.px(SIZE.radius),
      },
    );

    const iconText = scene.add
      .text(width / 2, height / 2, icon, {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(96)}px`,
      })
      .setOrigin(0.5)
      .setAlpha(0.95);

    const inset = metrics.px(8);
    const nameText = scene.add
      .text(inset, metrics.px(6), name, {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(30)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.text),
        maxLines: NAME_MAX_LINES,
      })
      .setLineSpacing(metrics.px(2))
      .setShadow(0, 0, cssColor(COLOR.cardFace), metrics.px(3), false, true);
    nameText.setWordWrapCallback(wrapByCharacter(width - inset * 2));

    this.add([face, iconText, nameText]);
    scene.add.existing(this);
  }
}

/**
 * 中身の無い固定枠を示すカード。固定枠スロット（fixed_positions、SlotSystem.md 3節）は空でも位置を
 * 保つため、枠だけを破線で描いて「ここは空いている」と分かるようにする。
 */
export class EmptyCard extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number) {
    super(scene, x, y);

    const face = scene.add.graphics();
    drawBox(
      face,
      { x: 0, y: 0, width: metrics.px(SIZE.cardWidth), height: metrics.px(SIZE.cardHeight) },
      {
        fill: COLOR.cardFace,
        fillAlpha: 0.35,
        border: COLOR.cardBorder,
        borderWidth: Math.max(1, metrics.px(2)),
        radius: metrics.px(SIZE.radius),
        dashed: true,
      },
    );

    this.add(face);
    scene.add.existing(this);
  }
}
