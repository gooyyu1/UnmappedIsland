import Phaser from 'phaser';
import type { ScreenMetrics } from '../layout/ScreenMetrics';
import { COLOR, FONT_FAMILY, SIZE, cssColor } from './theme';
import { drawBox } from './shapes';
import { wrapByCharacter } from './textLayout';

/**
 * カードの枠の画像のテクスチャキー（実体はpublic/images/card_frame.png、BootSceneが読む）。
 * カードの寸法（SIZE.cardWidth/cardHeight）はこの画像の比率に合わせてある。
 */
export const CARD_FRAME_TEXTURE = 'card-frame';

/** 空き枠は同じ枠の画像を薄く敷いて表す。 */
const EMPTY_FRAME_ALPHA = 0.35;

/** カード名の最大行数。これを超える分は表示しない（モックの-webkit-line-clamp: 3に対応）。 */
const NAME_MAX_LINES = 3;

/** 押下中の沈み込み表現（Buttonと同じ）。 */
const PRESSED_ALPHA = 0.6;

/** 端の操作エリアの高さ（カード高さに対する比）。 */
const EDGE_RATIO = 1 / 6;

/** 押している間だけ出す、端の操作エリアのオーバーレイの濃さと矢印の大きさ（u単位）。 */
const EDGE_OVERLAY_ALPHA = 0.55;
const EDGE_ARROW_SIZE = 44;

/** スタック数を囲む丸の直径・カードの右上からの余白・中の数字の大きさ（u単位）。 */
const STACK_BADGE_SIZE = 56;
const STACK_BADGE_MARGIN = 6;
const STACK_COUNT_SIZE = 32;

/** 移動先のレーンがカードのどちら側にあるか。 */
export type CardEdgeDirection = 'up' | 'down';

/** カードの端（上下1/6）を押したときの操作。 */
export interface CardEdgeAction {
  readonly direction: CardEdgeDirection;
  readonly onTap: () => void;
}

/** カード1枚の表示内容と操作。 */
export interface CardContent {
  readonly icon: string;
  readonly name: string;
  /**
   * 内容を差し替えたときに「前と同じカード」だと分かるための識別子（映しているインスタンスのID）。
   * 1枚が複数のインスタンス（スタック）を表すことがあるので集合で持ち、1つでも重なれば同じカードと
   * みなす。省略したカードは差し替えのたびに別のカードとして扱われる。
   */
  readonly identity?: readonly number[];
  /** 1枚が映しているインスタンスの数。2以上のときだけ、右上に丸で囲んだ数字として出す。 */
  readonly count?: number;
  /** カード全体を押したときの動作。持たないカードは押せない（押すと子ウィンドウを開くロケーションカード等）。 */
  readonly onTap?: () => void;
  /** 端だけを押したときの動作。端ではカード全体の動作より優先される。 */
  readonly edge?: CardEdgeAction;
  /** 掴んで他のカード・レーンへ落とせるカードか。ドラッグ中の扱いはCardDragController。 */
  readonly draggable?: boolean;
}

/**
 * フィールド・ハンド・ポートレイトに共通のカード。
 * 大きなアイコンを中央に敷き、名前を左上へ重ねる（ScreenLayout.md デザインメモ）。
 */
export class Card extends Phaser.GameObjects.Container {
  private _content: CardContent;
  get content(): CardContent {
    return this._content;
  }

  /** カードの実寸。ドラッグ中の分身やドロップ先の枠を同じ大きさで描くために公開する。 */
  readonly cardWidth: number;
  readonly cardHeight: number;

  /** スタック数の表示。個数は差し替えのたびに変わるので、作り直さず書き換える。 */
  private readonly stackBadge: Phaser.GameObjects.Container;
  private readonly stackCount: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number, content: CardContent) {
    super(scene, x, y);
    const { icon, name } = content;

    const width = metrics.px(SIZE.cardWidth);
    const height = metrics.px(SIZE.cardHeight);
    this._content = content;
    this.cardWidth = width;
    this.cardHeight = height;

    const face = addFrame(scene, metrics, width, height, false);

    const iconText = scene.add
      .text(width / 2, height / 2, icon, {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(96)}px`,
      })
      .setOrigin(0.5)
      .setAlpha(0.95);

    const inset = metrics.px(8);
    const nameText = scene.add
      .text(inset, metrics.px(6), name, {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(30)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.text),
        maxLines: NAME_MAX_LINES,
      })
      .setLineSpacing(metrics.px(2))
      .setShadow(0, 0, cssColor(COLOR.cardFace), metrics.px(3), false, true);
    nameText.setWordWrapCallback(wrapByCharacter(width - inset * 2));

    this.add([face, iconText, nameText]);
    if (content.onTap !== undefined || content.draggable === true) this.makeInteractive(width, height);
    if (content.onTap !== undefined) this.makeTappable();
    // ドラッグはレーンの横スクロールと同じPhaserのdrag機構で受ける。重なった対象は最前面の1つだけが
    // 入力を受け取る（InputPlugin.topOnly）ため、カードを掴んでいる間レーンはスクロールしない。
    // 端の操作エリア（addEdge）はカードより手前にあってドラッグ対象ではないので、そこからは始まらない。
    if (content.draggable === true) scene.input.setDraggable(this);
    if (content.edge !== undefined) this.addEdge(scene, metrics, width, height, content.edge);

    // スタック数は端の操作エリアより後に足して、オーバーレイが出ている間も読めるようにする。
    this.stackCount = scene.add
      .text(0, 0, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(STACK_COUNT_SIZE)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.text),
      })
      .setOrigin(0.5);
    this.stackBadge = this.addStackBadge(scene, metrics, width);
    this.add(this.stackBadge);
    this.showStackCount();

    scene.add.existing(this);
  }

  /**
   * 同じインスタンスを映し続けるカードの表示内容を差し替える。アイコン・名前・端の向きは変わらない
   * 前提で、スタック数と、操作の実体（毎回作り直されるクロージャ）だけを新しくする。
   */
  setContent(content: CardContent): void {
    this._content = content;
    this.showStackCount();
  }

  /** スタック数を囲む丸。数字はスタックが増減しても位置が動かないよう、丸の中心へ固定する。 */
  private addStackBadge(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    width: number,
  ): Phaser.GameObjects.Container {
    const size = metrics.px(STACK_BADGE_SIZE);
    const margin = metrics.px(STACK_BADGE_MARGIN);
    const radius = size / 2;

    const circle = scene.add.graphics();
    circle.fillStyle(COLOR.cardFace, 1);
    circle.fillCircle(0, 0, radius);
    circle.lineStyle(Math.max(1, metrics.px(3)), COLOR.cardBorder, 1);
    circle.strokeCircle(0, 0, radius);

    return scene.add.container(width - margin - radius, margin + radius, [circle, this.stackCount]);
  }

  private showStackCount(): void {
    const count = this._content.count ?? 1;
    this.stackBadge.setVisible(count >= 2);
    this.stackCount.setText(String(count));
  }

  /** Containerのdisplay originによるヒット領域のずれを避ける理由はButtonと同じ（サイズを設定しない）。 */
  private makeInteractive(width: number, height: number): void {
    this.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
  }

  private makeTappable(): void {
    this.on('pointerdown', () => this.setAlpha(PRESSED_ALPHA));
    this.on('pointerout', () => this.setAlpha(1));
    this.on('pointerup', () => {
      this.setAlpha(1);
      this._content.onTap?.();
    });
  }

  /**
   * 隣のレーンへ移すための端の操作エリア。押している間だけ半透明のオーバーレイと矢印を出し、
   * どちら向きの操作なのかを示す。
   *
   * ヒット領域はカード本体の後に足す。重なった対象のうち描画順が最前面の1つだけが入力を受け取る
   * （InputPlugin.topOnly）ため、これで端はカード全体の操作もドラッグも横取りする。透明でも描画される
   * Rectangleを使うのは、Zoneが描画リストへ載らず前後関係が決まらないため。
   */
  private addEdge(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    width: number,
    height: number,
    edge: CardEdgeAction,
  ): void {
    const edgeHeight = height * EDGE_RATIO;
    const top = edge.direction === 'up' ? 0 : height - edgeHeight;
    const radius = metrics.px(SIZE.radius);

    const overlay = scene.add.graphics();
    overlay.fillStyle(COLOR.cardEdgeOverlay, EDGE_OVERLAY_ALPHA);
    overlay.fillRoundedRect(
      0,
      top,
      width,
      edgeHeight,
      edge.direction === 'up'
        ? { tl: radius, tr: radius, bl: 0, br: 0 }
        : { tl: 0, tr: 0, bl: radius, br: radius },
    );

    const arrow = scene.add
      .text(width / 2, top + edgeHeight / 2, edge.direction === 'up' ? '▲' : '▼', {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(EDGE_ARROW_SIZE)}px`,
        color: cssColor(COLOR.textOnDark),
      })
      .setOrigin(0.5);

    const feedback = scene.add.container(0, 0, [overlay, arrow]).setVisible(false);
    const hitArea = scene.add.rectangle(0, top, width, edgeHeight).setOrigin(0, 0).setInteractive();

    hitArea.on('pointerdown', () => feedback.setVisible(true));
    hitArea.on('pointerout', () => feedback.setVisible(false));
    hitArea.on('pointerup', () => {
      feedback.setVisible(false);
      this._content.edge?.onTap();
    });

    this.add([feedback, hitArea]);
  }
}

/**
 * 中身の無い固定枠を示すカード。固定枠スロット（fixed_positions、SlotSystem.md 3節）は空でも位置を
 * 保つため、枠だけを破線で描いて「ここは空いている」と分かるようにする。
 */
export class EmptyCard extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number) {
    super(scene, x, y);

    const face = addFrame(scene, metrics, metrics.px(SIZE.cardWidth), metrics.px(SIZE.cardHeight), true);

    this.add(face);
    scene.add.existing(this);
  }
}

/**
 * カードの枠。画像（CARD_FRAME_TEXTURE）があればそれを矩形いっぱいに貼り、無ければ図形で描く。
 * 画像を差し替えたり用意しなかったりしても画面が成り立つよう、図形の描画は残してある。
 *
 * emptyは中身の無い枠（EmptyCard）。画像なら薄く敷き、図形なら破線で描く。
 */
function addFrame(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  width: number,
  height: number,
  empty: boolean,
): Phaser.GameObjects.GameObject {
  if (scene.textures.exists(CARD_FRAME_TEXTURE)) {
    const image = scene.add.image(0, 0, CARD_FRAME_TEXTURE).setOrigin(0, 0).setDisplaySize(width, height);
    return empty ? image.setAlpha(EMPTY_FRAME_ALPHA) : image;
  }

  const face = scene.add.graphics();
  drawBox(
    face,
    { x: 0, y: 0, width, height },
    {
      fill: COLOR.cardFace,
      fillAlpha: empty ? 0.35 : 0.85,
      border: COLOR.cardBorder,
      borderWidth: Math.max(1, metrics.px(2)),
      radius: metrics.px(SIZE.radius),
      dashed: empty,
    },
  );
  return face;
}
