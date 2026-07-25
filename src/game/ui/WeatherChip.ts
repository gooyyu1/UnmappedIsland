import Phaser from 'phaser';
import type { ScreenMetrics } from '../layout/ScreenMetrics';
import { COLOR, FONT_FAMILY, SIZE, cssColor } from './theme';
import { drawBox } from './shapes';

/** 左右の余白（ScreenLayout_Mock.htmlの.weather-chipのpadding）。 */
const HORIZONTAL_PADDING = 24;

/** 天候を表す丸みの強いチップ。高さはアイコンボタンと同じ88u。 */
export class WeatherChip extends Phaser.GameObjects.Container {
  static height(metrics: ScreenMetrics): number {
    return metrics.px(SIZE.iconButton);
  }

  readonly contentWidth: number;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number, content: string) {
    super(scene, x, y);

    const height = metrics.px(SIZE.iconButton);
    const label = scene.add
      .text(0, height / 2, content, {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(36)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.text),
      })
      .setOrigin(0, 0.5);

    this.contentWidth = label.width + metrics.px(HORIZONTAL_PADDING) * 2;
    label.x = metrics.px(HORIZONTAL_PADDING);

    const chip = scene.add.graphics();
    drawBox(
      chip,
      { x: 0, y: 0, width: this.contentWidth, height },
      {
        fill: COLOR.weatherChip,
        border: COLOR.buttonBorder,
        borderWidth: Math.max(1, metrics.px(2)),
        radius: height / 2,
      },
    );

    this.add([chip, label]);
    scene.add.existing(this);
  }
}
