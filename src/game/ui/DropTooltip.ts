import Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import { COLOR, FONT_FAMILY, SIZE, cssColor } from './theme';
import { drawBox } from './shapes';
import { wrapByCharacter } from './textLayout';

/** 内側の余白と、行間・カードとの間隔（u単位）。 */
const PADDING = 24;
const LINE_GAP = 10;
const CARD_GAP = 16;

/** 文字の大きさ（u単位）。指で操作するゲームなので、カードの名前より大きく取る。 */
const TITLE_SIZE = 46;
const BODY_SIZE = 34;

/** 吹き出しの最大幅（u単位）。画面が狭ければそちらに合わせて縮む。 */
const MAX_WIDTH = 700;

/**
 * ドラッグ中のカードを重ねたときに何が起きるかを出す吹き出し。
 *
 * 置き場所は掴んでいるカードの真上。指はカードの中心にあるので、上へ逃がせば隠れない。上に入り切らない
 * 場合だけ下へ回す（画面の上端に近いレーンで掴んだとき）。
 *
 * 中身の作り直しは文言が変わったときだけ行う。ポインタが動くたびにTextを作り直すと、そのたびに
 * テクスチャが焼き直されて重いため。
 */
export class DropTooltip {
  private readonly scene: Phaser.Scene;
  private readonly metrics: ScreenMetrics;
  private readonly container: Phaser.GameObjects.Container;

  /** 今出している文言。同じなら作り直さない。 */
  private shown: string | undefined;

  /** 組み立て済みの吹き出しの大きさ（置き場所の計算に使う）。 */
  private width = 0;
  private height = 0;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics) {
    this.scene = scene;
    this.metrics = metrics;
    this.container = scene.add.container(0, 0).setVisible(false);
  }

  /** 掴んでいるカードの矩形を基準に、その上（入らなければ下）へ出す。 */
  show(title: string, body: string | undefined, card: Rect): void {
    const key = `${title}\n${body ?? ''}`;
    if (key !== this.shown) {
      this.shown = key;
      this.build(title, body);
    }

    const gap = this.metrics.px(CARD_GAP);
    const margin = this.metrics.px(SIZE.margin * 2);
    const above = card.y - gap - this.height;
    const y = above >= margin ? above : card.y + card.height + gap;

    this.container.setPosition(
      Phaser.Math.Clamp(
        card.x + (card.width - this.width) / 2,
        margin,
        Math.max(margin, this.metrics.width - margin - this.width),
      ),
      Phaser.Math.Clamp(y, margin, Math.max(margin, this.metrics.height - margin - this.height)),
    );
    this.container.setVisible(true);
  }

  hide(): void {
    this.container.setVisible(false);
    this.shown = undefined;
  }

  destroy(): void {
    this.container.destroy();
  }

  private build(title: string, body: string | undefined): void {
    this.container.removeAll(true);

    const padding = this.metrics.px(PADDING);
    const maxTextWidth =
      Math.min(this.metrics.px(MAX_WIDTH), this.metrics.width - this.metrics.px(SIZE.margin * 4)) -
      padding * 2;

    const titleText = this.addText(title, TITLE_SIZE, true, maxTextWidth);
    const bodyText = body === undefined ? undefined : this.addText(body, BODY_SIZE, false, maxTextWidth);

    const lineGap = this.metrics.px(LINE_GAP);
    this.width = Math.max(titleText.width, bodyText?.width ?? 0) + padding * 2;
    this.height = titleText.height + (bodyText === undefined ? 0 : lineGap + bodyText.height) + padding * 2;

    const face = this.scene.add.graphics();
    drawBox(
      face,
      { x: 0, y: 0, width: this.width, height: this.height },
      {
        fill: COLOR.cardEdgeOverlay,
        fillAlpha: 0.94,
        border: COLOR.textOnDark,
        borderWidth: Math.max(1, this.metrics.px(2)),
        radius: this.metrics.px(SIZE.radius),
      },
    );

    titleText.setPosition(padding, padding);
    bodyText?.setPosition(padding, padding + titleText.height + lineGap);
    this.container.add([face, titleText, ...(bodyText === undefined ? [] : [bodyText])]);
  }

  private addText(value: string, size: number, bold: boolean, maxWidth: number): Phaser.GameObjects.Text {
    const text = this.scene.add.text(0, 0, value, {
      fontFamily: FONT_FAMILY,
      fontSize: `${this.metrics.fontPx(size)}px`,
      fontStyle: bold ? 'bold' : undefined,
      color: cssColor(COLOR.textOnDark),
    });
    text.setLineSpacing(this.metrics.px(4));
    text.setWordWrapCallback(wrapByCharacter(maxWidth));
    return text;
  }
}
