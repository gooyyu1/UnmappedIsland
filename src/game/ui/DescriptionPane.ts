import type Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import type { CardContent } from './Card';
import { borrowedFace } from './cardFace';
import { CardLane } from './CardLane';
import type { ObjectWindowLane, ObjectWindowPane } from './ObjectWindowPane';
import { CONTENT_GAP } from '../looks/childWindowLayout';
import { addLabel } from '../../ui/labels';
import { COLOR, SIZE } from '../looks/theme';
import { uiText } from '../../locale/uiTexts';

/** 説明文の大きさと行間（u単位）。 */
const TEXT_SIZE = 26;
const LINE_SPACING = 6;

/**
 * オブジェクトウィンドウの説明のタブ（Windows.md 1.2節）。左に借りてきた札の枠、右に説明文。
 *
 * **オブジェクト自身のカードを出すのはこの面だけ。** 他の面は中段を丸ごと並びに使う。借りた札は
 * タブによらず借りたままで、描かれないだけ。
 *
 * 札の枠が**枠1つのレーン**なのは、他のカードを重ねる操作（combination・中へ入れる）がレーンと
 * まったく同じ仕組みで効くようにするため——借りてきた札はここに在るので、手持ちからここへ
 * 落とせなければ石を打ち割れない。カードそのものは置かない（CardTableが並びの差し替えで置く）。
 */
export class DescriptionPane implements ObjectWindowPane {
  /**
   * この面が要る高さ。札と文の高いほう。**文の高さは折り返してみないと分からない**ので、
   * 同じ体裁の文を1つ作って測り、捨てる。
   */
  static height(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    contentWidth: number,
    description: string | undefined,
  ): number {
    const text = addText(scene, metrics, contentWidth, description);
    const height = Math.max(metrics.px(SIZE.cardHeight), text.height);
    text.destroy();
    return height;
  }

  readonly lanes: readonly ObjectWindowLane[];

  private readonly lane: CardLane;
  private readonly text: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    area: Rect,
    card: CardContent,
    description: string | undefined,
  ) {
    const cardWidth = metrics.px(SIZE.cardWidth);
    const cardHeight = metrics.px(SIZE.cardHeight);
    this.lane = new CardLane(
      scene,
      metrics,
      {
        x: area.x,
        y: area.y + (area.height - cardHeight) / 2,
        width: cardWidth,
        height: cardHeight,
      },
      COLOR.slotWindowLane,
      [{ card: borrowedFace(card) }],
      { bare: true },
    );
    this.lanes = [{ role: 'card', lane: this.lane }];

    this.text = addText(scene, metrics, area.width, description);
    this.text.setPosition(
      area.x + cardWidth + metrics.px(CONTENT_GAP),
      area.y + (area.height - this.text.height) / 2,
    );
  }

  /** 説明文も借りた札の内容も、窓が開いている間は変わらない。 */
  refresh(): void {}

  destroy(): void {
    this.lane.destroy();
    this.text.destroy();
  }
}

/** 説明文を、右の段の幅で折り返して作る。宣言が無ければ代わりの1行を淡い色で出す。 */
function addText(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  contentWidth: number,
  description: string | undefined,
): Phaser.GameObjects.Text {
  const columnWidth = contentWidth - metrics.px(SIZE.cardWidth) - metrics.px(CONTENT_GAP);
  return addLabel(scene, metrics, 0, 0, description ?? uiText('no_description'), {
    size: TEXT_SIZE,
    color: description === undefined ? COLOR.textMuted : COLOR.text,
    wrapWidth: columnWidth,
    lineGap: LINE_SPACING,
  });
}
