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

  private readonly metrics: ScreenMetrics;

  /** 行の中の寸法（バーの左端・幅・高さ、増減欄の中心）。中身を差し替えても変わらない。 */
  private readonly barX: number;
  private readonly barWidth: number;
  private readonly barHeight: number;
  private readonly changeX: number;
  private readonly nameWidth: number;

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
    this.metrics = metrics;

    const changeWidth = metrics.px(CHANGE_WIDTH);
    this.barHeight = metrics.px(BAR_HEIGHT);
    this.nameWidth = metrics.px(nameWidthU);
    this.barX = this.nameWidth + metrics.px(NAME_GAP);
    this.barWidth = Math.max(0, width - this.barX - changeWidth - metrics.px(CHANGE_GAP));
    this.changeX = width - changeWidth / 2;

    this.build(content);
    scene.add.existing(this);
  }

  /**
   * 値と増減を今の状態へ書き換える。作り直さず中身だけ差し替えるのは、作り直すと画面の表示順が
   * 変わり、後から置かれた子ウィンドウの覆いより手前へ出てしまうため。
   */
  setContent(content: StatusContent): void {
    this.removeAll(true);
    this.build(content);
  }

  private build(content: StatusContent): void {
    const label = this.scene.add
      .text(0, this.barHeight / 2, content.name, {
        fontFamily: FONT_FAMILY,
        fontSize: `${this.metrics.fontPx(30)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.text),
      })
      .setOrigin(0, 0.5);
    // 名前欄に収まらない長い表示名は縮めて収める（はみ出すとバーに重なって読めなくなるため）。
    if (label.width > this.nameWidth) label.setScale(this.nameWidth / label.width);

    this.add([
      label,
      content.ratio !== undefined
        ? new ProgressBar(
            this.scene,
            this.metrics,
            this.barX,
            0,
            this.barWidth,
            this.barHeight,
            content.ratio,
          )
        : this.scene.add
            .text(this.barX, this.barHeight / 2, String(content.value), {
              fontFamily: FONT_FAMILY,
              fontSize: `${this.metrics.fontPx(30)}px`,
              color: cssColor(COLOR.text),
            })
            .setOrigin(0, 0.5),
    ]);

    if (content.change === undefined) return;

    const increased = content.change === 'increased';
    this.add(
      this.scene.add
        .text(this.changeX, this.barHeight / 2, increased ? '▲' : '▼', {
          fontFamily: FONT_FAMILY,
          fontSize: `${this.metrics.fontPx(CHANGE_SIZE)}px`,
          color: cssColor(increased ? COLOR.statusIncreased : COLOR.statusDecreased),
        })
        .setOrigin(0.5),
    );
  }
}
