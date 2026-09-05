import type Phaser from 'phaser';

/** 断片のフレーム名（列・行はいずれも0が先頭）。 */
function frameNameOf(column: number, row: number): string {
  return `nine:${column}${row}`;
}

/**
 * 9patchで絵を敷く。四隅は原寸のまま、上下の辺は横だけ、左右の辺は縦だけ、中央は両方向へ引き伸ばす。
 *
 * **PhaserのNineSliceはCanvasレンダラを持たない**（`renderCanvas`がNOOP）。WebGLの無い環境では絵が
 * まるごと消えるため、レンダラを問わないImageを9枚並べて同じものを組む。
 *
 * 返すのはwidth×heightの矩形を占めるコンテナで、中身は左上を原点に並ぶ。呼び出し側はこれを1つの
 * 表示物として拡大縮小・回転できる。入力は遮らない（必要なら呼び出し側が当たり判定を付ける）。
 */
export function addNineSlice(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  border: number,
): Phaser.GameObjects.Container {
  const source = scene.textures.get(key).source[0];
  ensureSliceFrames(scene, key, source.width, source.height, border);

  const columns = sliceSpans(width, border);
  const rows = sliceSpans(height, border);
  const pieces: Phaser.GameObjects.Image[] = [];
  columns.forEach((column, columnIndex) => {
    rows.forEach((row, rowIndex) => {
      if (column.size <= 0 || row.size <= 0) return;
      pieces.push(
        scene.add
          .image(column.at, row.at, key, frameNameOf(columnIndex, rowIndex))
          .setOrigin(0, 0)
          .setDisplaySize(column.size, row.size),
      );
    });
  });
  return scene.add.container(0, 0, pieces).setSize(width, height);
}

/** 一辺を割った3区間の1つ（atは辺の先頭からの位置）。 */
export interface SliceSpan {
  readonly at: number;
  readonly size: number;
}

/**
 * 一辺を「端・中央・端」に割る。絵の側では切り出す範囲、敷く側では敷く範囲を表す。
 * どの区間も必ず隙間なく辺を埋める——隙間が空くと、そこに下地が透けて筋に見える。
 *
 * 端が両方入らないほど短い辺では、端どうしが重ならないよう端の側を詰める（中央は消える）。
 */
export function sliceSpans(total: number, border: number): readonly SliceSpan[] {
  const edge = Math.min(border, total / 2);
  return [
    { at: 0, size: edge },
    { at: edge, size: Math.max(0, total - edge * 2) },
    { at: total - edge, size: edge },
  ];
}

/**
 * 9つの断片をテクスチャのフレームとして足す（1度だけ）。
 *
 * **フレームを足すと、フレーム名を省いた参照が最初に足したフレームへ向くようになる**
 * （DesignNotes.md「Phaserのテクスチャ」）。9patchで敷く絵は、他の用途と共有しないこと。
 */
function ensureSliceFrames(
  scene: Phaser.Scene,
  key: string,
  sourceWidth: number,
  sourceHeight: number,
  border: number,
): void {
  const texture = scene.textures.get(key);
  if (texture.has(frameNameOf(0, 0))) return;

  const columns = sliceSpans(sourceWidth, border);
  const rows = sliceSpans(sourceHeight, border);
  columns.forEach((column, columnIndex) => {
    rows.forEach((row, rowIndex) => {
      texture.add(frameNameOf(columnIndex, rowIndex), 0, column.at, row.at, column.size, row.size);
    });
  });
}
