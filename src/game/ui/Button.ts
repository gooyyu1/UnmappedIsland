import Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import { addLabel } from './labels';
import type { BoxStyle } from './shapes';
import { drawBox } from './shapes';
import { onPressRelease } from './tap';
import { COLOR, SIZE } from './theme';

/**
 * スロットボタン（地図・装備・怪我・レシピ）の地に敷く紙のテクスチャキー。
 * 実体は `src/assets/slot_button_paper.png` で、BootSceneがボタン1つぶんずつの
 * スプライトシートとして読む。
 *
 * **カードの枠とは別の絵を持つ。** 同じ紙から切り出してはいるが（`recipes/slot_button_paper.json`）、
 * それは生成の話で、実行時に同じテクスチャを共有はしない（DesignNotes.md）。
 */
export const SLOT_BUTTON_PAPER_TEXTURE = 'slotButtonPaper';

/** その1枚の寸法（tools/comfyui/button_paper.py の TILE_WIDTH / TILE_HEIGHT と揃える）。 */
export const SLOT_BUTTON_PAPER_FRAME = { width: 336, height: 168 };

/**
 * 押下中の沈み込み表現。**暗い覆いを重ねる**（黒のこの濃さ）。
 *
 * かつてはボタン自体を透かしていたが、**下地が明るいと逆に明るく見える**。本のページの上に置いた
 * くすんだ色のボタンでは、透かすほど紙の色が透けて浮き上がって見えた。重ねる向きを暗い側へ
 * 固定すれば、地の色にも下地にもよらず「沈んだ」と読める。
 */
const PRESSED_SHADE = 0.18;

/** 長押しと見なすまでの時間（カードの端を押し続けたときの1枚目と同じ）。 */
const HOLD_MS = 400;

/**
 * 長押しの受け口。押している間だけ説明を見せる用途なので、始まりと終わりの両方を受け取る。
 * 長押しになった押下は「押された」ことにならず、指を離してもonTapは呼ばれない。
 */
export interface HoldHandlers {
  readonly onStart: () => void;
  readonly onEnd: () => void;
  /** 長押しと見なすまでの時間。0なら押した瞬間に始まる（押せないボタンが理由をすぐ出すため）。 */
  readonly delayMs?: number;
}

/**
 * 角丸矩形の押しボタン。中身（アイコン・ラベル）は呼び出し側がaddContentで足す。
 *
 * 子の座標はボタン左上を原点(0,0)とするローカル座標で指定する。
 */
export class Button extends Phaser.GameObjects.Container {
  readonly boxWidth: number;
  readonly boxHeight: number;

  private readonly background: Phaser.GameObjects.Graphics;
  /** 押下中だけ見せる暗い覆い。中身より手前へ出すので、押すたびに最前面へ持ち上げる。 */
  private readonly shade: Phaser.GameObjects.Graphics;

  /** 長押しの計時と、既に長押しになったか（なったなら離しても押されたことにしない）。 */
  private holdTimer: Phaser.Time.TimerEvent | undefined;
  private holding = false;

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
        fill: COLOR.pressedShade,
        radius: style.radius,
      },
    );
    this.shade.setAlpha(PRESSED_SHADE).setVisible(false);
    this.add(this.shade);

    // Containerのdisplay originはwidth/heightの半分に固定されている（読み取り専用）。
    // Phaserのヒット判定はローカル座標へdisplay originを足すため、setSizeするとヒット領域が
    // 半分ずれる。子を左上原点(0,0)で並べるこの実装では、サイズを設定しない。
    this.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, rect.width, rect.height),
      Phaser.Geom.Rectangle.Contains,
    );
    onPressRelease(this, {
      onPress: () => {
        this.shade.setVisible(true);
        this.bringToTop(this.shade);
        if (hold !== undefined) {
          this.holdTimer = scene.time.delayedCall(hold.delayMs ?? HOLD_MS, () => {
            this.holding = true;
            hold.onStart();
          });
        }
      },
      onCancel: () => {
        this.shade.setVisible(false);
        this.endHold(hold);
      },
      onRelease: () => {
        this.shade.setVisible(false);
        const held = this.holding;
        this.endHold(hold);
        if (!held) onTap?.();
      },
    });
    // 押している最中に画面が作り直されることがある。計時を止めないと、消えたボタンの長押しが後から始まる。
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.endHold(hold));

    scene.add.existing(this);
  }

  private endHold(hold: HoldHandlers | undefined): void {
    this.holdTimer?.remove();
    this.holdTimer = undefined;
    if (!this.holding) return;

    this.holding = false;
    hold?.onEnd();
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
  hold?: HoldHandlers,
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
    hold,
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
