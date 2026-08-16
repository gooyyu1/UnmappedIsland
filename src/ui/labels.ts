import type Phaser from 'phaser';
import { cssColor } from '../util/cssColor';

/** 文字の見た目。sizeはu単位のフォントサイズ。 */
export interface LabelStyle {
  readonly size: number;
  readonly color?: number;
  readonly bold?: boolean;
}

/** u単位の大きさをピクセルへ直せる相手（ScreenMetrics）。 */
export interface FontScale {
  fontPx(units: number): number;
}

/** 書体と文字色の既定。 */
export interface LabelDefaults {
  readonly fontFamily: string;
  readonly color: number;
}

/**
 * 色や書体を指定しなかったラベルが使う値。**意匠は起動時に外から入れる**（setLabelDefaults）。
 * 入れなくても読める値を持つので、意匠を持たない画面でも文字が消えることはない。
 */
let defaults: LabelDefaults = { fontFamily: 'sans-serif', color: 0x000000 };

export function setLabelDefaults(next: LabelDefaults): void {
  defaults = next;
}

/** 画面共通のフォント設定でテキストを置く。原点の指定は呼び出し側で行う。 */
export function addLabel(
  scene: Phaser.Scene,
  metrics: FontScale,
  x: number,
  y: number,
  content: string,
  style: LabelStyle,
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, content, {
    fontFamily: defaults.fontFamily,
    fontSize: `${metrics.fontPx(style.size)}px`,
    fontStyle: style.bold === true ? 'bold' : '',
    color: cssColor(style.color ?? defaults.color),
  });
}
