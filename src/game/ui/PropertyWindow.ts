import type Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import type { Button } from './Button';
import { addTextButton } from './Button';
import { ACTION_HEIGHT, ACTION_MAX_WIDTH, CONTENT_GAP, WINDOW_PADDING, centerWindow } from './childWindow';
import { addLabel } from './labels';
import type { StatusContent } from './StatusBar';
import { StatusBar } from './StatusBar';
import type { BoxStyle } from './shapes';
import { addPanel, drawBox } from './shapes';
import { COLOR, SIZE } from './theme';

/** タブとバーの寸法。タブは最小タップ領域（アイコンボタン）と同じ高さにする。 */
const TAB_HEIGHT = SIZE.iconButton;
const TAB_GAP = 12;
const ROW_GAP = 16;

/** ウィンドウの横幅（バーの伸び代を確保しつつ、狭い画面では領域いっぱいまで縮む）。 */
const WINDOW_WIDTH = 760;

/** 名前欄の幅。ステータスエリアより広げる（「穀物・イモの栄養」のような長い表示名が並ぶため）。 */
const NAME_WIDTH = 260;

/** 1つのタブ（1つのプロパティタグと、そのタグが付いたプロパティ）。 */
export interface PropertyTab {
  readonly name: string;
  readonly entries: readonly StatusContent[];
}

export interface PropertyWindowOptions {
  /** ウィンドウの見出し（キャラクターの表示名）。 */
  readonly title: string;

  /** タブ一式。並び順はプロパティタグの宣言順（GameElementDefinition.md 6.9節）。 */
  readonly tabs: readonly PropertyTab[];

  /** ウィンドウを収める領域。 */
  readonly area: Rect;

  readonly onClose: () => void;
}

/**
 * キャラクターのプロパティをタグごとにバーで見せる子ウィンドウ（ScreenLayout.md プロパティウィンドウ節）。
 * 高さはタブの中で最も件数が多いものに合わせて固定し、タブを切り替えても枠が伸び縮みしないようにする。
 */
export class PropertyWindow {
  private readonly scene: Phaser.Scene;
  private readonly metrics: ScreenMetrics;
  private readonly options: PropertyWindowOptions;

  /** 枠・見出し・タブ・閉じるボタンなど、タブを切り替えても作り直さないもの。 */
  private readonly frame: Phaser.GameObjects.GameObject[] = [];

  /** 今選ばれているタブのバーだけ。切り替えのたびに捨てて作り直す。 */
  private rows: Phaser.GameObjects.GameObject[] = [];

  private readonly tabButtons: Button[] = [];
  private selected = 0;

  /** バーを並べ始める位置と、1行あたりの高さ。 */
  private readonly rowsX: number;
  private readonly rowsY: number;
  private readonly rowsWidth: number;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, options: PropertyWindowOptions) {
    this.scene = scene;
    this.metrics = metrics;
    this.options = options;

    const { area } = options;
    const padding = metrics.px(WINDOW_PADDING);
    const gap = metrics.px(CONTENT_GAP);
    const tabHeight = metrics.px(TAB_HEIGHT);
    const actionHeight = metrics.px(ACTION_HEIGHT);
    const rowHeight = StatusBar.height(metrics);
    const rowGap = metrics.px(ROW_GAP);

    // 手持ちとやり取りしない読み取り専用のウィンドウなので、覆いは画面全体に敷く（探索ウィンドウと同じ）。
    const { width, height } = metrics;
    this.frame.push(addPanel(scene, { x: 0, y: 0, width, height }, COLOR.modalOverlay, 0.5));

    const windowWidth = Math.min(metrics.px(WINDOW_WIDTH), area.width, width * 0.92);
    const maxRows = Math.max(1, ...options.tabs.map((tab) => tab.entries.length));
    const rowsHeight = maxRows * rowHeight + (maxRows - 1) * rowGap;

    // 台紙は寸法が決まる前に作る。表示順は生成順で決まるため、後から作る文字より先に置く必要がある。
    const card = scene.add.graphics();
    this.frame.push(card);

    const title = addLabel(scene, metrics, 0, 0, options.title, { size: 34, bold: true }).setOrigin(0.5, 0);
    const windowHeight = padding * 2 + title.height + gap + tabHeight + gap + rowsHeight + gap + actionHeight;
    const window = centerWindow(metrics, area, windowWidth, windowHeight);
    const centerX = window.x + windowWidth / 2;

    drawBox(card, window, { fill: COLOR.cardFace, radius: metrics.px(SIZE.radius) });

    title.setPosition(centerX, window.y + padding);
    this.frame.push(title);

    const tabsY = window.y + padding + title.height + gap;
    const tabGap = metrics.px(TAB_GAP);
    const tabsWidth = windowWidth - padding * 2;
    const tabWidth = (tabsWidth - tabGap * (options.tabs.length - 1)) / Math.max(1, options.tabs.length);
    options.tabs.forEach((tab, index) => {
      const button = addTextButton(
        scene,
        metrics,
        { x: window.x + padding + index * (tabWidth + tabGap), y: tabsY, width: tabWidth, height: tabHeight },
        tab.name,
        { fill: COLOR.button },
        () => this.select(index),
      );
      button.setBoxStyle(this.tabStyle(index === this.selected));
      this.tabButtons.push(button);
      this.frame.push(button);
    });

    this.rowsX = window.x + padding;
    this.rowsY = tabsY + tabHeight + gap;
    this.rowsWidth = tabsWidth;

    const actionWidth = Math.min(metrics.px(ACTION_MAX_WIDTH), tabsWidth);
    this.frame.push(
      addTextButton(
        scene,
        metrics,
        {
          x: centerX - actionWidth / 2,
          y: this.rowsY + rowsHeight + gap,
          width: actionWidth,
          height: actionHeight,
        },
        '閉じる',
        { fill: COLOR.button },
        () => {
          this.close();
          options.onClose();
        },
      ),
    );

    this.buildRows();
  }

  private select(index: number): void {
    if (index === this.selected) return;

    this.selected = index;
    this.tabButtons.forEach((button, i) => button.setBoxStyle(this.tabStyle(i === index)));
    this.buildRows();
  }

  /** 選ばれているタブのバーを並べ直す。件数が少ないタブでは下が余るだけで、枠の高さは変わらない。 */
  private buildRows(): void {
    for (const row of this.rows) row.destroy();

    const rowHeight = StatusBar.height(this.metrics);
    const rowGap = this.metrics.px(ROW_GAP);
    this.rows = (this.options.tabs[this.selected]?.entries ?? []).map(
      (entry, index) =>
        new StatusBar(
          this.scene,
          this.metrics,
          this.rowsX,
          this.rowsY + index * (rowHeight + rowGap),
          this.rowsWidth,
          entry,
          NAME_WIDTH,
        ),
    );
  }

  /**
   * 選ばれているタブは塗りと枠線の色で示す（新規ゲーム画面の選択肢と同じ扱い）。文字色は変えない——
   * Button.setBoxStyleが差し替えられるのは枠だけで、切り替えのたびに文字を作り直さずに済ませるため。
   */
  private tabStyle(active: boolean): BoxStyle {
    return {
      fill: active ? COLOR.selectedOptionFace : COLOR.button,
      border: active ? COLOR.selectedOptionBorder : COLOR.buttonBorder,
      borderWidth: this.metrics.px(active ? 4 : 2),
      radius: this.metrics.px(SIZE.radius),
    };
  }

  close(): void {
    for (const row of this.rows) row.destroy();
    this.rows = [];
    for (const object of this.frame) object.destroy();
    this.frame.length = 0;
  }
}
