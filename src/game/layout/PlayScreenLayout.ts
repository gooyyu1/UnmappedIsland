import { INFORMATION_PAPER_INSET } from '../ui/informationArt';
import { SIZE } from '../ui/theme';
import type { Rect, ScreenMetrics } from './ScreenMetrics';

/** オプションバー・フィルターバーの厚み（アイコンボタン88 + 上下パディング16×2）。 */
const BAR_THICKNESS = SIZE.iconButton + 32;

/** キャラクター表示エリアの内側余白（中身を置くPlaySceneと、高さを決めるここで共有する）。 */
export const DISPLAY_PADDING = 16;

/**
 * 状況エリア（＝空のパネル）の高さ。日時も天候名もこのパネルの中に載る。
 *
 * 縦型は日時と天候名を左右に並べられるので低く、横型は幅が日時1つ分しかなく天候名を別の段へ
 * 分けるぶんだけ高い。どちらも絵の主題（太陽・雲）を置く右上を空ける寸法。
 */
const SITUATION_HEIGHT_PORTRAIT = 156;
const SITUATION_HEIGHT_LANDSCAPE = 224;

/**
 * キャラクター表示エリア高。パディング16 + ポートレイト320 + ギャップ12 + 条件の行48 + 下の余白。
 * 地図・装備・怪我はポートレイトの右へ縦積みするので行を足さない。
 *
 * 下の余白だけが向きで違う。縦型はこのエリアの下端が背景のページの下端（表紙の縁）に当たるので、
 * 縁に載らないよう紙の余白（INFORMATION_PAPER_INSET.field）より広く取る。横型の縁は右辺にあり、
 * 情報エリアの中身の幅が既に引いているので、下は通常のパディングでよい。
 *
 * 縦型はこの高さと状況エリアの和が600uちょうどで、9:16の端末でフィールドエリアが1080uを割らない
 * （＝3レーンが収まる）上限。
 */
const CHARACTER_DISPLAY_BOTTOM_PADDING_PORTRAIT = 48;
const CHARACTER_DISPLAY_HEIGHT_PORTRAIT = characterDisplayHeight(CHARACTER_DISPLAY_BOTTOM_PADDING_PORTRAIT);
const CHARACTER_DISPLAY_HEIGHT_LANDSCAPE = characterDisplayHeight(DISPLAY_PADDING);

function characterDisplayHeight(bottomPadding: number): number {
  return DISPLAY_PADDING + SIZE.cardHeight + SIZE.gap + SIZE.conditionButton + bottomPadding;
}

/** 縦型のキャラクター表示エリア幅。ポートレイト205 + 地図・装備・怪我の列 + ギャップ・パディング。 */
const CHARACTER_DISPLAY_WIDTH_PORTRAIT = 460;

/**
 * 横型のダッシュボード列幅・右サイドバー幅（ScreenLayout.md 横型レイアウト節）。
 *
 * 列幅は日時のフリップカード（406u）が背景のページの紙の内側に収まる幅で決まる。左右パディング
 * 20u×2と、フィールドエリア側の紙の余白（INFORMATION_PAPER_INSET.field）を足した幅が下限。
 */
const DASHBOARD_WIDTH_LANDSCAPE = 478;
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

  /** 空を映すパネル。日時のフリップカードと天候名はこの中に載る（向きによらず1枚）。 */
  readonly situationArea: Rect;

  readonly characterDisplay: Rect;
  readonly statusArea: Rect;

  /**
   * 情報エリア。フィールドエリアの左（横型）・上（縦型）にまとめて置かれる、状況エリアと
   * キャラクターエリアの全体。1枚の紙の背景として塗るための矩形なので、内訳の各エリアとは別に持つ。
   */
  readonly informationArea: Rect;

  /**
   * 情報エリアのうち、中身を置ける範囲（背景のページの紙の内側）。内訳の各エリアはこの中に収まる。
   * 情報エリアそのものとの差が、本の縁のぶんの余白（INFORMATION_PAPER_INSET）。
   */
  readonly informationContent: Rect;

  /** 上から設置物・アイテム・ハンドの3レーン。 */
  readonly lanes: readonly Rect[];

  /** レーンの区切りに敷く帯。上から順に、設置物レーンの上・レーン間×2・ハンドレーンの下の4本。 */
  readonly laneSeparators: readonly Rect[];

  /**
   * オプションバーと情報エリアの境目に敷く帯（縦型のみ。横型のオプションバーは右サイドバーで、
   * 情報エリアと接していないためundefined）。
   */
  readonly optionsBarSeparator: Rect | undefined;

  /**
   * フィールドエリアと右サイドバー（オプション／フィルター）の境目に敷く、縦向きの帯（横型のみ）。
   * 縦型はこの2つが接していないためundefined。
   */
  readonly sidebarSeparator: Rect | undefined;

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

      this.informationArea = { x: 0, y: 0, width: dashboardWidth, height };
      // 右は表紙の縁、上下はページの縁。内訳の各エリアはこの内側に収める。
      const content = {
        x: 0,
        y: u(INFORMATION_PAPER_INSET.edge),
        width: Math.max(0, dashboardWidth - u(INFORMATION_PAPER_INSET.field)),
        height: Math.max(0, height - u(INFORMATION_PAPER_INSET.edge) * 2),
      };
      this.informationContent = content;

      const situationHeight = u(SITUATION_HEIGHT_LANDSCAPE);
      this.situationArea = { x: content.x, y: content.y, width: content.width, height: situationHeight };

      const characterAreaY = content.y + situationHeight;
      const displayHeight = u(CHARACTER_DISPLAY_HEIGHT_LANDSCAPE);
      this.characterDisplay = {
        x: content.x,
        y: characterAreaY,
        width: content.width,
        height: displayHeight,
      };
      this.statusArea = {
        x: content.x,
        y: characterAreaY + displayHeight,
        width: content.width,
        height: Math.max(0, content.y + content.height - characterAreaY - displayHeight),
      };
    } else {
      const barHeight = u(BAR_THICKNESS);
      // フィールドエリアは1080uを上限に、ダッシュボード列の最小高を割り込む分だけ縮める
      // （9:16より縦長の端末では余剰の高さをダッシュボード列＝キャラクターエリアが吸収する）。
      const fieldHeight = Math.max(
        0,
        Math.min(u(1080), height - barHeight * 2 - u(DASHBOARD_MIN_HEIGHT_PORTRAIT)),
      );
      // キャラクター表示エリアは内容量ぶんだけ確保し、引き伸ばさない。極端に縦長の画面で余った高さは
      // オプションバーの上の余白（画面外として塗り潰す）にする。上端は指が届きにくく、使い切る価値が薄いため。
      const available = Math.max(0, height - barHeight * 2 - fieldHeight);
      const situationHeight = Math.min(u(SITUATION_HEIGHT_PORTRAIT), available);
      const displayHeight = Math.min(u(CHARACTER_DISPLAY_HEIGHT_PORTRAIT), available - situationHeight);
      const top = available - situationHeight - displayHeight;

      this.fieldArea = { x: 0, y: height - barHeight - fieldHeight, width, height: fieldHeight };
      this.filterBar = { x: 0, y: height - barHeight, width, height: barHeight };
      // オプションバーは背景のページの外側なので、幅いっぱいのまま。ページはその下から始まる。
      this.optionsBar = { x: 0, y: top, width, height: barHeight };
      this.informationArea = {
        x: 0,
        y: top + barHeight,
        width,
        height: Math.max(0, this.fieldArea.y - top - barHeight),
      };

      // 左右はページの縁。下（フィールドエリア側の表紙の縁）はキャラクター表示エリアの
      // 下パディングが受け持つ。
      const edge = u(INFORMATION_PAPER_INSET.edge);
      const content = {
        x: edge,
        y: this.informationArea.y,
        width: Math.max(0, width - edge * 2),
        height: this.informationArea.height,
      };
      this.informationContent = content;

      // 空のパネルが最上段。フィールドエリアの直上はキャラクターエリアになる。
      this.situationArea = { x: content.x, y: content.y, width: content.width, height: situationHeight };

      const characterAreaY = content.y + situationHeight;
      this.characterDisplay = {
        x: content.x,
        y: characterAreaY,
        width: Math.min(u(CHARACTER_DISPLAY_WIDTH_PORTRAIT), content.width),
        height: displayHeight,
      };
      this.statusArea = {
        x: content.x + this.characterDisplay.width,
        y: characterAreaY,
        width: content.width - this.characterDisplay.width,
        height: displayHeight,
      };
    }

    this.lanes = this.buildLanes();
    this.laneSeparators = this.buildLaneSeparators();
    const separatorThickness = u(SIZE.margin) * 2;
    this.optionsBarSeparator = metrics.isLandscape
      ? undefined
      : separatorAt(this.optionsBar.y + this.optionsBar.height, this.optionsBar, separatorThickness);
    this.sidebarSeparator = metrics.isLandscape
      ? verticalSeparatorAt(this.fieldArea.x + this.fieldArea.width, this.fieldArea, separatorThickness)
      : undefined;

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
   * レーンの区切りの帯（ScreenLayout.md エリアの区切り節）。
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
    return centers.map((center) => separatorAt(center, this.fieldArea, height));
  }
}

/**
 * 境目の線に対して上下対称に置く帯。絵は中央半分だけが区切りそのもので、上下1/4ずつは隣のエリアへ
 * かぶせる前提で描かれている（ScreenLayout.md）。
 */
function separatorAt(center: number, span: Rect, height: number): Rect {
  return { x: span.x, y: center - height / 2, width: span.width, height };
}

/** separatorAtの縦版。左右の境目に、絵を90度回して敷く（shapes.addTiledImageVertical）。 */
function verticalSeparatorAt(center: number, span: Rect, width: number): Rect {
  return { x: center - width / 2, y: span.y, width, height: span.height };
}
