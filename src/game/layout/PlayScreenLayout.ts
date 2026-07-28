import { SIZE } from '../ui/theme';
import type { Rect, ScreenMetrics } from './ScreenMetrics';

/** オプションバー・フィルターバーの厚み（アイコンボタン88 + 上下パディング16×2）。 */
const BAR_THICKNESS = SIZE.iconButton + 32;

/** 縦型の状況エリア高（フリップカード88 + 上下パディング20×2）。天候チップを同居させる。 */
const SITUATION_HEIGHT_PORTRAIT = SIZE.iconButton + 40;

/** 横型の状況エリア・天候の帯の高（フリップカード88 + 上下パディング12×2）。 */
const SITUATION_HEIGHT_LANDSCAPE = SIZE.iconButton + 24;

/** 横型のキャラクター表示エリア高（ポートレイトカード320 + 上下パディング16×2）。右の縦列はこの下端に揃う。 */
const CHARACTER_DISPLAY_HEIGHT_LANDSCAPE = SIZE.cardHeight + 32;

/** 縦型のキャラクター表示エリアの内容量（パディング16×2 + ポートレイト320 + ギャップ + 装備/怪我の行88）。 */
const CHARACTER_DISPLAY_HEIGHT_PORTRAIT = SIZE.cardHeight + SIZE.gap + SIZE.iconButton + 32;

/** 縦型のキャラクター表示エリア幅。ポートレイト205 + 条件2列 + ギャップ・パディング。 */
const CHARACTER_DISPLAY_WIDTH_PORTRAIT = 460;

/** 横型のダッシュボード列幅・右サイドバー幅（ScreenLayout.md 横型レイアウト節）。 */
const DASHBOARD_WIDTH_LANDSCAPE = 540;
const SIDEBAR_WIDTH_LANDSCAPE = 120;

/** 横型のオプションバー高（アイコンボタン4個の縦積み + 上下パディング16×2）。 */
const OPTIONS_HEIGHT_LANDSCAPE = SIZE.iconButton * 4 + SIZE.barGap * 3 + 32;

/** 縦型でフィールドエリアを縮めてでも確保するダッシュボード列の最小高（状況エリア + キャラクター表示エリアの内容量）。 */
const DASHBOARD_MIN_HEIGHT_PORTRAIT = SITUATION_HEIGHT_PORTRAIT + CHARACTER_DISPLAY_HEIGHT_PORTRAIT;

/**
 * プレイ中の画面（ScreenLayout.md）の各エリアの位置・大きさ。
 * 縦型・横型で同じエリアを配置し直すだけという設計原則に合わせ、同じプロパティ名で両方の向きを表す。
 */
export class PlayScreenLayout {
  readonly metrics: ScreenMetrics;

  readonly optionsBar: Rect;
  readonly filterBar: Rect;
  readonly fieldArea: Rect;
  readonly situationArea: Rect;

  /** 天候の帯は横型のみ。縦型では天候チップが状況エリアに同居するためundefinedになる。 */
  readonly weatherRow: Rect | undefined;

  readonly characterDisplay: Rect;
  readonly statusArea: Rect;

  /**
   * 情報エリア。フィールドエリアの左（横型）・上（縦型）にまとめて置かれる、状況エリア・天候の帯・
   * キャラクターエリアの全体。1枚の紙の背景として塗るための矩形なので、内訳の各エリアとは別に持つ。
   */
  readonly informationArea: Rect;

  /** 上から設置物・アイテム・ハンドの3レーン。 */
  readonly lanes: readonly Rect[];

  /** レーンの区切りに敷く帯。上から順に、設置物レーンの上・レーン間×2・ハンドレーンの下の4本。 */
  readonly laneSeparators: readonly Rect[];

  /**
   * ハンドレーンを覆わない子ウィンドウ（装備・怪我・コンテナ）の置き場所。手持ちとカードを
   * やり取りする操作があるため、開いている間も手持ちが見えている必要がある。
   */
  readonly slotWindowArea: Rect;

  constructor(metrics: ScreenMetrics) {
    this.metrics = metrics;
    const u = (units: number): number => metrics.px(units);
    const { width, height } = metrics;

    if (metrics.isLandscape) {
      const sidebarWidth = Math.min(u(SIDEBAR_WIDTH_LANDSCAPE), width);
      const dashboardWidth = Math.min(u(DASHBOARD_WIDTH_LANDSCAPE), width - sidebarWidth);
      const optionsHeight = Math.min(u(OPTIONS_HEIGHT_LANDSCAPE), height);

      this.optionsBar = { x: width - sidebarWidth, y: 0, width: sidebarWidth, height: optionsHeight };
      this.filterBar = {
        x: width - sidebarWidth,
        y: optionsHeight,
        width: sidebarWidth,
        height: height - optionsHeight,
      };
      this.fieldArea = {
        x: dashboardWidth,
        y: 0,
        width: width - dashboardWidth - sidebarWidth,
        height,
      };

      const situationHeight = u(SITUATION_HEIGHT_LANDSCAPE);
      this.situationArea = { x: 0, y: 0, width: dashboardWidth, height: situationHeight };
      this.weatherRow = { x: 0, y: situationHeight, width: dashboardWidth, height: situationHeight };

      const characterAreaY = situationHeight * 2;
      const displayHeight = u(CHARACTER_DISPLAY_HEIGHT_LANDSCAPE);
      this.characterDisplay = { x: 0, y: characterAreaY, width: dashboardWidth, height: displayHeight };
      this.statusArea = {
        x: 0,
        y: characterAreaY + displayHeight,
        width: dashboardWidth,
        height: Math.max(0, height - characterAreaY - displayHeight),
      };
    } else {
      const barHeight = u(BAR_THICKNESS);
      // フィールドエリアは1080uを上限に、ダッシュボード列の最小高を割り込む分だけ縮める
      // （9:16より縦長の端末では余剰の高さをダッシュボード列＝キャラクターエリアが吸収する）。
      const fieldHeight = Math.max(
        0,
        Math.min(u(1080), height - barHeight * 2 - u(DASHBOARD_MIN_HEIGHT_PORTRAIT)),
      );
      const dashboardHeight = Math.max(0, height - barHeight * 2 - fieldHeight);
      const situationHeight = Math.min(u(SITUATION_HEIGHT_PORTRAIT), dashboardHeight);

      this.optionsBar = { x: 0, y: 0, width, height: barHeight };
      this.characterDisplay = {
        x: 0,
        y: barHeight,
        width: Math.min(u(CHARACTER_DISPLAY_WIDTH_PORTRAIT), width),
        height: dashboardHeight - situationHeight,
      };
      this.statusArea = {
        x: this.characterDisplay.width,
        y: barHeight,
        width: width - this.characterDisplay.width,
        height: this.characterDisplay.height,
      };
      this.situationArea = {
        x: 0,
        y: barHeight + this.characterDisplay.height,
        width,
        height: situationHeight,
      };
      this.weatherRow = undefined;
      this.fieldArea = { x: 0, y: barHeight + dashboardHeight, width, height: fieldHeight };
      this.filterBar = { x: 0, y: height - barHeight, width, height: barHeight };
    }

    // 縦型はフィールドエリアより上の全体（オプションバーも含む）、横型はその左の列。
    this.informationArea = metrics.isLandscape
      ? { x: 0, y: 0, width: this.fieldArea.x, height }
      : { x: 0, y: 0, width, height: this.fieldArea.y };

    this.lanes = this.buildLanes();
    this.laneSeparators = this.buildLaneSeparators();

    const handLane = this.lanes[2];
    this.slotWindowArea = {
      x: this.fieldArea.x,
      y: this.fieldArea.y,
      width: this.fieldArea.width,
      height: Math.max(0, handLane.y - this.fieldArea.y),
    };
  }

  private buildLanes(): readonly Rect[] {
    const margin = this.metrics.px(SIZE.margin);
    const laneHeight = this.metrics.px(SIZE.laneHeight);
    const lanes: Rect[] = [];
    for (let i = 0; i < 3; i++) {
      lanes.push({
        x: this.fieldArea.x,
        y: this.fieldArea.y + margin + i * (laneHeight + margin),
        width: this.fieldArea.width,
        height: laneHeight,
      });
    }
    return lanes;
  }

  /**
   * レーンの区切りの帯（ScreenLayout.md レーンの区切り節）。
   *
   * 帯は絵の中央半分だけが区切りそのもので、上下1/4ずつは隣のレーンへかぶせる前提で描かれている。
   * そのため高さはレーンの隙間の2倍を取り、隙間の中心線に対して上下対称に置く。
   */
  private buildLaneSeparators(): readonly Rect[] {
    const margin = this.metrics.px(SIZE.margin);
    const height = margin * 2;
    const centers = [
      this.lanes[0].y - margin / 2,
      ...this.lanes.map((lane) => lane.y + lane.height + margin / 2),
    ];
    return centers.map((center) => ({
      x: this.fieldArea.x,
      y: center - height / 2,
      width: this.fieldArea.width,
      height,
    }));
  }
}
