import Phaser from 'phaser';
import type { ScreenMetrics } from '../layout/ScreenMetrics';
import { ProgressBar } from './ProgressBar';
import { COLOR, FONT_FAMILY, cssColor } from './theme';

/** 名前欄の幅とバーの高さ（ScreenLayout_Mock.htmlの.status-name/.status-bar-container）。 */
const NAME_WIDTH = 140;
const BAR_HEIGHT = 36;

/** 名前とバーの間隔。 */
const NAME_GAP = 12;

/** ステータス1件分の表示内容（名前は識別子ではなく表示名）。 */
export interface StatusContent {
  readonly name: string;

  /** 実効値。ratioを持たないプロパティを数値で見せるために使う。 */
  readonly value: number;

  /** 満たされ具合（0〜1）。rangeを持たず割合を定義できないプロパティはundefined。 */
  readonly ratio: number | undefined;
}

/**
 * ステータス1件分の「名前＋バー」。行の高さはバーの高さと等しい。
 * 割合を定義できないプロパティは、バーの代わりに実効値そのものを出す。
 * 名前欄の幅（nameWidthU）は、長い表示名が並ぶプロパティウィンドウだけが広げる。
 */
export class StatusBar extends Phaser.GameObjects.Container {
  static height(metrics: ScreenMetrics): number {
    return metrics.px(BAR_HEIGHT);
  }

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
    const barWidth = Math.max(0, width - barX);

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

    this.add([
      label,
      content.ratio !== undefined
        ? new ProgressBar(scene, metrics, barX, 0, barWidth, height, content.ratio)
        : scene.add
            .text(barX, height / 2, String(content.value), {
              fontFamily: FONT_FAMILY,
              fontSize: `${metrics.fontPx(30)}px`,
              color: cssColor(COLOR.text),
            })
            .setOrigin(0, 0.5),
    ]);
    scene.add.existing(this);
  }
}
