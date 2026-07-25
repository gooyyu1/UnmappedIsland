import Phaser from 'phaser';
import type { ScreenMetrics } from '../layout/ScreenMetrics';
import { COLOR, FONT_FAMILY, cssColor } from './theme';
import { drawBox } from './shapes';

/** 名前欄の幅とバーの高さ（ScreenLayout_Mock.htmlの.status-name/.status-bar-container）。 */
const NAME_WIDTH = 140;
const BAR_HEIGHT = 36;

/** ステータス1件分の「名前＋バー」。行の高さはバーの高さと等しい。 */
export class StatusBar extends Phaser.GameObjects.Container {
  static height(metrics: ScreenMetrics): number {
    return metrics.px(BAR_HEIGHT);
  }

  constructor(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    x: number,
    y: number,
    width: number,
    name: string,
    ratio: number,
  ) {
    super(scene, x, y);

    const height = metrics.px(BAR_HEIGHT);
    const nameWidth = metrics.px(NAME_WIDTH);
    const barX = nameWidth + metrics.px(12);
    const barWidth = Math.max(0, width - barX);

    const label = scene.add
      .text(0, height / 2, name, {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(30)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.text),
      })
      .setOrigin(0, 0.5);

    const bar = scene.add.graphics();
    const radius = metrics.px(8);
    drawBox(bar, { x: barX, y: 0, width: barWidth, height }, { fill: COLOR.statusBarTrack, radius });
    const fillWidth = barWidth * Phaser.Math.Clamp(ratio, 0, 1);
    if (fillWidth > 0) {
      drawBox(bar, { x: barX, y: 0, width: fillWidth, height }, { fill: COLOR.statusBarFill, radius });
    }
    drawBox(
      bar,
      { x: barX, y: 0, width: barWidth, height },
      { border: COLOR.statusBarTrackBorder, borderWidth: Math.max(1, metrics.px(2)), radius },
    );

    this.add([label, bar]);
    scene.add.existing(this);
  }
}
