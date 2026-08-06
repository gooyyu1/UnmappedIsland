/** 画面上の矩形（左上原点・ピクセル）。 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * 縦型で積み上がる高さ（u）。オプションバー120 + 情報エリア600 + フィールドエリア1080 +
 * フィルターバー120（PlayScreenLayout）。フィールドエリアの1080uは3レーンぶんちょうどで、
 * ここを割るとハンドレーンがフィルターバーへはみ出す。
 */
const PORTRAIT_HEIGHT_UNITS = 1920;

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
    this.isLandscape = width >= height;
    // 短辺基準が原則だが、9:16より正方形に近い縦型（4:3など）ではそのままだと縦に積み切れず、
    // 3レーンが収まらない。3レーンが無いとプレイ自体が成り立たないので、全体を縮めてでも
    // 高さを確保する。横型は短辺が高さそのもので、3レーンは常に収まる。
    this.u = this.isLandscape ? height / 1080 : Math.min(width / 1080, height / PORTRAIT_HEIGHT_UNITS);
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
