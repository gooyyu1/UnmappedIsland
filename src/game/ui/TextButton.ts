import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import type Phaser from 'phaser';
import { noteOperation } from '../errorReport';
import { uiText } from '../../locale/uiTexts';
import { addLabel } from '../../ui/labels';
import type { BoxStyle } from '../../ui/shapes';
import { Button } from '../../ui/Button';
import type { HoldHandlers } from '../../ui/holdRepeat';
import { COLOR, SIZE } from '../looks/theme';

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
      noteOperation(uiText('log_button_tapped', { label }));
      onTap();
    },
    hold,
  );
  button.addCentered(addLabel(scene, metrics, 0, 0, label, { size: 26, bold: true, color: style.textColor }));
  return button;
}
