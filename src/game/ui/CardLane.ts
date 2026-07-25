import Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import type { CardContent } from './Card';
import { Card, EmptyCard } from './Card';
import { COLOR, SIZE } from './theme';
import { addPanel } from './shapes';

/**
 * フィールドエリアの1レーン。カードは横スクロールで送る（ScreenLayout.md フィールドエリア節）。
 *
 * レーンからはみ出したカードは切り抜かず、隣接エリアの背景板が上から覆って隠す。
 * ロケーションレーンの現在地カードも同様に、スクロール領域より後に描いて上へ重ねる。
 *
 * cardsのundefinedは空きセルを表し、EmptyCard（枠だけの破線カード）として並べる。
 */
export class CardLane {
  private readonly strip: Phaser.GameObjects.Container;

  /** スクロール量0のときのstripの位置。 */
  private readonly originX: number;

  /** スクロールできる下限（コンテンツが可視域に収まるなら0）。 */
  private readonly minScrollX: number;

  private dragStartScrollX = 0;

  constructor(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    rect: Rect,
    background: number,
    cards: readonly (CardContent | undefined)[],
    pinned?: CardContent,
  ) {
    const margin = metrics.px(SIZE.margin);
    const gap = metrics.px(SIZE.gap);
    const cardWidth = metrics.px(SIZE.cardWidth);
    const dividerWidth = metrics.px(4);
    const cardY = rect.y + (rect.height - metrics.px(SIZE.cardHeight)) / 2;

    const panel = addPanel(scene, rect, background);

    const pinnedWidth = pinned === undefined ? 0 : cardWidth + gap + dividerWidth + gap;
    const stripX = rect.x + margin + pinnedWidth;
    const stripWidth = Math.max(0, rect.x + rect.width - margin - stripX);

    this.originX = stripX;
    this.strip = scene.add.container(stripX, cardY);
    cards.forEach((card, index) => {
      const x = index * (cardWidth + gap);
      this.strip.add(
        card === undefined ? new EmptyCard(scene, metrics, x, 0) : new Card(scene, metrics, x, 0, card),
      );
    });

    const contentWidth = cards.length === 0 ? 0 : cards.length * (cardWidth + gap) - gap;
    this.minScrollX = Math.min(0, stripWidth - contentWidth);

    const pinnedPanel =
      pinned === undefined ? undefined : this.addPinnedSlot(scene, metrics, rect, background, cardY, pinned);

    scene.input.setDraggable(panel);
    panel.on('dragstart', () => {
      this.dragStartScrollX = this.strip.x - this.originX;
    });
    panel.on('drag', (pointer: Phaser.Input.Pointer) => {
      this.scrollTo(this.dragStartScrollX + (pointer.x - pointer.downX));
    });

    // ピン留め部分は背景板が上に重なりレーン本体がホイールを受け取れないので、そちらにも同じ操作を付ける。
    for (const target of [panel, pinnedPanel]) {
      target?.on('wheel', (pointer: Phaser.Input.Pointer, deltaX: number, deltaY: number) => {
        this.scrollTo(this.strip.x - this.originX - wheelPixels(pointer, deltaX, deltaY));
      });
    }
  }

  /** スクロール量を可動範囲へ収めて反映する。 */
  private scrollTo(scrollX: number): void {
    this.strip.x = this.originX + Phaser.Math.Clamp(scrollX, this.minScrollX, 0);
  }

  /** 現在地カードはレーン左端に固定し、区切り線を挟んで右にスクロール領域を置く。 */
  private addPinnedSlot(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    rect: Rect,
    background: number,
    cardY: number,
    pinned: CardContent,
  ): Phaser.GameObjects.Rectangle {
    const margin = metrics.px(SIZE.margin);
    const gap = metrics.px(SIZE.gap);
    const cardWidth = metrics.px(SIZE.cardWidth);
    const dividerWidth = metrics.px(4);

    const panel = addPanel(scene, { ...rect, width: margin + cardWidth + gap + dividerWidth }, background);
    new Card(scene, metrics, rect.x + margin, cardY, pinned);

    const cardHeight = metrics.px(SIZE.cardHeight);
    scene.add.rectangle(
      rect.x + margin + cardWidth + gap + dividerWidth / 2,
      cardY + cardHeight / 2,
      dividerWidth,
      cardHeight,
      COLOR.laneDivider,
      0.35,
    );
    return panel;
  }
}

/** deltaModeがピクセル・行・ページのときの、delta1あたりのピクセル数。 */
const WHEEL_DELTA_PIXELS = [1, 16, 400];

/**
 * ホイールの回転量をスクロールするピクセル数に直す。
 *
 * 縦ホイールしか無いマウスでも送れるよう、横方向の回転が無ければ縦方向の回転を横スクロールに使う。
 * ブラウザによってdeltaの単位が行・ページになるため（Phaserは正規化しない）、ピクセルへ揃える。
 */
function wheelPixels(pointer: Phaser.Input.Pointer, deltaX: number, deltaY: number): number {
  const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  const mode = pointer.event instanceof WheelEvent ? pointer.event.deltaMode : 0;
  return delta * (WHEEL_DELTA_PIXELS[mode] ?? 1);
}
