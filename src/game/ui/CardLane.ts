import Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import type { CardContent } from './Card';
import { Card, EmptyCard } from './Card';
import { COLOR, SIZE } from './theme';
import { addPanel, addTiledPanel } from './shapes';
import { wheelPixels } from './scroll';
import { ScrollIndicator } from './ScrollIndicator';

/**
 * ドロップ先として見たときの、レーン上の1点の意味。
 *
 * - combine: カードそのものに重ねた（そのカードとのcombination、GameElementDefinition.md 12節）。
 * - gap: カードとカードの隙間へ落とした（そこへ移動）。indexは0が先頭のカードの前。
 * - cell: 空きセルそのものへ落とした（その枠へ移動）。indexはその枠の位置。
 */
export type LaneDropTarget =
  | { readonly kind: 'combine'; readonly index: number }
  | { readonly kind: 'gap'; readonly index: number }
  | { readonly kind: 'cell'; readonly index: number };

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

/** レーンの見た目の選択肢。既定（省略）はフィールドエリアの3レーン。 */
export interface CardLaneOptions {
  /** 左端にピン留めするカード（ロケーションレーンの現在地）。 */
  readonly pinned?: CardContent;
  /**
   * 背景に敷く絵のテクスチャキー（backgroundArt参照）。省略すると背景色だけで塗る。絵が用意されていない
   * 土地・子ウィンドウの中のレーンがそれにあたる。
   */
  readonly art?: string;
  /**
   * はみ出したカードをマスクで切り抜くか。子ウィンドウの中で使うときに立てる——レーンの既定は
   * 「隣接エリアの背景板が上から覆って隠す」で、周りに背景板が無い子ウィンドウでは通用しないため。
   */
  readonly clip?: boolean;
  /**
   * 並びの末尾に、カードを受け入れることを示す空枠を1つ出すか。カードを落とせる前詰めのレーンで立てる。
   * 前詰めのレーンは中身が空だと何も描かれず、操作を受け付けるかどうかが見て分からないため。
   * 固定枠のレーンは空き枠そのものが常に見えているので不要。
   */
  readonly trailingPlaceholder?: boolean;
  /**
   * 表示物を置く層（省略すると既定の0）。レーンだけを作り直しても描画順を保ちたい場合に、
   * 周りより奥の層を指定する（PlayScene.FIELD_DEPTH）。
   */
  readonly depth?: number;
}

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

  /** 送り具合を示すスクロールバー。送る必要が無いときは自分で姿を消す。 */
  private readonly scrollIndicator: ScrollIndicator;

  /** カード1枚分の送り幅（カード幅＋ギャップ）とカードの実寸。 */
  private readonly pitch: number;
  private readonly cardWidth: number;
  private readonly cardHeight: number;
  private readonly cardY: number;
  private readonly insertMarkWidth: number;

  private dragStartScrollX = 0;

  /** はみ出しを切り抜くマスクの形（clipのときだけ持つ）。表示物ではないので破棄も自分で行う。 */
  private readonly maskShape: Phaser.GameObjects.Graphics | undefined;

  /** 末尾に受け入れの空枠を出すか（CardLaneOptions.trailingPlaceholder）。 */
  private readonly trailingPlaceholder: boolean;

  /**
   * stripに属さない表示物（背景板・ピン留め部分）。カードはstripごと消えるが、これらは
   * 個別に破棄しないと残ってしまう（背景板は入力も吸い続ける）。
   */
  private readonly objects: (Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Depth)[] = [];

  /**
   * 絵を敷いた背景板（背景色だけのレーンでは空）。カードと同じだけ横へ送るので、スクロールのたびに
   * 敷き位置を更新する。ピン留め部分の背景板も、絵が途切れないよう同じ位置で敷く。
   */
  private readonly tiles: Phaser.GameObjects.TileSprite[] = [];

  constructor(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    rect: Rect,
    background: number,
    cards: readonly (CardContent | undefined)[],
    options: CardLaneOptions = {},
  ) {
    const { pinned } = options;
    const margin = metrics.px(SIZE.margin);
    const gap = metrics.px(SIZE.gap);
    const cardWidth = metrics.px(SIZE.cardWidth);
    const dividerWidth = metrics.px(4);
    const cardY = rect.y + (rect.height - metrics.px(SIZE.cardHeight)) / 2;

    const panel = this.addBackground(scene, rect, background, options.art);

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
    this.trailingPlaceholder = options.trailingPlaceholder === true;
    this.stripWidth = Math.max(0, rect.x + rect.width - margin - stripX);
    this.strip = scene.add.container(stripX, cardY);

    // バーはカードより後に作り、カードの上へ重ねる。
    this.scrollIndicator = new ScrollIndicator(
      scene,
      metrics,
      stripX,
      cardY + this.cardHeight + metrics.px(SIZE.scrollBarGap),
      this.stripWidth,
    );
    this.objects.push(this.scrollIndicator);

    // 最初の1回だけは出どころが無いので、setCardsが伏せたカードをそのまま表に返す。
    for (const { card } of this.setCards(cards).entered) card.setVisible(true);

    this.pinnedRect =
      pinned === undefined
        ? undefined
        : { x: rect.x + margin, y: cardY, width: cardWidth, height: this.cardHeight };
    const pinnedPanel =
      pinned === undefined
        ? undefined
        : this.addPinnedSlot(scene, metrics, rect, background, options.art, cardY, pinned);

    scene.input.setDraggable(panel);
    panel.on('dragstart', () => this.beginScroll());
    panel.on('drag', (pointer: Phaser.Input.Pointer) => this.scrollByDrag(pointer.x - pointer.downX));

    // ピン留め部分は背景板が上に重なりレーン本体がホイールを受け取れないので、そちらにも同じ操作を付ける。
    for (const target of [panel, pinnedPanel]) {
      target?.on('wheel', (pointer: Phaser.Input.Pointer, deltaX: number, deltaY: number) => {
        this.scrollTo(this.strip.x - this.originX - wheelPixels(pointer, deltaX, deltaY));
      });
    }

    if (options.clip === true) {
      // 切り抜きはフィルタとしてのマスクで行う（Phaser 4のsetMaskはCanvas専用）。
      this.maskShape = scene.make.graphics({});
      this.maskShape.fillStyle(COLOR.cardFace, 1);
      this.maskShape.fillRect(rect.x, rect.y, rect.width, rect.height);
      this.strip.enableFilters();
      this.strip.filters?.internal.addMask(this.maskShape);
    }

    // カードはstripの子なので、stripと自前の表示物を移せば並んでいるカードごと同じ層へ移る。
    if (options.depth !== undefined) {
      this.strip.setDepth(options.depth);
      for (const object of this.objects) object.setDepth(options.depth);
    }
  }

  /** レーンごと片付ける（子ウィンドウを閉じるとき）。カード自体はstripの破棄でまとめて消える。 */
  destroy(): void {
    this.strip.destroy();
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
    this.maskShape?.destroy();
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

    // 末尾の空枠も送れる範囲に含める（画面外に置いたままでは受け皿にならない）。
    const slots = cards.length + (this.trailingPlaceholder ? 1 : 0);
    const contentWidth = slots === 0 ? 0 : slots * this.pitch - (this.pitch - this.cardWidth);
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
    if (this.trailingPlaceholder) {
      const at = this._cardObjects.length * this.pitch;
      this.placeholders.push(new EmptyCard(this.scene, this.metrics, at, 0));
    }
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

  /** スクロール量を可動範囲へ収めて反映する。背景の絵もカードと同じだけ送る（地面の上を送る見え方）。 */
  private scrollTo(scrollX: number): void {
    const clamped = Phaser.Math.Clamp(scrollX, this.minScrollX, 0);
    this.strip.x = this.originX + clamped;
    // tilePositionXは絵の側の座標なので、敷くときにかけた倍率で割り戻す。
    for (const tile of this.tiles) tile.tilePositionX = -clamped / tile.tileScaleX;
    this.scrollIndicator.setScroll(clamped, this.minScrollX);
  }

  /**
   * 画面上の1点が指すドロップ先（レーンの外ならundefined）。
   *
   * カードの中央部分だけを「そのカードに重ねた」とみなし、左右のGAP_EDGE_RATIO分とカード同士の隙間は
   * 「隙間へ落とした」として扱う。空きセルは幅いっぱいが「その枠へ落とした」——枠が見えている以上、
   * 狙うのは両隣の隙間ではなく枠そのものになるため。
   */
  dropTargetAt(x: number, y: number): LaneDropTarget | undefined {
    if (x < this.rect.x || x >= this.rect.x + this.rect.width) return undefined;
    if (y < this.rect.y || y >= this.rect.y + this.rect.height) return undefined;

    const count = this.cardObjects.length;
    const localX = x - this.strip.x;
    const index = Math.floor(localX / this.pitch);
    if (index < 0) return { kind: 'gap', index: 0 };
    if (index >= count) return { kind: 'gap', index: count };

    // カード1枚分の送り幅のうち、カードの右側にはみ出した分がカード同士の実際の隙間。
    const offset = localX - index * this.pitch;
    if (offset >= this.cardWidth) return { kind: 'gap', index: index + 1 };

    if (this.cardObjects[index] === undefined) return { kind: 'cell', index };
    if (offset < this.cardWidth * GAP_EDGE_RATIO) return { kind: 'gap', index };
    if (offset > this.cardWidth * (1 - GAP_EDGE_RATIO)) return { kind: 'gap', index: index + 1 };
    return { kind: 'combine', index };
  }

  /** ドロップ先を示す枠の位置（カード・空きセルならその枠そのもの、隙間なら細い縦帯）。 */
  dropIndicatorRect(target: LaneDropTarget): Rect {
    if (target.kind !== 'gap') return this.slotRect(target.index);
    // 末尾の空枠へ落とすときは、そこが受け皿なので帯ではなく枠そのものを示す。
    if (this.trailingPlaceholder && target.index === this._cardObjects.length) {
      return this.slotRect(target.index);
    }

    // 隙間の中心は「右隣のカードの左端 - ギャップの半分」。両端の隙間はレーンからはみ出すので収める。
    const center = this.strip.x + target.index * this.pitch - (this.pitch - this.cardWidth) / 2;
    const width = this.insertMarkWidth;
    return {
      x: Phaser.Math.Clamp(center - width / 2, this.rect.x, this.rect.x + this.rect.width - width),
      y: this.cardY,
      width,
      height: this.cardHeight,
    };
  }

  /**
   * 背景板を1枚置く。絵があれば敷き、無ければ背景色で塗る。どちらも入力を遮る（addPanel参照）。
   * 置いた板は自分で片付ける（objects）。
   */
  private addBackground(
    scene: Phaser.Scene,
    rect: Rect,
    background: number,
    art: string | undefined,
  ): Phaser.GameObjects.Rectangle | Phaser.GameObjects.TileSprite {
    const panel = art === undefined ? addPanel(scene, rect, background) : addTiledPanel(scene, rect, art);
    if (panel instanceof Phaser.GameObjects.TileSprite) this.tiles.push(panel);
    this.objects.push(panel);
    return panel;
  }

  /** 現在地カードはレーン左端に固定し、区切り線を挟んで右にスクロール領域を置く。 */
  private addPinnedSlot(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    rect: Rect,
    background: number,
    art: string | undefined,
    cardY: number,
    pinned: CardContent,
  ): Phaser.GameObjects.Rectangle | Phaser.GameObjects.TileSprite {
    const margin = metrics.px(SIZE.margin);
    const gap = metrics.px(SIZE.gap);
    const cardWidth = metrics.px(SIZE.cardWidth);
    const dividerWidth = metrics.px(4);

    const panel = this.addBackground(
      scene,
      { ...rect, width: margin + cardWidth + gap + dividerWidth },
      background,
      art,
    );
    this.objects.push(new Card(scene, metrics, rect.x + margin, cardY, pinned));

    const cardHeight = metrics.px(SIZE.cardHeight);
    const divider = scene.add.rectangle(
      rect.x + margin + cardWidth + gap + dividerWidth / 2,
      cardY + cardHeight / 2,
      dividerWidth,
      cardHeight,
      COLOR.laneDivider,
      0.35,
    );
    this.objects.push(divider);
    return panel;
  }
}

/** 2枚のカードが同じものを映しているか（identityが1つでも重なるか、Card.identity参照）。 */
function sharesIdentity(a: CardContent, b: CardContent): boolean {
  if (a.identity === undefined || b.identity === undefined) return false;
  return a.identity.some((id) => b.identity?.includes(id) === true);
}
