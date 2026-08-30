import Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { COLOR, SIZE } from '../looks/theme';
import { SCREEN_DEPTH } from '../looks/screenDepth';
import { drawBox } from '../../ui/shapes';
import { addLabel } from '../../ui/labels';
import { uiText } from '../../locale/uiTexts';
import { timeCostLine } from '../looks/timeTexts';

/** 内側の余白と、行間・カードとの間隔（u単位）。 */
const PADDING = 24;
const LINE_GAP = 10;

/** 1つの文の中の行間（折り返した行どうし）。行と行の間隔（LINE_GAP）より狭い。 */
const TEXT_LINE_GAP = 4;
const CARD_GAP = 16;

/** 文字の大きさ（u単位）。指で操作するゲームなので、カードの名前より大きく取る。 */
const TITLE_SIZE = 46;
const BODY_SIZE = 34;
const NOTE_SIZE = 30;

/** 補足の行の薄さ（本文より一段引いて見せる）。 */
const NOTE_ALPHA = 0.8;

/** 吹き出しの最大幅（u単位）。画面が狭ければそちらに合わせて縮む。 */
const MAX_WIDTH = 700;

/** 吹き出しに出す文言。 */
export interface TooltipContent {
  readonly title: string;
  readonly body?: string;
  /** 本文に続く補足（かかる時間など）。本文より小さく薄く出す。 */
  readonly note?: string;
}

/**
 * 操作1つを説明する吹き出しの中身。実行できるものは**何が起きるか・どれだけ時間を取られるか**、
 * 実行できないものは**なぜできないか**（GameElementDefinition.md 14.6節のreason）。
 *
 * **ボタンの操作も重ねる操作も同じ形で出す。** 押せないボタン（ObjectWindow）と、重ねても何も
 * 起きない組み合わせ（CardDragController）は、プレイヤーから見て同じ「できない」なので、
 * 言い方を2通り持たない。理由の宣言が無い要件で落ちているときだけ、決まり文句で断る。
 */
export function interactionTooltip(operation: {
  readonly label: string;
  readonly description?: string | undefined;
  readonly minutes: number;
  readonly enabled: boolean;
  readonly reason?: string | undefined;
}): TooltipContent {
  return operation.enabled
    ? { title: operation.label, body: operation.description, note: timeCostLine(operation.minutes) }
    : { title: operation.label, body: operation.reason ?? uiText('cannot_do_now') };
}

/**
 * その操作について言うことを出す吹き出し。ドラッグ中のカードを重ねたとき（CardDragController）と、
 * アクションのボタンを長押ししたとき（ObjectWindow）に出す。**これから起きることとは限らない**
 * ——できない操作では、なぜできないかを出す（interactionTooltip）。
 *
 * 置き場所は基準にした矩形（掴んでいるカード・押しているボタン）の真上。指はその中心にあるので、
 * 上へ逃がせば隠れない。上に入り切らない場合だけ下へ回す。
 *
 * **札やボタンより手前に出ることは自分で保つ**（SCREEN_DEPTH.tooltip）。生成順に頼ると、後から
 * 作られた札やボタンの陰に入るので、作り直す側それぞれが持ち上げ直しを覚えていなければならない。
 *
 * 中身の作り直しは文言が変わったときだけ行う。ポインタが動くたびにTextを作り直すと、そのたびに
 * テクスチャが焼き直されて重いため。
 */
export class Tooltip {
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
    this.container = scene.add.container(0, 0).setVisible(false).setDepth(SCREEN_DEPTH.tooltip);
  }

  /** atの矩形を基準に、その上（入らなければ下）へ出す。 */
  show(content: TooltipContent, at: Rect): void {
    const key = `${content.title}\n${content.body ?? ''}\n${content.note ?? ''}`;
    if (key !== this.shown) {
      this.shown = key;
      this.build(content);
    }

    const gap = this.metrics.px(CARD_GAP);
    const margin = this.metrics.px(SIZE.margin * 2);
    const above = at.y - gap - this.height;
    const y = above >= margin ? above : at.y + at.height + gap;

    this.container.setPosition(
      Phaser.Math.Clamp(
        at.x + (at.width - this.width) / 2,
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

  private build(content: TooltipContent): void {
    this.container.removeAll(true);

    const padding = this.metrics.px(PADDING);
    const maxTextWidth =
      Math.min(this.metrics.px(MAX_WIDTH), this.metrics.width - this.metrics.px(SIZE.margin * 4)) -
      padding * 2;

    const lines = [this.addText(content.title, TITLE_SIZE, true, maxTextWidth)];
    if (content.body !== undefined) lines.push(this.addText(content.body, BODY_SIZE, false, maxTextWidth));
    if (content.note !== undefined) {
      lines.push(this.addText(content.note, NOTE_SIZE, false, maxTextWidth).setAlpha(NOTE_ALPHA));
    }

    const lineGap = this.metrics.px(LINE_GAP);
    this.width = Math.max(...lines.map((line) => line.width)) + padding * 2;
    this.height =
      lines.reduce((total, line) => total + line.height, 0) + lineGap * (lines.length - 1) + padding * 2;

    const face = this.scene.add.graphics();
    drawBox(
      face,
      { x: 0, y: 0, width: this.width, height: this.height },
      {
        fillColor: COLOR.cardEdgeOverlay,
        fillAlpha: 0.94,
        borderColor: COLOR.textOnDark,
        borderWidth: this.metrics.linePx(2),
        radius: this.metrics.px(SIZE.radius),
      },
    );

    let cursorY = padding;
    for (const line of lines) {
      line.setPosition(padding, cursorY);
      cursorY += line.height + lineGap;
    }
    this.container.add([face, ...lines]);
  }

  private addText(value: string, size: number, bold: boolean, maxWidth: number): Phaser.GameObjects.Text {
    return addLabel(this.scene, this.metrics, 0, 0, value, {
      size,
      bold,
      color: COLOR.textOnDark,
      wrapWidthPx: maxWidth,
      lineGap: TEXT_LINE_GAP,
    });
  }
}
