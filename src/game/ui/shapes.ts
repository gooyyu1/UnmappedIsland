import type Phaser from 'phaser';
import type { Rect } from '../layout/ScreenMetrics';

/** 角丸矩形の塗り・枠線の指定。枠線を省くと塗りだけを描く。 */
export interface BoxStyle {
  readonly fill?: number;
  readonly fillAlpha?: number;
  readonly border?: number;
  readonly borderWidth?: number;
  readonly radius?: number;
  /** 空きスロットのような「まだ中身が無い」枠は破線で描く（StartScreen_Mock.htmlのborder-style: dashed）。 */
  readonly dashed?: boolean;
}

/**
 * エリアの背景板を置く。塗りつぶしに加えて、ポインタイベントを飲み込む役目を持つ。
 *
 * フィールドエリアのカードはレーンからはみ出しても切り抜かず、隣接エリアの背景板を上に重ねて
 * 隠している（PlayScene参照）。背景板が入力を受け取らないと、隠れているはずのカードが
 * タップに反応してしまうため、背景板自身が必ず入力を遮る。
 */
export function addPanel(
  scene: Phaser.Scene,
  rect: Rect,
  color: number,
  alpha = 1,
): Phaser.GameObjects.Rectangle {
  return scene.add
    .rectangle(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width, rect.height, color, alpha)
    .setInteractive();
}

/**
 * 背景板を絵で敷く（addPanelの絵版。入力を遮る役目も同じ）。
 *
 * 絵は矩形の高さいっぱいになるよう縦横同率で拡大縮小し、横方向は足りない分を繰り返して埋める。
 * 敷いた絵を横へ送るのは呼び出し側（CardLane.scrollTo）。
 */
export function addTiledPanel(
  scene: Phaser.Scene,
  rect: Rect,
  texture: string,
): Phaser.GameObjects.TileSprite {
  const tile = scene.add.tileSprite(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
    rect.width,
    rect.height,
    texture,
  );
  const scale = rect.height / tile.frame.height;
  return tile.setTileScale(scale, scale).setInteractive();
}

/** 角丸矩形を描く。座標はgraphicsのローカル座標。 */
export function drawBox(graphics: Phaser.GameObjects.Graphics, rect: Rect, style: BoxStyle): void {
  const radius = style.radius ?? 0;
  if (style.fill !== undefined) {
    graphics.fillStyle(style.fill, style.fillAlpha ?? 1);
    graphics.fillRoundedRect(rect.x, rect.y, rect.width, rect.height, radius);
  }
  if (style.border === undefined) return;

  const borderWidth = style.borderWidth ?? 1;
  graphics.lineStyle(borderWidth, style.border, 1);
  if (style.dashed) strokeDashedBox(graphics, rect, radius, borderWidth * DASH_LENGTH_RATIO);
  else graphics.strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, radius);
}

/** 破線1本分の長さを線の太さの何倍にするか（線と空きは同じ長さ）。 */
const DASH_LENGTH_RATIO = 6;

/** 角丸矩形の枠を破線で描く。角の丸みは短いので実線のまま繋ぐ。 */
function strokeDashedBox(
  graphics: Phaser.GameObjects.Graphics,
  rect: Rect,
  radius: number,
  dashLength: number,
): void {
  const { x, y, width, height } = rect;
  dashedLine(graphics, x + radius, y, x + width - radius, y, dashLength);
  dashedLine(graphics, x + width, y + radius, x + width, y + height - radius, dashLength);
  dashedLine(graphics, x + width - radius, y + height, x + radius, y + height, dashLength);
  dashedLine(graphics, x, y + height - radius, x, y + radius, dashLength);

  graphics.beginPath();
  graphics.arc(x + width - radius, y + radius, radius, -Math.PI / 2, 0);
  graphics.arc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2);
  graphics.arc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI);
  graphics.arc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5);
  graphics.strokePath();
}

function dashedLine(
  graphics: Phaser.GameObjects.Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dashLength: number,
): void {
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length === 0 || dashLength <= 0) return;

  const unitX = (x2 - x1) / length;
  const unitY = (y2 - y1) / length;
  for (let drawn = 0; drawn < length; drawn += dashLength * 2) {
    const dash = Math.min(dashLength, length - drawn);
    graphics.lineBetween(
      x1 + unitX * drawn,
      y1 + unitY * drawn,
      x1 + unitX * (drawn + dash),
      y1 + unitY * (drawn + dash),
    );
  }
}
