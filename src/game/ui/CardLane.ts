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

/** 並びが変わったカードが、新しい位置へ滑る時間（ミリ秒）と加速の形。 */
const SLIDE_MS = 220;
const SLIDE_EASE = 'Quad.easeOut';

/** レーンの内容を差し替えた結果。出入りするカードの見せ方は呼び出し側（CardMotion）が決める。 */
export interface LaneUpdate {
  /** このレーンに新しく現れたカード。stripの所定の位置に居るが、まだ表示されていない。 */
  readonly entered: readonly { readonly card: Card; readonly index: number }[];
  /** このレーンから居なくなったカード。stripからは外してあるが、破棄は呼び出し側が行う。 */
  readonly left: readonly Card[];
}

/**
 * フィールドエリアの1レーン。カードは横スクロールで送る（ScreenLayout.md フィールドエリア節）。
 *
 * レーンからはみ出したカードは切り抜かず、隣接エリアの背景板が上から覆って隠す。
 * ロケーションレーンの現在地カードも同様に、スクロール領域より後に描いて上へ重ねる。
 *
 * cardsのundefinedは空きセルを表し、EmptyCard（枠だけの破線カード）として並べる。
 *
 * 内容が変わったときは作り直さずsetCardsで差し替える。同じインスタンスを映しているカードは
 * そのまま残して新しい位置へ滑らせ、出入りするカードだけを呼び出し側へ渡す。
 */
export class CardLane {
  /** レーンの矩形。ドロップ先の判定（dropTargetAt）に使う。 */
  readonly rect: Rect;

  /** ピン留めしたカードの矩形（持たないレーンではundefined）。 */
  readonly pinnedRect: Rect | undefined;

  private readonly scene: Phaser.Scene;
  private readonly metrics: ScreenMetrics;
  private readonly strip: Phaser.GameObjects.Container;

  /** 並んでいるカードの表示物。空きセルはundefined。位置＝添字。 */
  private _cardObjects: (Card | undefined)[] = [];
  get cardObjects(): readonly (Card | undefined)[] {
    return this._cardObjects;
  }

  /** 空きセルの枠。カードと違って位置以外の状態を持たないので、差し替えのたびに作り直す。 */
  private placeholders: EmptyCard[] = [];

  /** スクロール量0のときのstripの位置と、可視域の幅。 */
  private readonly originX: number;
  private readonly stripWidth: number;

  /** スクロールできる下限（コンテンツが可視域に収まるなら0）。 */
  private minScrollX = 0;

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

    this.scene = scene;
    this.metrics = metrics;
    this.rect = rect;
    this.pitch = cardWidth + gap;
    this.cardWidth = cardWidth;
    this.cardHeight = metrics.px(SIZE.cardHeight);
    this.cardY = cardY;
    this.insertMarkWidth = metrics.px(INSERT_MARK_WIDTH);
    this.originX = stripX;
    this.stripWidth = Math.max(0, rect.x + rect.width - margin - stripX);
    this.strip = scene.add.container(stripX, cardY);
    // 最初の1回だけは出どころが無いので、setCardsが伏せたカードをそのまま表に返す。
    for (const { card } of this.setCards(cards).entered) card.setVisible(true);

    this.pinnedRect =
      pinned === undefined
        ? undefined
        : { x: rect.x + margin, y: cardY, width: cardWidth, height: this.cardHeight };
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
   * 並べるカードを差し替える。同じインスタンスを映しているカード（identityが1つでも重なるもの）は
   * 作り直さず、新しい位置へ滑らせる。新しく現れたカードは所定の位置に置くが、どこから来たのかは
   * このレーンには分からないので、非表示のまま呼び出し側へ渡す。
   */
  setCards(cards: readonly (CardContent | undefined)[]): LaneUpdate {
    const reusable = this._cardObjects.filter((card): card is Card => card !== undefined);
    const entered: { card: Card; index: number }[] = [];

    this._cardObjects = cards.map((content, index) => {
      if (content === undefined) return undefined;

      const found = reusable.findIndex((card) => sharesIdentity(card.content, content));
      if (found < 0) {
        const card = new Card(this.scene, this.metrics, index * this.pitch, 0, content);
        card.setVisible(false);
        this.strip.add(card);
        entered.push({ card, index });
        return card;
      }

      const [card] = reusable.splice(found, 1);
      card.setContent(content);
      this.slideTo(card, index);
      return card;
    });

    for (const card of reusable) this.strip.remove(card);
    this.resetPlaceholders();

    const contentWidth = cards.length === 0 ? 0 : cards.length * this.pitch - (this.pitch - this.cardWidth);
    this.minScrollX = Math.min(0, this.stripWidth - contentWidth);
    this.scrollTo(this.strip.x - this.originX);

    return { entered, left: reusable };
  }

  /** 居続けるカードを新しい位置へ滑らせる（既に所定の位置なら何もしない）。 */
  private slideTo(card: Card, index: number): void {
    const x = index * this.pitch;
    if (card.x === x) return;

    this.scene.tweens.add({ targets: card, x, duration: SLIDE_MS, ease: SLIDE_EASE });
  }

  private resetPlaceholders(): void {
    for (const placeholder of this.placeholders) placeholder.destroy();
    this.placeholders = this._cardObjects.flatMap((card, index) =>
      card === undefined ? [new EmptyCard(this.scene, this.metrics, index * this.pitch, 0)] : [],
    );
    // 空きセルの枠はカードより奥に敷く（飛んできたカードが枠に隠れないように）。
    for (const placeholder of this.placeholders) {
      this.strip.add(placeholder);
      this.strip.sendToBack(placeholder);
    }
  }

  /** 添字の位置に並ぶカードの、画面上の矩形。 */
  slotRect(index: number): Rect {
    return {
      x: this.strip.x + index * this.pitch,
      y: this.cardY,
      width: this.cardWidth,
      height: this.cardHeight,
    };
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
    if (target.kind === 'combine') return this.slotRect(target.index);

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

/** 2枚のカードが同じものを映しているか（identityが1つでも重なるか、Card.identity参照）。 */
function sharesIdentity(a: CardContent, b: CardContent): boolean {
  if (a.identity === undefined || b.identity === undefined) return false;
  return a.identity.some((id) => b.identity?.includes(id) === true);
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
