import Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { noteOperation } from '../errorReport';
import { addLabel } from '../../ui/labels';
import type { BoxStyle } from '../../ui/shapes';
import { drawBox } from '../../ui/shapes';
import { onPressRelease } from '../../ui/tap';
import { COLOR, SIZE } from '../looks/theme';
import { HOLD_MS } from '../../ui/holdRepeat';

/**
 * 押下中の沈み込み表現。**暗い覆いを重ねる**（黒のこの濃さ）。
 *
 * かつてはボタン自体を透かしていたが、**下地が明るいと逆に明るく見える**。本のページの上に置いた
 * くすんだ色のボタンでは、透かすほど紙の色が透けて浮き上がって見えた。重ねる向きを暗い側へ
 * 固定すれば、地の色にも下地にもよらず「沈んだ」と読める。
 */
const PRESSED_SHADE = 0.18;

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
        fillColor: COLOR.pressedShade,
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

/** ラベル1つを中央に置いたボタンの見た目。枠線・文字色は省略すると画面共通の色になる。 */
export interface TextButtonStyle {
  readonly fill: number;
  readonly border?: number;
  readonly textColor?: number;
}

/**
 * 文字のボタンの台紙（addTextButtonが敷くのと同じ形）。**選んだ/選んでいないで塗り替える側も
 * これを通す**——生のBoxStyleを組み直すと、縁の色も角の丸みも呼び出し側ごとに散る。
 */
export function textButtonBoxStyle(metrics: ScreenMetrics, style: TextButtonStyle): BoxStyle {
  return {
    fillColor: style.fill,
    borderColor: style.border ?? COLOR.buttonBorder,
    borderWidth: metrics.linePx(2),
    radius: metrics.px(SIZE.radius),
  };
}

/** 選ばれているかで塗りを変える、タブの台紙（子ウィンドウのタブ・プロパティのカテゴリ）。 */
function tabBoxStyle(metrics: ScreenMetrics, active: boolean): BoxStyle {
  return textButtonBoxStyle(metrics, { fill: active ? COLOR.buttonActive : COLOR.button });
}

/**
 * ちょうど1つが選ばれているボタンの並び（子ウィンドウのタブ、プロパティのカテゴリ）。
 *
 * **選び直したときに並び全部を塗り替えるのはここの仕事**で、呼び出し側は「何番目を選ぶか」を
 * 言うだけ。どれが選ばれているかは呼び出し側が持つ——タブの意味（開いている面・並べる行）は
 * 並びの外にあり、ここは見た目だけを揃える。
 */
export class TabButtons {
  private readonly metrics: ScreenMetrics;
  private readonly buttons: Button[] = [];

  constructor(metrics: ScreenMetrics) {
    this.metrics = metrics;
  }

  /** 並びの末尾へ足す。並べ方（位置と幅）は呼び出し側が決める。 */
  add(button: Button): void {
    this.buttons.push(button);
  }

  /** 何番目を選ぶか。**選ばれた1つだけ**が選択中の見た目になる。 */
  select(index: number): void {
    this.buttons.forEach((button, i) => button.setBoxStyle(tabBoxStyle(this.metrics, i === index)));
  }
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
    textButtonBoxStyle(metrics, style),
    () => {
      // ラベルがそのまま「何を押したか」になる（errorReport参照）。絵だけのボタンは押した結果の側で控える。
      noteOperation(`ボタンを押した: ${label}`);
      onTap();
    },
    hold,
  );
  button.addCentered(addLabel(scene, metrics, 0, 0, label, { size: 26, bold: true, color: style.textColor }));
  return button;
}
