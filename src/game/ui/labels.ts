import type Phaser from 'phaser';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { COLOR, FONT_FAMILY, cssColor } from '../looks/theme';

/** 文字の見た目。sizeはu単位のフォントサイズ。 */
export interface LabelStyle {
  readonly size: number;
  readonly color?: number;
  readonly bold?: boolean;
}

/** 画面共通のフォント設定でテキストを置く。原点の指定は呼び出し側で行う。 */
export function addLabel(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  x: number,
  y: number,
  content: string,
  style: LabelStyle,
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, content, {
    fontFamily: FONT_FAMILY,
    fontSize: `${metrics.fontPx(style.size)}px`,
    fontStyle: style.bold === true ? 'bold' : '',
    color: cssColor(style.color ?? COLOR.text),
  });
}
