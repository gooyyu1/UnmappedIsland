import Phaser from 'phaser';
import type { Rect } from '../layout/ScreenMetrics';
import type { BoxStyle } from './shapes';
import { drawBox } from './shapes';

/** 押下中の沈み込み表現。実装が絵を持たないため、透過で押されたことを示す。 */
const PRESSED_ALPHA = 0.6;

/**
 * 角丸矩形の押しボタン。中身（アイコン・ラベル）は呼び出し側がaddContentで足す。
 *
 * 子の座標はボタン左上を原点(0,0)とするローカル座標で指定する。
 */
export class Button extends Phaser.GameObjects.Container {
  readonly boxWidth: number;
  readonly boxHeight: number;

  private readonly background: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, rect: Rect, style: BoxStyle, onTap?: () => void) {
    super(scene, rect.x, rect.y);
    this.boxWidth = rect.width;
    this.boxHeight = rect.height;

    this.background = scene.add.graphics();
    this.add(this.background);
    this.setBoxStyle(style);

    // Containerのdisplay originはwidth/heightの半分に固定されている（読み取り専用）。
    // Phaserのヒット判定はローカル座標へdisplay originを足すため、setSizeするとヒット領域が
    // 半分ずれる。子を左上原点(0,0)で並べるこの実装では、サイズを設定しない。
    this.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, rect.width, rect.height),
      Phaser.Geom.Rectangle.Contains,
    );
    this.on('pointerdown', () => this.setAlpha(PRESSED_ALPHA));
    this.on('pointerout', () => this.setAlpha(1));
    this.on('pointerup', () => {
      this.setAlpha(1);
      onTap?.();
    });

    scene.add.existing(this);
  }

  /** 塗り・枠線を描き直す。フィルターボタンの選択状態のように、見た目だけが変わる切り替えに使う。 */
  setBoxStyle(style: BoxStyle): void {
    this.background.clear();
    drawBox(this.background, { x: 0, y: 0, width: this.boxWidth, height: this.boxHeight }, style);
  }

  /** ボタンの中身を足す。 */
  addContent(...children: Phaser.GameObjects.GameObject[]): void {
    this.add(children);
  }
}
