import Phaser from 'phaser';
import type { ScreenMetrics } from '../layout/ScreenMetrics';
import { drawBox } from './shapes';
import { COLOR } from './theme';

/**
 * 横方向の進捗バー（枠付きのトラックと、左詰めの塗り）。ステータスバー・探索ウィンドウのように
 * 「全体に対する割合」を見せる場所で共用する。
 *
 * 寸法はピクセルで受け取り、角の丸みだけを高さから決める（高さを変えても丸みの見え方が揃うため）。
 */
export class ProgressBar extends Phaser.GameObjects.Container {
  constructor(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    x: number,
    y: number,
    width: number,
    height: number,
    ratio: number,
  ) {
    super(scene, x, y);

    const radius = height / 4;
    const bar = scene.add.graphics();
    drawBox(bar, { x: 0, y: 0, width, height }, { fill: COLOR.statusBarTrack, radius });

    const fillWidth = width * Phaser.Math.Clamp(ratio, 0, 1);
    if (fillWidth > 0) {
      drawBox(bar, { x: 0, y: 0, width: fillWidth, height }, { fill: COLOR.statusBarFill, radius });
    }
    drawBox(
      bar,
      { x: 0, y: 0, width, height },
      { border: COLOR.statusBarTrackBorder, borderWidth: Math.max(1, metrics.px(2)), radius },
    );

    this.add(bar);
    scene.add.existing(this);
  }
}
