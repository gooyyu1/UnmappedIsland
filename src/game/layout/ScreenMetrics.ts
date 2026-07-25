/** 画面上の矩形（左上原点・ピクセル）。 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * 画面寸法と単位uの対応（ScreenLayout.md「短辺基準の単位」）。
 * u = 画面短辺 ÷ 1080 とすることで、同一端末ならカードの実寸が画面の向きによらず一致する。
 */
export class ScreenMetrics {
  readonly width: number;
  readonly height: number;
  readonly u: number;

  /** 短辺が高さ側かどうか。正方形は横型として扱う。 */
  readonly isLandscape: boolean;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.u = Math.min(width, height) / 1080;
    this.isLandscape = width >= height;
  }

  /** u単位の長さをピクセルへ変換する。 */
  px(units: number): number {
    return units * this.u;
  }

  /** フォントサイズはサブピクセルにすると描画が滲むため整数へ丸める。1px未満にはしない。 */
  fontPx(units: number): number {
    return Math.max(1, Math.round(units * this.u));
  }
}
