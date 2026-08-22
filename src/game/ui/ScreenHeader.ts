import type Phaser from 'phaser';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { Button } from './Button';
import { addLabel } from '../../ui/labels';
import { addPanel } from '../../ui/shapes';
import { COLOR, SIZE } from '../looks/theme';

/** 戻るボタンの一辺と、バーの上下・左右パディング（StartScreen_Mock.htmlの.screen-header）。 */
const BUTTON_SIZE = 72;
const VERTICAL_PADDING = 20;
const HORIZONTAL_PADDING = 24;

/** 「もどる」ボタンと画面名を並べた上部のバー。スロット選択画面・新規ゲーム作成画面で共有する。 */
export class ScreenHeader {
  static height(metrics: ScreenMetrics): number {
    return metrics.px(BUTTON_SIZE + VERTICAL_PADDING * 2);
  }

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, width: number, title: string, onBack: () => void) {
    const height = ScreenHeader.height(metrics);
    addPanel(scene, { x: 0, y: 0, width, height }, COLOR.headerBar);

    const buttonSize = metrics.px(BUTTON_SIZE);
    const left = metrics.px(HORIZONTAL_PADDING);
    const back = new Button(
      scene,
      { x: left, y: metrics.px(VERTICAL_PADDING), width: buttonSize, height: buttonSize },
      {
        fill: COLOR.button,
        border: COLOR.buttonBorder,
        borderWidth: metrics.linePx(2),
        radius: metrics.px(SIZE.radius),
      },
      onBack,
    );
    back.addContent(
      addLabel(scene, metrics, buttonSize / 2, buttonSize / 2, '←', { size: 32 }).setOrigin(0.5),
    );

    addLabel(scene, metrics, left + buttonSize + metrics.px(16), height / 2, title, {
      size: 30,
      bold: true,
    }).setOrigin(0, 0.5);
  }
}
