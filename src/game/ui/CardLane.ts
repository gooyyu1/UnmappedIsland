import Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import type { CardContent } from './Card';
import { Card, EmptyCard } from './Card';
import { COLOR, SIZE } from './theme';
import { addPanel } from './shapes';

/**
 * ドロップ先として見たときの、レーン上の1点の意味。
 *
 * - combine: カードそのものに重ねた（そのカードとのcombination、GameElementDefinition.md 12節）。
 * - insert: カードとカードの隙間へ落とした（そこへ移動）。gapIndexは0が先頭のカードの前。
 */
export type LaneDropTarget =
  | { readonly kind: 'combine'; readonly index: number }
  | { readonly kind: 'insert'; readonly gapIndex: number };

/**
 * カードの左右のうち、隙間へ落としたものとして扱う幅の比。カード同士の実際の隙間（12u）は狭く、
 * 移したいだけなのにcombinationと判定されやすいため、その手前を隙間側へ寄せる。
 */
const GAP_EDGE_RATIO = 1 / 8;

/** 隙間を示す帯の幅（u単位）。 */
const INSERT_MARK_WIDTH = 10;

/**
 * フィールドエリアの1レーン。カードは横スクロールで送る（ScreenLayout.md フィールドエリア節）。
 *
 * レーンからはみ出したカードは切り抜かず、隣接エリアの背景板が上から覆って隠す。
 * ロケーションレーンの現在地カードも同様に、スクロール領域より後に描いて上へ重ねる。
 *
 * cardsのundefinedは空きセルを表し、EmptyCard（枠だけの破線カード）として並べる。
 */
export class CardLane {
  /** レーンの矩形。ドロップ先の判定（dropTargetAt）に使う。 */
  readonly rect: Rect;

  /** 並んでいるカードの表示物。空きセルはundefined。位置＝添字。 */
  readonly cardObjects: readonly (Card | undefined)[];

  private readonly strip: Phaser.GameObjects.Container;

  /** スクロール量0のときのstripの位置。 */
  private readonly originX: number;

  /** スクロールできる下限（コンテンツが可視域に収まるなら0）。 */
  private readonly minScrollX: number;

  /** カード1枚分の送り幅（カード幅＋ギャップ）とカードの実寸。 */
  private readonly pitch: number;
  private readonly cardWidth: number;
  private readonly cardHeight: number;
  private readonly cardY: number;
  private readonly insertMarkWidth: number;

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

    this.rect = rect;
    this.pitch = cardWidth + gap;
    this.cardWidth = cardWidth;
    this.cardHeight = metrics.px(SIZE.cardHeight);
    this.cardY = cardY;
    this.insertMarkWidth = metrics.px(INSERT_MARK_WIDTH);
    this.originX = stripX;
    this.strip = scene.add.container(stripX, cardY);
    this.cardObjects = cards.map((card, index) => {
      const x = index * this.pitch;
      if (card === undefined) {
        this.strip.add(new EmptyCard(scene, metrics, x, 0));
        return undefined;
      }
      const object = new Card(scene, metrics, x, 0, card);
      this.strip.add(object);
      return object;
    });

    const contentWidth = cards.length === 0 ? 0 : cards.length * (cardWidth + gap) - gap;
    this.minScrollX = Math.min(0, stripWidth - contentWidth);

    const pinnedPanel =
      pinned === undefined ? undefined : this.addPinnedSlot(scene, metrics, rect, background, cardY, pinned);

    scene.input.setDraggable(panel);
    panel.on('dragstart', () => this.beginScroll());
    panel.on('drag', (pointer: Phaser.Input.Pointer) => this.scrollByDrag(pointer.x - pointer.downX));

    // ピン留め部分は背景板が上に重なりレーン本体がホイールを受け取れないので、そちらにも同じ操作を付ける。
    for (const target of [panel, pinnedPanel]) {
      target?.on('wheel', (pointer: Phaser.Input.Pointer, deltaX: number, deltaY: number) => {
        this.scrollTo(this.strip.x - this.originX - wheelPixels(pointer, deltaX, deltaY));
      });
    }
  }

  /**
   * ドラッグによる横スクロールを始める（今のスクロール量を基準として憶える）。カードの上から始めた
   * ドラッグをスクロールとして扱う場合もここから入る（CardDragController参照）。
   */
  beginScroll(): void {
    this.dragStartScrollX = this.strip.x - this.originX;
  }

  /** beginScrollの時点からのポインタの移動量を、スクロール量へ反映する。 */
  scrollByDrag(deltaX: number): void {
    this.scrollTo(this.dragStartScrollX + deltaX);
  }

  /** スクロール量を可動範囲へ収めて反映する。 */
  private scrollTo(scrollX: number): void {
    this.strip.x = this.originX + Phaser.Math.Clamp(scrollX, this.minScrollX, 0);
  }

  /**
   * 画面上の1点が指すドロップ先（レーンの外ならundefined）。
   *
   * カードの中央部分だけを「そのカードに重ねた」とみなし、左右のGAP_EDGE_RATIO分とカード同士の隙間、
   * および空きセルは「隙間へ落とした」＝移動として扱う。
   */
  dropTargetAt(x: number, y: number): LaneDropTarget | undefined {
    if (x < this.rect.x || x >= this.rect.x + this.rect.width) return undefined;
    if (y < this.rect.y || y >= this.rect.y + this.rect.height) return undefined;

    const count = this.cardObjects.length;
    const localX = x - this.strip.x;
    const index = Math.floor(localX / this.pitch);
    if (index < 0) return { kind: 'insert', gapIndex: 0 };
    if (index >= count) return { kind: 'insert', gapIndex: count };

    // 空きセルには重ねる相手が居ないので、幅いっぱいがその枠への挿入になる。
    if (this.cardObjects[index] === undefined) return { kind: 'insert', gapIndex: index };

    const offset = localX - index * this.pitch;
    if (offset < this.cardWidth * GAP_EDGE_RATIO) return { kind: 'insert', gapIndex: index };
    if (offset > this.cardWidth * (1 - GAP_EDGE_RATIO)) return { kind: 'insert', gapIndex: index + 1 };
    return { kind: 'combine', index };
  }

  /** ドロップ先を示す枠の位置（カードに重ねるならカードそのもの、隙間なら細い縦帯）。 */
  dropIndicatorRect(target: LaneDropTarget): Rect {
    if (target.kind === 'combine') {
      return {
        x: this.strip.x + target.index * this.pitch,
        y: this.cardY,
        width: this.cardWidth,
        height: this.cardHeight,
      };
    }

    // 隙間の中心は「右隣のカードの左端 - ギャップの半分」。両端の隙間はレーンからはみ出すので収める。
    const center = this.strip.x + target.gapIndex * this.pitch - (this.pitch - this.cardWidth) / 2;
    const width = this.insertMarkWidth;
    return {
      x: Phaser.Math.Clamp(center - width / 2, this.rect.x, this.rect.x + this.rect.width - width),
      y: this.cardY,
      width,
      height: this.cardHeight,
    };
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
