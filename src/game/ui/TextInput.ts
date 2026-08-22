import type Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { cssColor } from '../../util/cssColor';
import { COLOR, FONT_FAMILY, SIZE } from '../looks/theme';

export interface TextInputOptions {
  readonly value: string;
  readonly placeholder: string;
  readonly maxLength: number;
  /** 数字だけを入力する欄。モバイルでテンキーが出るようにする。 */
  readonly numeric?: boolean;
  readonly onChange: (value: string) => void;
}

/**
 * 文字入力欄。Phaserのキャンバス上には文字入力の仕組みが無いため、DOM要素を重ねて実現する
 * （モバイルのソフトキーボードもDOMの入力欄でなければ出ない）。
 *
 * これを使うにはゲーム設定で `dom: { createContainer: true }` が必要（main.ts参照）。
 */
export class TextInput {
  private readonly input: HTMLInputElement;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, rect: Rect, options: TextInputOptions) {
    const style = [
      `box-sizing: border-box`,
      `width: ${rect.width}px`,
      `height: ${rect.height}px`,
      `padding: 0 ${metrics.px(16)}px`,
      `border: ${metrics.linePx(2)}px solid ${cssColor(COLOR.buttonBorder)}`,
      `border-radius: ${metrics.px(SIZE.radius)}px`,
      `background: ${cssColor(COLOR.cardFace)}`,
      `color: ${cssColor(COLOR.text)}`,
      `font-family: ${FONT_FAMILY}`,
      `font-size: ${metrics.fontPx(28)}px`,
    ].join('; ');

    const element = scene.add.dom(rect.x, rect.y, 'input', style).setOrigin(0, 0);
    this.input = element.node as HTMLInputElement;
    this.input.type = 'text';
    this.input.value = options.value;
    this.input.placeholder = options.placeholder;
    this.input.maxLength = options.maxLength;
    if (options.numeric === true) this.input.inputMode = 'numeric';
    this.input.addEventListener('input', () => options.onChange(this.input.value));
  }

  /** ランダム入力ボタンで値を埋める。入力欄は編集可能なままにする（StartScreen.md 設計原則）。 */
  setValue(value: string): void {
    this.input.value = value;
  }
}
