import Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import type { CardContent } from './Card';
import { Card, CellHighlight, CellOverlay, EmptyCard } from './Card';
import type { LaneCell } from './laneCells';
import { ScrollArea } from '../../ui/scrollArea';
import { COLOR, SIZE } from '../looks/theme';
import { addInputBlockingPanel, addInputBlockingTiledPanel } from '../../ui/shapes';
import { ScrollIndicator } from './ScrollIndicator';
import type { HazeSurface, HazeTarget } from './LaneHaze';

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
 * カードの左右のうち、カード本体ではなく周り——落とし先としては隙間、ドラッグの始まりとしてはレーン
 * ——として扱う幅の比。カード同士の実際の隙間（12u）は狭く、そのままでは隙間を狙うのも
 * レーンを掴むのも難しいため、その手前を周り側へ寄せる。
 */
const CARD_EDGE_RATIO = 1 / 4;

/** 隙間を示す帯の幅（u単位）。 */
const INSERT_MARK_WIDTH = 10;

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
   * 表示物を置く層（省略すると既定の0）。レーンだけを作り直しても描画順を保ちたい場合に、
   * 周りより奥の層を指定する（SCREEN_DEPTH.field）。
   */
  readonly depth?: number;
  /**
   * 背景板と左右の余白を持たないレーンか。**矩形がそのまま枠の並びになる**ので、札1枚ぶんの場所
   * （ポートレイト、子ウィンドウが映すオブジェクトのカード）に置ける。板が無いぶん横ドラッグでの
   * スクロールはできないが、そもそも送る先が無い場所のためのもの。
   */
  readonly bare?: boolean;
}

/**
 * レーンの枠に居る札1枚と、その居場所。**添字と矩形は枠の並びから導かれる**ので、レーンの外で
 * 添字から矩形を引き直す（cellRect）必要は無い。
 */
export interface LanePlacement {
  readonly index: number;
  readonly card: Card;
  readonly rect: Rect;
}

/** レーンの内容を差し替えた結果。出入りするカードの見せ方は呼び出し側（CardTable）が決める。 */
export interface LaneUpdate {
  /** このレーンに新しく現れたカード。stripの所定の位置に居るが、まだ表示されていない。 */
  readonly entered: readonly { readonly card: Card; readonly index: number }[];
  /** このレーンから居なくなったカード。stripからは外してあるが、破棄は呼び出し側が行う。 */
  readonly left: readonly Card[];
}

/**
 * フィールドエリアの1レーン。カードは横スクロールで送る（ScreenLayout.md 7節 フィールドエリア）。
 *
 * レーンからはみ出したカードは切り抜かず、隣接エリアの背景板が上から覆って隠す。
 * ロケーションレーンの現在地カードも同様に、スクロール領域より後に描いて上へ重ねる。
 *
 * **並ぶ単位は枠（LaneCell）で、位置＝添字**。表示は**背景 → カード → 重ねる物**の3層で、カードの
 * 居ない枠の破線と枠を強調する縁が1層目、カードに重ねる文字が3層目に入る（CardView.md 11節）。
 *
 * 内容が変わったときは作り直さずreconcileで差し替える。同じインスタンスを映しているカードは
 * そのまま残して新しい位置へ滑らせ、出入りするカードだけを呼び出し側へ渡す。**カードを作るのも
 * 消すのも呼び出し側（CardTable）**——レーンは枠の幾何と、枠に居る間の置き場所だけを受け持つ。
 */
export class CardLane {
  /** レーンの矩形。ドロップ先の判定（dropTargetAt）に使う。 */
  readonly rect: Rect;

  /** ピン留めしたカードの矩形（持たないレーンではundefined）。 */
  readonly pinnedRect: Rect | undefined;

  private readonly scene: Phaser.Scene;
  private readonly metrics: ScreenMetrics;
  private readonly strip: Phaser.GameObjects.Container;

  /**
   * 枠の3層（CardView.md 11節）。器として先に作っておくことで、カードが出入りしても空き枠が手前へ
   * 出たり、枠の縁と重ねた文字がカードの下へ潜ったりしない。
   */
  private readonly cellLayer: Phaser.GameObjects.Container;
  private readonly cardLayer: Phaser.GameObjects.Container;
  private readonly overlayLayer: Phaser.GameObjects.Container;

  /** 並んでいる枠。位置＝添字。 */
  private _cells: readonly LaneCell[] = [];

  /** 並んでいるカードの表示物。空き枠はundefined。位置＝添字（_cellsと対応）。 */
  private _cardObjects: (Card | undefined)[] = [];

  /** 今このレーンの枠に居る札を、居場所付きで挙げる（空き枠は飛ばす）。 */
  get placements(): readonly LanePlacement[] {
    const placed: LanePlacement[] = [];
    this._cardObjects.forEach((card, index) => {
      if (card !== undefined) placed.push({ index, card, rect: this.cellRect(index) });
    });
    return placed;
  }

  /** その札が居る枠の添字（このレーンに居なければundefined）。 */
  indexOf(card: Card): number | undefined {
    const index = this._cardObjects.indexOf(card);
    return index < 0 ? undefined : index;
  }

  /** スクロール量0のときのstripの位置と、可視域の幅。 */
  private readonly originX: number;
  private readonly stripWidth: number;

  /** はみ出した分の送り（ScrollArea）。ドラッグもホイールも切り抜きもこれが持つ。 */
  private readonly scroll: ScrollArea;

  /** 送り具合を示すスクロールバー。送る必要が無いときは自分で姿を消す。 */
  private readonly scrollIndicator: ScrollIndicator;

  /** カード1枚分の送り幅（カード幅＋ギャップ）とカードの実寸。 */
  private readonly pitch: number;
  private readonly cardWidth: number;
  private readonly cardHeight: number;
  private readonly cardY: number;
  private readonly insertMarkWidth: number;

  /**
   * stripに属さない表示物（背景板・ピン留め部分）。カードはstripごと消えるが、これらは
   * 個別に破棄しないと残ってしまう（背景板は入力も吸い続ける）。
   */
  private readonly ownedObjects: (Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Depth)[] = [];

  /**
   * 絵を敷いた背景板のうち、カードと同じだけ横へ送るもの（背景色だけのレーンでは空）。スクロールの
   * たびに敷き位置を更新する。ピン留め部分の背景板は固定なので含めない（addPinnedCell参照）。
   */
  private readonly scrollingBackgroundTiles: Phaser.GameObjects.TileSprite[] = [];

  /**
   * 陽炎を掛ける表示物（LaneHaze参照）。ピン留め部分の背景板・現在地カード・区切り線も含めて、
   * レーンに見えているものをすべて挙げる。一部だけを歪ませると、そこに境目が見えてしまう。
   */
  private readonly hazeTargets: HazeTarget[] = [];

  /**
   * 陽炎を掛けるための面（LaneHaze参照）。レーンに見えているものを1枚の空気の下に置く。
   * 地面の絵が無いレーン（背景色だけ）には掛けようがないのでundefined。
   */
  get hazeSurface(): HazeSurface | undefined {
    return this.scrollingBackgroundTiles.length === 0
      ? undefined
      : { objects: this.hazeTargets, rect: this.rect };
  }

  constructor(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    rect: Rect,
    background: number,
    cells: readonly LaneCell[],
    options: CardLaneOptions = {},
  ) {
    const { pinned } = options;
    const bare = options.bare === true;
    const margin = bare ? 0 : metrics.px(SIZE.margin);
    const gap = metrics.px(SIZE.gap);
    const cardWidth = metrics.px(SIZE.cardWidth);
    const dividerWidth = metrics.px(4);
    const cardY = rect.y + (rect.height - metrics.px(SIZE.cardHeight)) / 2;

    this.scene = scene;
    this.metrics = metrics;
    this.rect = rect;

    const panel = bare ? undefined : this.addBackground(rect, background, options.art);

    const pinnedWidth = pinned === undefined ? 0 : cardWidth + gap + dividerWidth + gap;
    const stripX = rect.x + margin + pinnedWidth;
    this.pitch = cardWidth + gap;
    this.cardWidth = cardWidth;
    this.cardHeight = metrics.px(SIZE.cardHeight);
    this.cardY = cardY;
    this.insertMarkWidth = metrics.px(INSERT_MARK_WIDTH);
    this.originX = stripX;
    this.stripWidth = Math.max(0, rect.x + rect.width - margin - stripX);
    this.strip = scene.add.container(stripX, cardY);
    this.hazeTargets.push(this.strip);

    this.cellLayer = scene.add.container(0, 0);
    this.cardLayer = scene.add.container(0, 0);
    this.overlayLayer = scene.add.container(0, 0);
    this.strip.add([this.cellLayer, this.cardLayer, this.overlayLayer]);

    // バーはカードより後に作り、カードの上へ重ねる。
    this.scrollIndicator = new ScrollIndicator(
      scene,
      metrics,
      stripX,
      cardY + this.cardHeight + metrics.px(SIZE.scrollBarGap),
      this.stripWidth,
    );
    this.ownedObjects.push(this.scrollIndicator);

    this.pinnedRect =
      pinned === undefined
        ? undefined
        : { x: rect.x + margin, y: cardY, width: cardWidth, height: this.cardHeight };
    const pinnedPanel =
      pinned === undefined ? undefined : this.addPinnedCell(rect, background, options.art, cardY, pinned);

    // ピン留め部分は背景板が上に重なりレーン本体がホイールを受け取れないので、そちらも面に含める。
    this.scroll = new ScrollArea(scene, {
      axis: 'x',
      content: this.strip,
      viewport: { x: stripX, y: rect.y, width: this.stripWidth, height: rect.height },
      inputSurfaces: [panel, pinnedPanel].filter((target) => target !== undefined),
      readout: this.scrollIndicator,
      clip: options.clip === true,
      // 背景の絵もカードと同じだけ送る（地面の上を送る見え方）。
      onScroll: (offset) => {
        // tilePositionXは絵の側の座標なので、敷くときにかけた倍率で割り戻す。
        for (const tile of this.scrollingBackgroundTiles) tile.tilePositionX = -offset / tile.tileScaleX;
      },
    });

    // カードはまだ作らない（作るのはCardTable）。枠の装飾と送り幅だけを整える。
    // **送りを組み立ててから**——枠の並びがそのまま送れる範囲になる（applyCells）。
    this.applyCells(cells);

    // カードはstripの子なので、stripと自前の表示物を移せば並んでいるカードごと同じ層へ移る。
    if (options.depth !== undefined) {
      this.strip.setDepth(options.depth);
      for (const object of this.ownedObjects) object.setDepth(options.depth);
    }
  }

  /** レーンごと片付ける（子ウィンドウを閉じるとき）。カード自体はstripの破棄でまとめて消える。 */
  destroy(): void {
    this.strip.destroy();
    for (const object of this.ownedObjects) object.destroy();
    this.ownedObjects.length = 0;
    this.scroll.destroy();
  }

  /**
   * 並べる枠を差し替える。同じインスタンスを映しているカード（identityが1つでも重なるもの）は
   * 作り直さず、新しい位置へ滑らせる。新しく現れる内容の札はcreateで作らせて所定の位置に置くが、
   * どこから来たのかはこのレーンには分からないので、非表示のまま呼び出し側へ渡す。
   */
  reconcile(cells: readonly LaneCell[], create: (content: CardContent) => Card): LaneUpdate {
    const reusable = this._cardObjects.filter((card): card is Card => card !== undefined);
    const entered: { card: Card; index: number }[] = [];

    this._cardObjects = cells.map(({ card: content }, index) => {
      if (content === undefined) return undefined;

      const found = reusable.findIndex((card) => sharesIdentity(card.content, content));
      if (found < 0) {
        const card = create(content);
        card.setPosition(index * this.pitch, 0);
        this.cardLayer.add(card);
        entered.push({ card, index });
        return card;
      }

      const [card] = reusable.splice(found, 1);
      card.setContent(content);
      card.slideToX(index * this.pitch);
      return card;
    });

    for (const card of reusable) this.cardLayer.remove(card);
    this.applyCells(cells);

    return { entered, left: reusable };
  }

  /** 枠の装飾と送り幅を、並べる枠に合わせる。 */
  private applyCells(cells: readonly LaneCell[]): void {
    this._cells = cells;
    this.resetDecorations();

    // 空き枠も送れる範囲に含める（画面外に置いたままでは受け皿にならない）。
    const contentWidth = cells.length === 0 ? 0 : cells.length * this.pitch - (this.pitch - this.cardWidth);
    this.scroll.setContentLength(contentWidth);
  }

  /**
   * 枠の1層目（空き枠の背景・強調の縁）と3層目（重ねる文字）を作り直す。どちらも位置以外の状態を
   * 持たないので、カードのように残して動かす必要が無い。
   */
  private resetDecorations(): void {
    this.cellLayer.removeAll(true);
    this.overlayLayer.removeAll(true);

    this._cells.forEach((cell, index) => {
      const x = index * this.pitch;
      if (cell.card === undefined) {
        this.cellLayer.add(new EmptyCard(this.scene, this.metrics, x, 0, cell.accepts));
      }
      if (cell.borderColor !== undefined) {
        this.cellLayer.add(new CellHighlight(this.scene, this.metrics, x, 0, cell.borderColor));
      }
      if (cell.overlay !== undefined) {
        this.overlayLayer.add(new CellOverlay(this.scene, this.metrics, x, 0, cell.overlay));
      }
    });
  }

  /** 添字の位置の枠の、画面上の矩形。 */
  cellRect(index: number): Rect {
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
    this.scroll.beginDrag();
  }

  /** beginScrollの時点からのポインタの移動量を、スクロール量へ反映する。 */
  scrollByDrag(deltaX: number): void {
    this.scroll.dragTo(deltaX);
  }

  /**
   * 画面上の1点が指すドロップ先（レーンの外ならundefined）。
   *
   * カードの中央部分だけを「そのカードに重ねた」とみなし、左右のCARD_EDGE_RATIO分とカード同士の隙間は
   * 「隙間へ落とした」として扱う。空き枠は送り幅いっぱいが「その枠へ落とした」——枠が見えている以上、
   * 狙うのは両隣の隙間ではなく枠そのものになるため。**並びの末尾より右も、末尾が空き枠ならその枠**
   * （受け皿の枠は並びの終わりそのもので、その先に別の落とし先は無い）。
   */
  dropTargetAt(x: number, y: number): LaneDropTarget | undefined {
    if (x < this.rect.x || x >= this.rect.x + this.rect.width) return undefined;
    if (y < this.rect.y || y >= this.rect.y + this.rect.height) return undefined;

    const count = this._cells.length;
    const localX = x - this.strip.x;
    const index = Math.floor(localX / this.pitch);
    if (index < 0) return { kind: 'gap', index: 0 };
    if (index >= count) {
      const last = count - 1;
      return last >= 0 && this._cells[last].card === undefined
        ? { kind: 'cell', index: last }
        : { kind: 'gap', index: count };
    }

    if (this._cells[index].card === undefined) return { kind: 'cell', index };

    // カード1枚分の送り幅のうち、カードの右側にはみ出した分がカード同士の実際の隙間。
    const offset = localX - index * this.pitch;
    if (offset >= this.cardWidth) return { kind: 'gap', index: index + 1 };
    if (offset < this.cardWidth * CARD_EDGE_RATIO) return { kind: 'gap', index };
    if (offset > this.cardWidth * (1 - CARD_EDGE_RATIO)) return { kind: 'gap', index: index + 1 };
    return { kind: 'combine', index };
  }

  /**
   * 画面上の1点が、添字のカードの本体を指しているか。カードの上から始まったドラッグが、そのカードを
   * 掴んだ操作なのかレーンの横スクロールなのかを見分けるのに使う（CardDragController参照）。
   * 本体とみなす範囲は落とし先の判定と同じで、左右のCARD_EDGE_RATIO分はレーン側に譲る。
   */
  isCardBody(x: number, y: number, index: number): boolean {
    const target = this.dropTargetAt(x, y);
    return target?.kind === 'combine' && target.index === index;
  }

  /** ドロップ先を示す枠の位置（カード・空き枠ならその枠そのもの、隙間なら細い縦帯）。 */
  dropIndicatorRect(target: LaneDropTarget): Rect {
    if (target.kind !== 'gap') return this.cellRect(target.index);

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
   * 背景板を1枚置く。絵があれば敷き、無ければ背景色で塗る。どちらも入力を遮る（addInputBlockingPanel参照）。
   * 置いた板は自分で片付ける（ownedObjects）。scrollsWithCardsを倒すと、絵をスクロールで送る対象から外す。
   */
  private addBackground(
    rect: Rect,
    background: number,
    art: string | undefined,
    scrollsWithCards = true,
  ): Phaser.GameObjects.Rectangle | Phaser.GameObjects.TileSprite {
    const { scene } = this;
    // 絵が用意されていても届いていなければ（遅延ロードの失敗時）背景色へ落とす（Cardの絵文字代用と同じ姿勢）。
    const texture = art !== undefined && scene.textures.exists(art) ? art : undefined;
    const panel =
      texture === undefined
        ? addInputBlockingPanel(scene, rect, background)
        : addInputBlockingTiledPanel(scene, rect, texture);
    if (panel instanceof Phaser.GameObjects.TileSprite && scrollsWithCards)
      this.scrollingBackgroundTiles.push(panel);
    if (panel instanceof Phaser.GameObjects.TileSprite) this.hazeTargets.push(panel);
    this.ownedObjects.push(panel);
    return panel;
  }

  /**
   * 現在地カードはレーン左端に固定し、区切り線を挟んで右にスクロール領域を置く。
   *
   * 背景板もカードと一緒に固定する（scrollToの対象から外す）。スクロール量0では下のレーン背景と
   * 同じ位置に敷かれるため1枚の絵として繋がり、送っている間だけ区切り線を境に地面が分かれて見える。
   */
  private addPinnedCell(
    rect: Rect,
    background: number,
    art: string | undefined,
    cardY: number,
    pinned: CardContent,
  ): Phaser.GameObjects.Rectangle | Phaser.GameObjects.TileSprite {
    const { scene, metrics } = this;
    const margin = metrics.px(SIZE.margin);
    const gap = metrics.px(SIZE.gap);
    const cardWidth = metrics.px(SIZE.cardWidth);
    const dividerWidth = metrics.px(4);

    const panel = this.addBackground(
      { ...rect, width: margin + cardWidth + gap + dividerWidth },
      background,
      art,
      false,
    );
    const pinnedCard = new Card(scene, metrics, rect.x + margin, cardY, pinned);
    this.ownedObjects.push(pinnedCard);
    this.hazeTargets.push(pinnedCard);

    const cardHeight = metrics.px(SIZE.cardHeight);
    const divider = scene.add.rectangle(
      rect.x + margin + cardWidth + gap + dividerWidth / 2,
      cardY + cardHeight / 2,
      dividerWidth,
      cardHeight,
      COLOR.laneDivider,
      0.35,
    );
    this.ownedObjects.push(divider);
    this.hazeTargets.push(divider);
    return panel;
  }
}

/**
 * 2枚のカードが同じものを映しているか（CardContent.identity参照）。**帰りを待っているぶん（awaited）も
 * 見る**——借りた1枚を出している間は名乗る個体が0になる枠があり、そこが帰ってきた札と繋がらないと、
 * 印だったはずの枠が別のカードとして作り直されてしまう。
 */
function sharesIdentity(a: CardContent, b: CardContent): boolean {
  const keys = new Set([...(a.identity ?? []), ...(a.awaited ?? [])]);
  return [...(b.identity ?? []), ...(b.awaited ?? [])].some((id) => keys.has(id));
}
