import { SIZE } from './theme';

/**
 * レーンに必ず見えているカードの枚数（ScreenLayout.md 3.1節）。5枚見えていないと、場に何があるかを
 * 見比べるより先に送る操作が要る。
 */
export const LANE_MIN_CARDS = 5;

/** カード5枚とその間のギャップ（u）。レーンの外周マージンの内側に、これだけの幅が要る。 */
const LANE_MIN_CARDS_WIDTH = SIZE.cardWidth * LANE_MIN_CARDS + SIZE.gap * (LANE_MIN_CARDS - 1);

/**
 * 縦型で積み上がる高さ（u）。オプションバー120 + 情報エリア600 + フィールドエリア1080 +
 * フィルターバー120（PlayScreenLayout）。フィールドエリアの1080uは3レーンぶんちょうどで、
 * ここを割るとハンドレーンがフィルターバーへはみ出す。
 */
const PORTRAIT_HEIGHT_UNITS = 1920;

/**
 * 縦型の幅（u）。9:16の基準そのもの。フィールドエリアが画面幅いっぱいなので、レーンの外周マージン
 * （左の6u）の内側にカード5枚ぶん（1073u）が収まり、下限（1079u）は基準の側が既に満たしている。
 */
const PORTRAIT_WIDTH_UNITS = 1080;

/** 横型の高さ（u）。フィールドエリアが画面高そのもので、3レーンぶんちょうど。 */
const LANDSCAPE_HEIGHT_UNITS = 1080;

/**
 * 横型で横に並ぶ幅（u）。ダッシュボード列478 + フィールドエリア + 右サイドバー120（PlayScreenLayout）。
 *
 * フィールドエリアはレーンの外周マージン（左右6uずつ）の内側にカード5枚ぶんを取る。**縦型と違って
 * 両端とも区切りの帯がかぶる**（本と右サイドバーとの境目）ので、はみ出したカードは見えない。
 */
const LANDSCAPE_WIDTH_UNITS = SIZE.dashboardColumn + SIZE.margin * 2 + LANE_MIN_CARDS_WIDTH + SIZE.sidebar;

/**
 * 画面寸法と単位uの対応（ScreenLayout.md 1節「短辺基準の単位」）。
 * u = 画面短辺 ÷ 1080 とすることで、同一端末ならカードの実寸が画面の向きによらず一致する。
 *
 * ただし短辺基準のままでは、9:16（縦型）・16:9（横型）より正方形に近い画面で設計寸法が入り切らない。
 * uは**向きごとの設計寸法が縦横とも収まる最大値**とし、入り切らない画面では全体を縮める（3.1節）。
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
    // 縦型は高さ（3レーン + 積み上がるエリア）、横型は幅（3列）が先に足りなくなる。カードは小さく
    // なるが、レーンが欠けたりカードが5枚見えなかったりするよりは読める。
    this.u = this.isLandscape
      ? Math.min(height / LANDSCAPE_HEIGHT_UNITS, width / LANDSCAPE_WIDTH_UNITS)
      : Math.min(width / PORTRAIT_WIDTH_UNITS, height / PORTRAIT_HEIGHT_UNITS);
  }

  /** u単位の長さをピクセルへ変換する。 */
  px(units: number): number {
    return units * this.u;
  }

  /** 線の太さ。**1px未満にすると線が消える**ので、縮んだ画面でも下限を切る。 */
  linePx(units: number): number {
    return Math.max(1, units * this.u);
  }

  /** フォントサイズはサブピクセルにすると描画が滲むため整数へ丸める。1px未満にはしない。 */
  fontPx(units: number): number {
    return Math.max(1, Math.round(units * this.u));
  }
}
