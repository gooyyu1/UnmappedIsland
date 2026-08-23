import type Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { TabButtons, addTextButton } from './Button';
import { ScrollArea } from '../../ui/scrollArea';
import type { ObjectWindowLane, ObjectWindowPane } from './ObjectWindowPane';
import type { StatusContent } from './StatusBar';
import { StatusBar } from './StatusBar';
import { addInputBlockingPanel } from '../../ui/shapes';
import { COLOR, SIZE } from '../looks/theme';

/** カテゴリの縦タブの幅と、タブ同士・行同士の間隔。 */
const CATEGORY_WIDTH = 180;
const CATEGORY_HEIGHT = SIZE.iconButton;
const CATEGORY_GAP = 12;
const ROW_GAP = 16;

/**
 * 名前欄の幅。ステータスエリアと違って絵に表示名を添えるので（絵と名前の対応をここで覚えられる
 * ようにするため、Windows.md 6節）、「穀物・イモの栄養」のような長い名前が収まるだけ取る。
 */
const NAME_WIDTH = 260;

/**
 * この面が要る高さを決める行数。**プロパティの数で窓の寸法を変えない**ので、これを超える分は
 * 縦にスクロールして送る。
 */
const ROWS_SHOWN = 5;

/** 1つのカテゴリ（1つのプロパティタグと、そのタグが付いたプロパティ）。 */
export interface PropertyCategory {
  readonly name: string;
  readonly entries: readonly StatusContent[];
}

/**
 * オブジェクトウィンドウのプロパティのタブ（Windows.md 6節）。左にカテゴリの縦タブ、右にバーの列。
 *
 * **プロパティの数で窓の寸法は変わりません。** 収まらない分は縦にスクロールして送ります——カテゴリを
 * 切り替えるたびに枠が伸び縮みすると、どのカテゴリを見ているかより枠の動きのほうが目に付きます。
 */
export class PropertiesPane implements ObjectWindowPane {
  /** この面が要る高さ。窓の中段の高さは、最も高いタブに合わせて決まる（ObjectWindow）。 */
  static height(metrics: ScreenMetrics): number {
    return ROWS_SHOWN * StatusBar.height(metrics) + (ROWS_SHOWN - 1) * metrics.px(ROW_GAP);
  }

  /** バーはレーンではないので、この面はレーンを持たない。 */
  readonly lanes: readonly ObjectWindowLane[] = [];

  private readonly scene: Phaser.Scene;
  private readonly metrics: ScreenMetrics;
  private readonly area: Rect;

  private readonly readCategories: () => readonly PropertyCategory[];
  private categories: readonly PropertyCategory[];
  private selected = 0;

  private readonly tabs: TabButtons;
  private readonly ownedObjects: Phaser.GameObjects.GameObject[] = [];

  /** 今のカテゴリのバーだけ。切り替えのたびに捨てて作り直す。 */
  private rows: StatusBar[] = [];
  private viewport: Phaser.GameObjects.Container | undefined;

  /** はみ出した分の送りと、それを受ける面（並べ直すたびに作り直す）。 */
  private scroll: ScrollArea | undefined;
  private surface: Phaser.GameObjects.GameObject | undefined;

  constructor(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    area: Rect,
    source: () => readonly PropertyCategory[],
  ) {
    this.scene = scene;
    this.metrics = metrics;
    this.area = area;
    this.tabs = new TabButtons(metrics);
    this.readCategories = source;
    const categories = source();
    this.categories = categories;

    const height = metrics.px(CATEGORY_HEIGHT);
    const gap = metrics.px(CATEGORY_GAP);
    categories.forEach((category, index) => {
      const button = addTextButton(
        scene,
        metrics,
        { x: area.x, y: area.y + index * (height + gap), width: metrics.px(CATEGORY_WIDTH), height },
        category.name,
        { fill: COLOR.button },
        () => this.select(index),
      );
      this.tabs.add(button);
      this.ownedObjects.push(button);
    });
    this.tabs.select(this.selected);

    this.buildRows();
  }

  /**
   * 行の内容を読み直す（固定表示の印や値が変わるため）。並ぶ項目はそのオブジェクトのプロパティで
   * 決まり増減しないので、行は作り直さず中身だけ差し替える。
   */
  refresh(): void {
    this.categories = this.readCategories();
    const entries = this.categories[this.selected]?.entries ?? [];
    this.rows.forEach((row, index) => {
      const entry = entries.at(index);
      if (entry !== undefined) row.setContent(entry);
    });
  }

  private select(index: number): void {
    if (index === this.selected) return;

    this.selected = index;
    this.tabs.select(index);
    this.buildRows();
  }

  /** 選ばれているカテゴリのバーを並べ直す。窓に収まらない分はスクロールで送る。 */
  private buildRows(): void {
    const { scene, metrics, area } = this;
    for (const row of this.rows) row.destroy();
    this.rows = [];
    this.scroll?.destroy();
    this.scroll = undefined;
    this.surface?.destroy();
    this.viewport?.destroy();

    const left = area.x + metrics.px(CATEGORY_WIDTH) + metrics.px(CATEGORY_GAP);
    const width = area.x + area.width - left;
    const rowHeight = StatusBar.height(metrics);
    const rowGap = metrics.px(ROW_GAP);

    // ドラッグとホイールを受ける面は、**行より先に**敷く（後に敷くと行を押せなくなる）。
    const viewportRect = { x: left, y: area.y, width, height: area.height };
    this.surface = addInputBlockingPanel(scene, viewportRect, COLOR.cardFace, 0);

    const viewport = scene.add.container(0, 0);
    this.viewport = viewport;
    this.scroll = new ScrollArea(scene, {
      axis: 'y',
      content: viewport,
      viewport: viewportRect,
      inputSurfaces: [this.surface],
    });

    const entries = this.categories[this.selected]?.entries ?? [];
    this.rows = entries.map((entry, index) => {
      const row = new StatusBar(scene, metrics, left, area.y + index * (rowHeight + rowGap), width, entry, {
        label: { kind: 'withName', width: NAME_WIDTH },
      });
      viewport.add(row);
      return row;
    });

    this.scroll.setContentLength(entries.length * (rowHeight + rowGap) - rowGap);
  }

  destroy(): void {
    for (const row of this.rows) row.destroy();
    this.rows = [];
    this.scroll?.destroy();
    this.surface?.destroy();
    this.viewport?.destroy();
    for (const object of this.ownedObjects) object.destroy();
    this.ownedObjects.length = 0;
  }
}
