import Phaser from 'phaser';
import type { ScreenMetrics } from '../layout/ScreenMetrics';
import { ProgressBar } from './ProgressBar';
import { COLOR, FONT_FAMILY, cssColor } from './theme';

/** 名前欄の幅とバーの高さ（ScreenLayout_Mock.htmlの.status-name/.status-bar-container）。 */
const NAME_WIDTH = 140;
const BAR_HEIGHT = 36;

/** 名前とバーの間隔。 */
const NAME_GAP = 12;

/** 増減の記号を出す欄の幅と、バーとの間隔。記号が出ていない間もバーは伸ばさず、幅を空けておく。 */
const CHANGE_WIDTH = 40;
const CHANGE_GAP = 8;

/** 増減の記号の大きさ。 */
const CHANGE_SIZE = 34;

/** 直前の行動でその値が増えたか減ったか。変わらなかった項目には記号を出さない。 */
export type StatusChange = 'increased' | 'decreased';

/** ステータス1件分の表示内容（名前は識別子ではなく表示名）。 */
export interface StatusContent {
  readonly name: string;

  /** 実効値。ratioを持たないプロパティを数値で見せるために使う。 */
  readonly value: number;

  /** 満たされ具合（0〜1）。rangeを持たず割合を定義できないプロパティはundefined。 */
  readonly ratio: number | undefined;

  /** 直前の行動での増減。undefinedなら記号を出さない。 */
  readonly change?: StatusChange;
}

/**
 * ステータス1件分の「名前＋バー＋増減」。行の高さはバーの高さと等しい。
 * 割合を定義できないプロパティは、バーの代わりに実効値そのものを出す。
 * 名前欄の幅（nameWidthU）は、長い表示名が並ぶプロパティウィンドウだけが広げる。
 */
export class StatusBar extends Phaser.GameObjects.Container {
  static height(metrics: ScreenMetrics): number {
    return metrics.px(BAR_HEIGHT);
  }

  /** 割合を持つ項目のバー。持たない項目（valueText）はどちらか一方だけを作る。 */
  private readonly bar: ProgressBar | undefined;
  private readonly valueText: Phaser.GameObjects.Text | undefined;

  /** 増減の記号。出ていないときは空文字にする（作り直すと表示順が変わるため消さない）。 */
  private readonly changeMark: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    x: number,
    y: number,
    width: number,
    content: StatusContent,
    nameWidthU: number = NAME_WIDTH,
  ) {
    super(scene, x, y);

    const height = metrics.px(BAR_HEIGHT);
    const nameWidth = metrics.px(nameWidthU);
    const barX = nameWidth + metrics.px(NAME_GAP);
    const changeWidth = metrics.px(CHANGE_WIDTH);
    const barWidth = Math.max(0, width - barX - changeWidth - metrics.px(CHANGE_GAP));

    const label = scene.add
      .text(0, height / 2, content.name, {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(30)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.text),
      })
      .setOrigin(0, 0.5);
    // 名前欄に収まらない長い表示名は縮めて収める（はみ出すとバーに重なって読めなくなるため）。
    if (label.width > nameWidth) label.setScale(nameWidth / label.width);
    this.add(label);

    if (content.ratio !== undefined) {
      this.bar = new ProgressBar(scene, metrics, barX, 0, barWidth, height, content.ratio);
      this.add(this.bar);
    } else {
      this.valueText = scene.add
        .text(barX, height / 2, String(content.value), {
          fontFamily: FONT_FAMILY,
          fontSize: `${metrics.fontPx(30)}px`,
          color: cssColor(COLOR.text),
        })
        .setOrigin(0, 0.5);
      this.add(this.valueText);
    }

    this.changeMark = scene.add
      .text(width - changeWidth / 2, height / 2, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(CHANGE_SIZE)}px`,
      })
      .setOrigin(0.5);
    this.add(this.changeMark);
    this.showChange(content.change);

    scene.add.existing(this);
  }

  /**
   * 値と増減を今の状態へ書き換える。作り直さず中身だけ差し替えるのは、作り直すと画面の表示順が
   * 変わって子ウィンドウの覆いより手前へ出てしまうことと、バーが減る様子（ProgressBar.setRatio）を
   * 見せている途中で捨てないため。
   */
  setContent(content: StatusContent): void {
    if (content.ratio !== undefined) this.bar?.setRatio(content.ratio);
    this.valueText?.setText(String(content.value));
    this.showChange(content.change);
  }

  private showChange(change: StatusChange | undefined): void {
    if (change === undefined) {
      this.changeMark.setText('');
      return;
    }

    const increased = change === 'increased';
    this.changeMark
      .setText(increased ? '▲' : '▼')
      .setColor(cssColor(increased ? COLOR.statusIncreased : COLOR.statusDecreased));
  }
}
