import type Phaser from 'phaser';
import type { Rect } from './Rect';

/** 角丸矩形の塗り・枠線の指定。枠線を省くと塗りだけを描く。 */
export interface BoxStyle {
  readonly fill?: number;
  readonly fillAlpha?: number;
  readonly border?: number;
  readonly borderWidth?: number;
  readonly radius?: number;
  /** 「まだ中身が無い」枠を破線で描く（CSSのborder-style: dashedにあたる）。 */
  readonly dashed?: boolean;
  /** 下地から浮いて見せる落ち影の、ずらし幅（px）。濃さと広がりはdrawBoxが決める。 */
  readonly shadow?: number;
}

/**
 * 背景板を置く。塗りつぶしに加えて、ポインタイベントを飲み込む役目を持つ。
 *
 * **背景板は必ず入力を遮る。** はみ出した表示物を切り抜かずに背景板で覆って隠す使い方があり、
 * 遮らないと、隠れているはずのものがタップに反応してしまう。
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
 * 絵を矩形いっぱいに敷く。高さが合うよう縦横同率で拡大縮小し、横方向は足りない分を繰り返して埋める。
 *
 * 入力は遮らない。区切りの帯のように他の要素へかぶせて置くものが、下の要素のタップを
 * 奪わないようにするため。
 */
export function addTiledImage(
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
  return tile.setTileScale(scale, scale);
}

/**
 * 絵を反時計回りに90度回して、縦向きに敷く（addTiledImageの縦版）。厚みは矩形の幅、繰り返す方向は
 * 矩形の高さになる。横向きの帯と同じ絵を縦の境目でも使うためのもので、絵を回した別ファイルは持たない。
 */
export function addTiledImageVertical(
  scene: Phaser.Scene,
  rect: Rect,
  texture: string,
): Phaser.GameObjects.TileSprite {
  // 回す前の寸法で作るので、幅と高さが入れ替わる。原点は中央なので、回しても矩形の中心は動かない。
  const tile = scene.add.tileSprite(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
    rect.height,
    rect.width,
    texture,
  );
  const scale = rect.width / tile.frame.height;
  return tile.setTileScale(scale, scale).setAngle(-90);
}

/**
 * 背景板を絵で敷く（addPanelの絵版。入力を遮る役目も同じ）。敷いた絵を送るのは呼び出し側。
 */
export function addTiledPanel(
  scene: Phaser.Scene,
  rect: Rect,
  texture: string,
): Phaser.GameObjects.TileSprite {
  return addTiledImage(scene, rect, texture).setInteractive();
}

/** 図形の意匠の既定（setShapeDefaults）。 */
export interface ShapeDefaults {
  /** 落ち影の各枚（ずらし幅の何倍の位置に、どの不透明度で置くか）。 */
  readonly shadowLayers: readonly (readonly [number, number])[];

  /** 破線1本分の長さを線の太さの何倍にするか（線と空きは同じ長さ）。 */
  readonly dashLengthRatio: number;
}

/**
 * 影の重ね方と破線の刻み。**意匠は起動時に外から入れる**（setShapeDefaults、labels.tsと同じ形）。
 * 入れなくても形になる値を持つので、意匠を持たない画面でも図形が消えることはない——影は1枚、
 * 破線は太さの6倍で刻む。
 */
let defaults: ShapeDefaults = { shadowLayers: [[1, 0.3]], dashLengthRatio: 6 };

export function setShapeDefaults(next: ShapeDefaults): void {
  defaults = next;
}

/**
 * 角の丸みが辺に収まる大きさへ丸める。**丸みは辺の半分を超えられない**——Phaserのfill/strokeRoundedRectは
 * 右側の角の弧を `x + width - radius` を中心に描くので、幅が丸みの2倍より狭いと弧が矩形の左外へ膨らみ、
 * `)` が左へ貫通して見える。
 */
function fittingRadius(rect: Rect, radius: number): number {
  return Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
}

/** 角丸矩形を描く。座標はgraphicsのローカル座標。 */
export function drawBox(graphics: Phaser.GameObjects.Graphics, rect: Rect, style: BoxStyle): void {
  const radius = fittingRadius(rect, style.radius ?? 0);
  // 影は塗りより先に敷き、塗りで覆う。**ぼかせないので重ねて濃さを落とす**——何枚どの濃さで置くかは
  // 意匠が決める（setShapeDefaults）。色は黒に固定する。下地の明るさによらず、暗い側へ倒すほうが
  // 浮いて見えるため。
  if (style.shadow !== undefined) {
    for (const [distance, alpha] of defaults.shadowLayers) {
      graphics.fillStyle(0x000000, alpha);
      const offset = style.shadow * distance;
      graphics.fillRoundedRect(rect.x + offset, rect.y + offset, rect.width, rect.height, radius);
    }
  }
  if (style.fill !== undefined) {
    graphics.fillStyle(style.fill, style.fillAlpha ?? 1);
    graphics.fillRoundedRect(rect.x, rect.y, rect.width, rect.height, radius);
  }
  if (style.border === undefined) return;

  const borderWidth = style.borderWidth ?? 1;
  graphics.lineStyle(borderWidth, style.border, 1);
  if (style.dashed) strokeDashedBox(graphics, rect, radius, borderWidth * defaults.dashLengthRatio);
  else graphics.strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, radius);
}

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
