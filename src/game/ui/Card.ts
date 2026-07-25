import Phaser from 'phaser';
import type { ScreenMetrics } from '../layout/ScreenMetrics';
import { COLOR, FONT_FAMILY, SIZE, cssColor } from './theme';
import { drawBox } from './shapes';
import { wrapByCharacter } from './textLayout';

/** カード名の最大行数。これを超える分は表示しない（モックの-webkit-line-clamp: 3に対応）。 */
const NAME_MAX_LINES = 3;

/** 押下中の沈み込み表現（Buttonと同じ）。 */
const PRESSED_ALPHA = 0.6;

/** 端の操作エリアの高さ（カード高さに対する比）。 */
const EDGE_RATIO = 1 / 6;

/** 押している間だけ出す、端の操作エリアのオーバーレイの濃さと矢印の大きさ（u単位）。 */
const EDGE_OVERLAY_ALPHA = 0.55;
const EDGE_ARROW_SIZE = 44;

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
  /** カード全体を押したときの動作。持たないカードは押せない（押すと子ウィンドウを開くロケーションカード等）。 */
  readonly onTap?: () => void;
  /** 端だけを押したときの動作。端ではカード全体の動作より優先される。 */
  readonly edge?: CardEdgeAction;
}

/**
 * フィールド・ハンド・ポートレイトに共通のカード。
 * 大きなアイコンを中央に敷き、名前を左上へ重ねる（ScreenLayout.md デザインメモ）。
 */
export class Card extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number, content: CardContent) {
    super(scene, x, y);
    const { icon, name } = content;

    const width = metrics.px(SIZE.cardWidth);
    const height = metrics.px(SIZE.cardHeight);

    const face = scene.add.graphics();
    drawBox(
      face,
      { x: 0, y: 0, width, height },
      {
        fill: COLOR.cardFace,
        fillAlpha: 0.85,
        border: COLOR.cardBorder,
        borderWidth: Math.max(1, metrics.px(2)),
        radius: metrics.px(SIZE.radius),
      },
    );

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
    if (content.onTap !== undefined) this.makeTappable(width, height, content.onTap);
    if (content.edge !== undefined) this.addEdge(scene, metrics, width, height, content.edge);
    scene.add.existing(this);
  }

  /** Containerのdisplay originによるヒット領域のずれを避ける理由はButtonと同じ（サイズを設定しない）。 */
  private makeTappable(width: number, height: number, onTap: () => void): void {
    this.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
    this.on('pointerdown', () => this.setAlpha(PRESSED_ALPHA));
    this.on('pointerout', () => this.setAlpha(1));
    this.on('pointerup', () => {
      this.setAlpha(1);
      onTap();
    });
  }

  /**
   * 隣のレーンへ移すための端の操作エリア。押している間だけ半透明のオーバーレイと矢印を出し、
   * どちら向きの操作なのかを示す。
   *
   * ヒット領域はカード本体の後に足す。Phaserは重なった対象を描画順の後ろから拾うため、これで
   * 端ではカード全体の操作より先に反応し、stopPropagationで本体側へは渡さない。透明でも描画される
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

    onEdgePointer(hitArea, 'pointerdown', () => feedback.setVisible(true));
    onEdgePointer(hitArea, 'pointerup', () => {
      feedback.setVisible(false);
      edge.onTap();
    });
    hitArea.on('pointerout', () => feedback.setVisible(false));

    this.add([feedback, hitArea]);
  }
}

/** カード本体へイベントを渡さずに、端のヒット領域だけで処理する。 */
function onEdgePointer(
  hitArea: Phaser.GameObjects.Rectangle,
  event: 'pointerdown' | 'pointerup',
  handle: () => void,
): void {
  hitArea.on(
    event,
    (_pointer: Phaser.Input.Pointer, _x: number, _y: number, data: Phaser.Types.Input.EventData) => {
      data.stopPropagation();
      handle();
    },
  );
}

/**
 * 中身の無い固定枠を示すカード。固定枠スロット（fixed_positions、SlotSystem.md 3節）は空でも位置を
 * 保つため、枠だけを破線で描いて「ここは空いている」と分かるようにする。
 */
export class EmptyCard extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number) {
    super(scene, x, y);

    const face = scene.add.graphics();
    drawBox(
      face,
      { x: 0, y: 0, width: metrics.px(SIZE.cardWidth), height: metrics.px(SIZE.cardHeight) },
      {
        fill: COLOR.cardFace,
        fillAlpha: 0.35,
        border: COLOR.cardBorder,
        borderWidth: Math.max(1, metrics.px(2)),
        radius: metrics.px(SIZE.radius),
        dashed: true,
      },
    );

    this.add(face);
    scene.add.existing(this);
  }
}
