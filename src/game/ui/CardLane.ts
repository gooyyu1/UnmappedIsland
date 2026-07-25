import Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import { Card } from './Card';
import { COLOR, SIZE } from './theme';
import { addPanel } from './shapes';

/** レーンに並べる1枚分の内容。 */
export interface LaneCard {
  readonly icon: string;
  readonly name: string;
}

/**
 * フィールドエリアの1レーン。カードは横スクロールで送る（ScreenLayout.md フィールドエリア節）。
 *
 * レーンからはみ出したカードは切り抜かず、隣接エリアの背景板が上から覆って隠す。
 * ロケーションレーンの現在地カードも同様に、スクロール領域より後に描いて上へ重ねる。
 */
export class CardLane {
  private readonly strip: Phaser.GameObjects.Container;

  /** スクロールできる下限（コンテンツが可視域に収まるなら0）。 */
  private readonly minScrollX: number;

  private dragStartScrollX = 0;

  constructor(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    rect: Rect,
    background: number,
    cards: readonly LaneCard[],
    pinned?: LaneCard,
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

    this.strip = scene.add.container(stripX, cardY);
    cards.forEach((card, index) => {
      this.strip.add(new Card(scene, metrics, index * (cardWidth + gap), 0, card.icon, card.name));
    });

    const contentWidth = cards.length === 0 ? 0 : cards.length * (cardWidth + gap) - gap;
    this.minScrollX = Math.min(0, stripWidth - contentWidth);

    if (pinned !== undefined) this.addPinnedSlot(scene, metrics, rect, background, cardY, pinned);

    scene.input.setDraggable(panel);
    panel.on('dragstart', () => {
      this.dragStartScrollX = this.strip.x - stripX;
    });
    panel.on('drag', (pointer: Phaser.Input.Pointer) => {
      const scrollX = this.dragStartScrollX + (pointer.x - pointer.downX);
      this.strip.x = stripX + Phaser.Math.Clamp(scrollX, this.minScrollX, 0);
    });
  }

  /** 現在地カードはレーン左端に固定し、区切り線を挟んで右にスクロール領域を置く。 */
  private addPinnedSlot(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    rect: Rect,
    background: number,
    cardY: number,
    pinned: LaneCard,
  ): void {
    const margin = metrics.px(SIZE.margin);
    const gap = metrics.px(SIZE.gap);
    const cardWidth = metrics.px(SIZE.cardWidth);
    const dividerWidth = metrics.px(4);

    addPanel(scene, { ...rect, width: margin + cardWidth + gap + dividerWidth }, background);
    new Card(scene, metrics, rect.x + margin, cardY, pinned.icon, pinned.name);

    const cardHeight = metrics.px(SIZE.cardHeight);
    scene.add.rectangle(
      rect.x + margin + cardWidth + gap + dividerWidth / 2,
      cardY + cardHeight / 2,
      dividerWidth,
      cardHeight,
      COLOR.laneDivider,
      0.35,
    );
  }
}
