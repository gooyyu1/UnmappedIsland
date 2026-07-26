import Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import { addLabel } from './labels';
import type { BoxStyle } from './shapes';
import { drawBox } from './shapes';
import { onPressRelease } from './tap';
import { COLOR, SIZE } from './theme';

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
    onPressRelease(this, {
      onPress: () => this.setAlpha(PRESSED_ALPHA),
      onCancel: () => this.setAlpha(1),
      onRelease: () => {
        this.setAlpha(1);
        onTap?.();
      },
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

/** ラベル1つを中央に置いたボタンの見た目。枠線・文字色は省略すると画面共通の色になる。 */
export interface TextButtonStyle {
  readonly fill: number;
  readonly border?: number;
  readonly textColor?: number;
}

/** ラベルを中央に置いた押しボタン。ダイアログ・子ウィンドウの操作ボタンはこの形で揃える。 */
export function addTextButton(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  rect: Rect,
  label: string,
  style: TextButtonStyle,
  onTap: () => void,
): Button {
  const button = new Button(
    scene,
    rect,
    {
      fill: style.fill,
      border: style.border ?? COLOR.buttonBorder,
      borderWidth: Math.max(1, metrics.px(2)),
      radius: metrics.px(SIZE.radius),
    },
    onTap,
  );
  button.addContent(
    addLabel(scene, metrics, rect.width / 2, rect.height / 2, label, {
      size: 26,
      bold: true,
      color: style.textColor,
    }).setOrigin(0.5),
  );
  return button;
}
