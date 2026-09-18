import Phaser from 'phaser';
import type { Rect } from './Rect';
import type { BoxStyle } from './shapes';
import { drawBox } from './shapes';
import { onPressRelease } from './tap';
import type { HoldHandlers } from './holdRepeat';
import { Hold } from './holdRepeat';

/**
 * 押下中の沈み込み表現。**黒をこの濃さで重ねる**。
 *
 * ボタン自体を透かす形は使わない——**下地が明るいと逆に明るく見える**（本のページの上に置いた
 * くすんだ色のボタンでは、透かすほど紙の色が透けて浮き上がる）。重ねる向きを暗い側へ固定すれば、
 * 地の色にも下地にもよらず「沈んだ」と読める。**色を呼び出し側から受け取らないのもこのため**で、
 * 選べるようにすると、固定したはずの向きが呼び出し側ごとに戻る（shapes.drawBoxの落ち影と同じ）。
 */
const PRESSED_SHADE_COLOR = 0x000000;
const PRESSED_SHADE_ALPHA = 0.18;

/** 中央へ置ける中身（位置と原点を持つ表示物、Button.addCentered）。 */
type CenteredContent = Phaser.GameObjects.GameObject &
  Phaser.GameObjects.Components.Transform &
  Phaser.GameObjects.Components.Origin;

/**
 * 角丸矩形の押しボタン。中身（アイコン・ラベル）は呼び出し側がaddContentで足す。
 *
 * 子の座標はボタン左上を原点(0,0)とするローカル座標で指定する。
 */
export class Button extends Phaser.GameObjects.Container {
  private readonly boxWidth: number;
  private readonly boxHeight: number;

  private readonly background: Phaser.GameObjects.Graphics;
  /** 押下中だけ見せる暗い覆い。中身より手前へ出すので、押すたびに最前面へ持ち上げる。 */
  private readonly shade: Phaser.GameObjects.Graphics;

  /** 長押しの計時（Hold）。長押しになった押下は、離しても押されたことにしない。 */
  private readonly holdTimer: Hold;

  constructor(scene: Phaser.Scene, rect: Rect, style: BoxStyle, onTap?: () => void, hold?: HoldHandlers) {
    super(scene, rect.x, rect.y);
    this.boxWidth = rect.width;
    this.boxHeight = rect.height;

    this.background = scene.add.graphics();
    this.add(this.background);
    this.setBoxStyle(style);

    this.shade = scene.add.graphics();
    drawBox(
      this.shade,
      { x: 0, y: 0, width: rect.width, height: rect.height },
      {
        fillColor: PRESSED_SHADE_COLOR,
        radius: style.radius,
      },
    );
    this.shade.setAlpha(PRESSED_SHADE_ALPHA).setVisible(false);
    this.add(this.shade);

    // Containerのdisplay originはwidth/heightの半分に固定されている（読み取り専用）。
    // Phaserのヒット判定はローカル座標へdisplay originを足すため、setSizeするとヒット領域が
    // 半分ずれる。子を左上原点(0,0)で並べるこの実装では、サイズを設定しない。
    this.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, rect.width, rect.height),
      Phaser.Geom.Rectangle.Contains,
    );
    this.holdTimer = new Hold(scene);
    onPressRelease(this, {
      onPress: () => {
        this.shade.setVisible(true);
        this.bringToTop(this.shade);
        this.holdTimer.begin(hold);
      },
      onCancel: () => {
        this.shade.setVisible(false);
        this.holdTimer.end();
      },
      onRelease: () => {
        this.shade.setVisible(false);
        if (!this.holdTimer.end()) onTap?.();
      },
    });
    // 押している最中に画面が作り直されることがある。計時を止めないと、消えたボタンの長押しが後から始まる。
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.holdTimer.end());

    scene.add.existing(this);
  }

  /** 塗り・枠線を描き直す。フィルターボタンの選択状態のように、見た目だけが変わる切り替えに使う。 */
  setBoxStyle(style: BoxStyle): void {
    this.background.clear();
    drawBox(this.background, { x: 0, y: 0, width: this.boxWidth, height: this.boxHeight }, style);
  }

  /** ボタンの中身を足す。子はボタン左上を原点(0,0)とするローカル座標で置く。 */
  addContent(...children: Phaser.GameObjects.GameObject[]): void {
    this.add(children);
  }

  /**
   * 中身を1つ、ボタンの中央へ置く。**中央がどこかはボタンが知っている**ので、呼び出し側が
   * 寸法から割り出さない。
   */
  addCentered(child: CenteredContent): void {
    child.setPosition(this.boxWidth / 2, this.boxHeight / 2);
    child.setOrigin(0.5);
    this.add(child);
  }
}
