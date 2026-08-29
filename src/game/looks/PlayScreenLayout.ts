import { INFORMATION_PAPER_INSET } from '../../art/informationArt';
import { SIZE } from './theme';
import { LANE_MIN_CARDS } from './ScreenMetrics';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from './ScreenMetrics';

/** オプションバー・フィルターバーの厚み（アイコンボタン88 + 上下パディング16×2）。 */
const BAR_THICKNESS = SIZE.iconButton + 32;

/** オプションバー・フィルターバーの内側パディング（縦型は左右が広め）。 */
const BAR_PADDING = 16;
const OPTIONS_BAR_PADDING_X = 24;
const FILTER_BAR_PADDING_X = 20;

/** ステータスエリアの内側パディング（キャラクター表示エリア側はCHARACTER_DISPLAY_PADDING）。 */
const STATUS_PADDING = 24;

/** 情報エリアの区切り線の太さ。 */
const INFORMATION_DIVIDER_THICKNESS = 4;

/** バーに並ぶアイコンの、並ぶ向きの中での寄せ方。 */
type BarAlign = 'start' | 'center' | 'end';

/**
 * バーに一列に並ぶアイコンボタンの置き方。
 *
 * **バーに収まらない数を渡されても、位置は縮めず並びを伸ばす**（アイコンボタンの88uは最小タップ
 * 領域、ScreenLayout.md 2節）。はみ出した分を送って見せるのに要るものが、送る向き（axis）と
 * バーの先頭から測った並び全体の長さ（length）。
 */
export interface BarIconRow {
  readonly icons: readonly Rect[];

  /** 送る向き（並ぶ向きはバーの向きが決める。barIcons参照）。 */
  readonly axis: 'x' | 'y';

  /** バーの先頭の辺から、並びの末尾の余白までの長さ。バーより長ければ、その差だけ送れる。 */
  readonly length: number;
}

/** キャラクター表示エリアの内側余白（中身を置くPlaySceneと、高さを決めるここで共有する）。 */
export const CHARACTER_DISPLAY_PADDING = 16;

/**
 * 状況エリア（＝空の帯）の高さ。日時も天候名もこの帯の中に載る。
 *
 * 縦型は日時と天候名を左右に並べられるので低く、横型は幅が日時1つ分しかなく天候名を別の段へ
 * 分けるぶんだけ高い。どちらも**載せ物の分しか取らない**——空は絵として見せるものだが、
 * 日時の上に広く余らせても情報が増えないため。
 */
const SITUATION_HEIGHT_PORTRAIT = 128;
const SITUATION_HEIGHT_LANDSCAPE = 184;

/**
 * 縦型で、本のページの上辺に見せる縁の幅。
 *
 * 状況エリアを本の外へ出したことで、ページの上辺が画面の途中に来た。左右と同じだけ縁を見せないと、
 * 帯の下からいきなり紙が始まって、本の上端に見えない。
 */
const PAGE_TOP_EDGE_WIDTH_PORTRAIT = INFORMATION_PAPER_INSET.edge;

/**
 * キャラクター表示エリア高。パディング16 + ポートレイト320 + ギャップ12 + 条件の行48 + 下の余白。
 * 地図・装備・怪我はポートレイトの右へ縦積みするので行を足さない。
 *
 * 下の余白だけが向きで違う。縦型はこのエリアの下端が背景のページの下端（表紙の縁）に当たるので、
 * 縁に載らないよう紙の余白（INFORMATION_PAPER_INSET.field）より広く取る。横型の縁は右辺にあり、
 * 情報エリアの中身の幅が既に引いているので、下は通常のパディングでよい。
 *
 * 縦型はこの高さと状況エリア・ページの上辺の和が596uで、9:16の端末でフィールドエリアが1080uを
 * 割らない（＝3レーンが収まる）範囲。
 */
const CHARACTER_DISPLAY_BOTTOM_PADDING_PORTRAIT = 48;
const CHARACTER_DISPLAY_HEIGHT_PORTRAIT = characterDisplayHeight(CHARACTER_DISPLAY_BOTTOM_PADDING_PORTRAIT);
const CHARACTER_DISPLAY_HEIGHT_LANDSCAPE = characterDisplayHeight(CHARACTER_DISPLAY_PADDING);

function characterDisplayHeight(bottomPadding: number): number {
  return CHARACTER_DISPLAY_PADDING + SIZE.cardHeight + SIZE.gap + SIZE.conditionButton + bottomPadding;
}

/** 縦型のキャラクター表示エリア幅。ポートレイト205 + 地図・装備・怪我の列 + ギャップ・パディング。 */
const CHARACTER_DISPLAY_WIDTH_PORTRAIT = 460;

/** 横型のオプションバー高（アイコンボタン4個の縦積み + 上下パディング16×2）。 */
const OPTIONS_HEIGHT_LANDSCAPE = SIZE.iconButton * 4 + SIZE.barGap * 3 + 32;

/**
 * ハンドレーンの枠の上限（ScreenLayout.md 7.3節）。**これを超えて広げた幅を使う相手がフィールド
 * エリアに居ない**ので、超えた分はサイドバーへ回す（同10.1節）。
 */
const HAND_LANE_CELLS = 6;

/** 縦型でフィールドエリアを縮めてでも確保する高さ（状況エリア + ページの上辺 + キャラクター表示エリアの内容量）。 */
const DASHBOARD_MIN_HEIGHT_PORTRAIT =
  SITUATION_HEIGHT_PORTRAIT + PAGE_TOP_EDGE_WIDTH_PORTRAIT + CHARACTER_DISPLAY_HEIGHT_PORTRAIT;

/**
 * プレイ中の画面（ScreenLayout.md）の各エリアの位置・大きさ。
 * 縦型・横型で同じエリアを配置し直すだけという設計原則に合わせ、同じプロパティ名で両方の向きを表す。
 */
export class PlayScreenLayout {
  readonly metrics: ScreenMetrics;

  readonly optionsBar: Rect;
  readonly filterBar: Rect;
  readonly fieldArea: Rect;

  /**
   * 空を敷く帯。日時のフリップカードと天候名はこの中に載る（向きによらず1本）。
   * **本の外**なので、情報エリアには含まれない。
   */
  readonly situationArea: Rect;

  readonly characterDisplay: Rect;
  readonly statusArea: Rect;

  /** ステータスエリアのうち、バーを並べる範囲（内側パディングを引いたもの）。 */
  readonly statusRowsArea: Rect;

  /**
   * 情報エリアの中を仕切る区切り線。背景が1枚の紙になり、エリアごとの塗り分けが無くなったため、
   * 意味のまとまり（キャラクター／ステータス）の境目だけを線で示す。見た目は現在地カードの右の
   * 区切り線と同じ（CardLane.addPinnedCell）。
   *
   * 状況エリアとの境目には引かない。空のパネルが自分の縁を持っていて、それが境目を兼ねるため。
   */
  readonly informationDivider: Rect;

  /**
   * 情報エリア。フィールドエリアの左（横型）・上（縦型）に置かれるキャラクターエリアの全体。
   * 1枚の紙の背景として塗るための矩形なので、内訳の各エリアとは別に持つ。
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
   * オプションバーと状況エリアの境目に敷く帯（縦型のみ。横型のオプションバーは右サイドバーで、
   * 状況エリアと接していないためundefined）。
   */
  readonly optionsBarSeparator: Rect | undefined;

  /**
   * 状況エリアと本の境目に敷く帯（縦型のみ。横型では両者が上下に並ばないためundefined）。
   */
  readonly situationSeparator: Rect | undefined;

  /**
   * フィールドエリアと、その左に並ぶもの（状況エリア・本）の境目に敷く、縦向きの帯（横型のみ）。
   *
   * **状況エリアの右辺ではなくフィールドエリアの左辺に置く。** 右サイドバーとの境目
   * （sidebarSeparator）と同じく、フィールドエリアの辺として一貫させるため。本のページはこの帯より
   * 手前に置かれるので、帯は本の縁で自然に終わる。
   */
  readonly fieldLeftSeparator: Rect | undefined;

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
      const barColumn = Math.min(u(SIZE.sidebar), width);
      const dashboardBeside = (sidebar: number): number => Math.min(u(SIZE.dashboardColumn), width - sidebar);
      // 余剰は**広げる前**の幅で測る（ScreenLayout.md 10.2節）。広げた後の幅で測ると、広げる→6枚に
      // なる→余剰が無くなる→戻す、を繰り返す。
      const spare = laneCellsIn(width - dashboardBeside(barColumn) - barColumn, metrics) > HAND_LANE_CELLS;
      const sidebarWidth = Math.min(spare ? barColumn * 2 : barColumn, width);
      const dashboardWidth = dashboardBeside(sidebarWidth);
      const optionsHeight = Math.min(u(OPTIONS_HEIGHT_LANDSCAPE), height);

      // 余剰があれば2列に分け、**どちらも画面の高さいっぱい**の列にする（10.2節）。1列を上下に
      // 分け合うときだけ、オプションバーが内容量ぶんを取って残りをフィルターバーへ渡す。
      this.optionsBar = {
        x: width - barColumn,
        y: 0,
        width: barColumn,
        height: spare ? height : optionsHeight,
      };
      this.filterBar = spare
        ? { x: width - sidebarWidth, y: 0, width: barColumn, height }
        : {
            x: width - barColumn,
            y: optionsHeight,
            width: barColumn,
            height: height - optionsHeight,
          };
      this.fieldArea = {
        x: dashboardWidth,
        y: 0,
        width: width - dashboardWidth - sidebarWidth,
        height,
      };

      // 状況エリアは本の外。列の上端に幅いっぱいで置き、ページはその下から始まる。
      const situationHeight = u(SITUATION_HEIGHT_LANDSCAPE);
      this.situationArea = { x: 0, y: 0, width: dashboardWidth, height: situationHeight };

      this.informationArea = {
        x: 0,
        y: situationHeight,
        width: dashboardWidth,
        height: Math.max(0, height - situationHeight),
      };
      // 右は表紙の縁、上下はページの縁。内訳の各エリアはこの内側に収める。
      const content = {
        x: 0,
        y: this.informationArea.y + u(INFORMATION_PAPER_INSET.edge),
        width: Math.max(0, dashboardWidth - u(INFORMATION_PAPER_INSET.field)),
        height: Math.max(0, this.informationArea.height - u(INFORMATION_PAPER_INSET.edge) * 2),
      };
      this.informationContent = content;

      const characterAreaY = content.y;
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
      const pageTop = Math.min(u(PAGE_TOP_EDGE_WIDTH_PORTRAIT), available - situationHeight);
      const displayHeight = Math.min(
        u(CHARACTER_DISPLAY_HEIGHT_PORTRAIT),
        available - situationHeight - pageTop,
      );
      const top = available - situationHeight - pageTop - displayHeight;

      this.fieldArea = { x: 0, y: height - barHeight - fieldHeight, width, height: fieldHeight };
      this.filterBar = { x: 0, y: height - barHeight, width, height: barHeight };
      // オプションバーは背景のページの外側なので、幅いっぱいのまま。
      this.optionsBar = { x: 0, y: top, width, height: barHeight };
      // 状況エリアも本の外。オプションバーの直下に幅いっぱいで置き、ページはその下から始まる。
      this.situationArea = { x: 0, y: top + barHeight, width, height: situationHeight };
      this.informationArea = {
        x: 0,
        y: this.situationArea.y + situationHeight,
        width,
        height: Math.max(0, this.fieldArea.y - this.situationArea.y - situationHeight),
      };

      // 左右と上はページの縁。下（フィールドエリア側の表紙の縁）はキャラクター表示エリアの
      // 下パディングが受け持つ。
      const edge = u(INFORMATION_PAPER_INSET.edge);
      const content = {
        x: edge,
        y: this.informationArea.y + pageTop,
        width: Math.max(0, width - edge * 2),
        height: Math.max(0, this.informationArea.height - pageTop),
      };
      this.informationContent = content;

      const characterAreaY = content.y;
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

    const statusPadding = u(STATUS_PADDING);
    this.statusRowsArea = {
      x: this.statusArea.x + statusPadding,
      y: this.statusArea.y + statusPadding,
      width: Math.max(0, this.statusArea.width - statusPadding * 2),
      height: Math.max(0, this.statusArea.height - statusPadding * 2),
    };

    const dividerThickness = u(INFORMATION_DIVIDER_THICKNESS);
    // 横型はキャラクター表示エリアとステータスエリアが上下に並ぶので、境目も横向き。
    this.informationDivider = metrics.isLandscape
      ? {
          x: this.informationContent.x + statusPadding,
          y: this.statusArea.y - dividerThickness / 2,
          width: Math.max(0, this.informationContent.width - statusPadding * 2),
          height: dividerThickness,
        }
      : {
          x: this.statusArea.x - dividerThickness / 2,
          y: this.statusRowsArea.y,
          width: dividerThickness,
          height: this.statusRowsArea.height,
        };

    this.lanes = this.buildLanes();
    this.laneSeparators = this.buildLaneSeparators();
    const separatorThickness = u(SIZE.margin) * 2;
    // 本の外に並ぶ帯どうしの境目（縦型のみ。横型のオプションバーは右サイドバーで、状況エリアと
    // 接していない）。
    this.optionsBarSeparator = metrics.isLandscape
      ? undefined
      : horizontalSeparatorAt(
          this.optionsBar.y + this.optionsBar.height,
          this.optionsBar,
          separatorThickness,
        );
    // 状況エリアと本の境目（縦型のみ。横型では両者が上下に並ばない）。
    this.situationSeparator = metrics.isLandscape
      ? undefined
      : horizontalSeparatorAt(
          this.situationArea.y + this.situationArea.height,
          this.situationArea,
          separatorThickness,
        );
    // フィールドエリアの左右の辺（横型のみ）。左は状況エリアと本、右は右サイドバーと接する。
    this.fieldLeftSeparator = metrics.isLandscape
      ? verticalSeparatorAt(this.fieldArea.x, this.fieldArea, separatorThickness)
      : undefined;
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

  /** 組み上がったフィールドエリアで、1つのレーンに一度に見えている枠の数（laneCellsIn）。 */
  get laneCells(): number {
    return laneCellsIn(this.fieldArea.width, this.metrics);
  }

  /** オプションバーに並ぶアイコンボタン。横型は高さいっぱいの中央へ、縦型は右端へ寄せる。 */
  optionsBarIcons(count: number): BarIconRow {
    return this.metrics.isLandscape
      ? this.barIcons(this.optionsBar, count, 'center', 0)
      : this.barIcons(this.optionsBar, count, 'end', this.metrics.px(OPTIONS_BAR_PADDING_X));
  }

  /** フィルターバーに並ぶアイコンボタン。どちらの向きでも並びの先頭側へ寄せる。 */
  filterBarIcons(count: number): BarIconRow {
    const padding = this.metrics.isLandscape ? BAR_PADDING : FILTER_BAR_PADDING_X;
    return this.barIcons(this.filterBar, count, 'start', this.metrics.px(padding));
  }

  /**
   * バーの中に一列に並ぶアイコンボタン。**並ぶ向きはバーの向きが決める**（横型は右サイドバーの
   * 縦積み、縦型は帯の横並び）。交差する向きには常に中央へ置くので、バーごとの差は並ぶ向きの中での
   * 寄せ方と余白だけ。
   *
   * **寄せ方が効くのは余りがあるときだけ**で、収まらないなら常に先頭から並べる。中途半端な位置から
   * 始めると、送り切っても先頭のボタンがバーの外に残る。
   */
  private barIcons(bar: Rect, count: number, align: BarAlign, padding: number): BarIconRow {
    const size = this.metrics.px(SIZE.iconButton);
    const gap = this.metrics.px(SIZE.barGap);
    const span = count * size + (count - 1) * gap;
    const along = this.metrics.isLandscape ? bar.height : bar.width;
    const aligned =
      align === 'center' ? (along - span) / 2 : align === 'start' ? padding : along - padding - span;
    const head = Math.max(padding, aligned);

    const icons = Array.from({ length: count }, (_unused, index) => {
      const at = head + index * (size + gap);
      return this.metrics.isLandscape
        ? { x: bar.x + (bar.width - size) / 2, y: bar.y + at, width: size, height: size }
        : { x: bar.x + at, y: bar.y + (bar.height - size) / 2, width: size, height: size };
    });
    return { icons, axis: this.metrics.isLandscape ? 'y' : 'x', length: head + span + padding };
  }

  private buildLanes(): readonly Rect[] {
    const margin = this.metrics.px(SIZE.margin);
    // レーンはフィールドエリアの高さを3等分する。設計寸法（352u）より高くなるのは、幅に合わせてuを
    // 縮めた横型（ScreenMetrics）で高さが余るときだけ。**余りはレーンが吸収する**——外に残すと、
    // 区切りの帯で囲った枠が画面の端から離れ、フィールドエリアの下に地の色の帯が見える。
    const laneHeight = (this.fieldArea.height - margin * 4) / 3;
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
   * レーンの区切りの帯（ScreenLayout.md 7.6節 エリアの区切り）。
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
    return centers.map((center) => horizontalSeparatorAt(center, this.fieldArea, height));
  }
}

/**
 * 幅がfieldWidthのフィールドエリアで、1つのレーンに一度に見えている枠の数。**送らずに読める枚数**で、
 * レーンの外周マージン（左）の内側から数える——横型は左右とも区切りの帯がかぶるが、縦型の右端は
 * 画面の端そのもので、右のマージンへ届いたカードもそのまま見える（buildLanes）。
 *
 * 幅を受け取るのは、**サイドバーを広げる前**の幅でも測るため（ScreenLayout.md 10.2節）。使い道は
 * これと、手持ちを前へ詰めるかどうかの判定（同7.3節）の2つ。
 */
function laneCellsIn(fieldWidth: number, metrics: ScreenMetrics): number {
  const hidden = metrics.px(metrics.isLandscape ? SIZE.margin * 2 : SIZE.margin);
  const pitch = metrics.px(SIZE.cardWidth + SIZE.gap);
  const usable = fieldWidth - hidden + metrics.px(SIZE.gap);
  // 設計寸法はカード5枚ぴったりで組んであるので、幅で決まる横型はどれも商がちょうど5.0000になる。
  // 足すのは**浮動小数の誤差だけ**で、幾何の不足ではない——1px単位まで緩めると、本当に入り切って
  // いないカードを数える。
  const fits = Math.floor(usable / pitch + 1e-9);
  // 下限は測り直した結果ではなく、ScreenMetricsがuを「カードが5枚見える」ように選んでいるという
  // 保証（ScreenLayout.md 3.1節）の書き写し。
  return Math.max(LANE_MIN_CARDS, fits);
}

/**
 * 境目の線に対して上下対称に置く帯。絵は中央半分だけが区切りそのもので、上下1/4ずつは隣のエリアへ
 * かぶせる前提で描かれている（ScreenLayout.md 7.6節）。
 */
function horizontalSeparatorAt(center: number, span: Rect, height: number): Rect {
  return { x: span.x, y: center - height / 2, width: span.width, height };
}

/** horizontalSeparatorAtの縦版。左右の境目に、絵を90度回して敷く（shapes.addTiledImageVertical）。 */
function verticalSeparatorAt(center: number, span: Rect, width: number): Rect {
  return { x: center - width / 2, y: span.y, width, height: span.height };
}
