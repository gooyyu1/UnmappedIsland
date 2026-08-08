import type Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import { addTextButton } from './Button';
import { addLabel } from './labels';
import { addPanel, drawBox } from './shapes';
import { COLOR, SIZE } from './theme';

/** 一覧の寸法（モーダルとして画面の中央に置く）。 */
const WINDOW_MAX_WIDTH = 760;
const PADDING = 32;
const GAP = 16;
const TITLE_SIZE = 28;
const TAB_HEIGHT = 64;
const ENTRY_HEIGHT = 72;
const CLOSE_HEIGHT = 72;

/** 一覧に並ぶレシピ1つ。 */
export interface RecipeEntry {
  /** 完成品の表示名。 */
  readonly label: string;

  /** 満たしていない解放条件の理由（SkillSystem.md 4節）。解放済みならundefined。 */
  readonly lockedReason: string | undefined;

  readonly onSelect: () => void;
}

/** タブ1つ。カテゴリはタグ（GameElementDefinition.md 4.1節）で表す。 */
export interface RecipeCategory {
  readonly label: string;
  readonly entries: readonly RecipeEntry[];
}

export interface RecipeWindowOptions {
  readonly title: string;
  readonly categories: readonly RecipeCategory[];

  /** 作れるものが1つも無いカテゴリに出す1行。 */
  readonly emptyText: string;

  readonly onClose: () => void;
}

/**
 * 何を作るかを選ぶ一覧（RecipeSystem.md）。レシピボタンから開く。
 *
 * カテゴリごとのタブに分かれ、レシピを選ぶと呼び出し側が製作中オブジェクトを現在地へ生成する。
 * 解放条件を満たしていないレシピも**理由つきで並べる**——作れないものが見えないと、必要な
 * レシピに辿り着けないまま詰むため（SkillSystem.md 4節）。
 */
export class RecipeWindow {
  private readonly scene: Phaser.Scene;
  private readonly metrics: ScreenMetrics;
  private readonly options: RecipeWindowOptions;

  /** 開いている間ずっと出ているもの。タブの見た目は選択で変わるので、こちらも作り直す。 */
  private frame: Phaser.GameObjects.GameObject[] = [];

  /** 選んだタブの中身。切り替えのたびに作り直す。 */
  private body: Phaser.GameObjects.GameObject[] = [];

  private readonly overlay: Phaser.GameObjects.GameObject;
  private readonly area: Rect;
  private readonly tabsTop: number;
  private readonly bodyTop: number;
  private selected = 0;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, options: RecipeWindowOptions) {
    this.scene = scene;
    this.metrics = metrics;
    this.options = options;

    this.overlay = addPanel(
      scene,
      { x: 0, y: 0, width: metrics.width, height: metrics.height },
      COLOR.modalOverlay,
      0.5,
    );

    const padding = metrics.px(PADDING);
    const gap = metrics.px(GAP);
    const width = Math.min(metrics.px(WINDOW_MAX_WIDTH), metrics.width * 0.9);
    const rows = Math.max(
      1,
      options.categories.reduce((most, c) => Math.max(most, c.entries.length), 0),
    );
    const tabsHeight = options.categories.length > 1 ? metrics.px(TAB_HEIGHT) + gap : 0;
    const height = Math.min(
      metrics.height * 0.92,
      padding * 2 +
        metrics.px(TITLE_SIZE) +
        gap +
        tabsHeight +
        rows * metrics.px(ENTRY_HEIGHT) +
        (rows - 1) * gap +
        gap +
        metrics.px(CLOSE_HEIGHT),
    );

    this.area = { x: (metrics.width - width) / 2, y: (metrics.height - height) / 2, width, height };
    this.tabsTop = this.area.y + padding + metrics.px(TITLE_SIZE) + gap;
    this.bodyTop = this.tabsTop + tabsHeight;

    this.build();
  }

  /** 枠（背景・見出し・タブ・閉じる）を作る。タブの選択状態が変わるたび作り直す。 */
  private build(): void {
    const { scene, metrics } = this;
    const padding = metrics.px(PADDING);

    const card = scene.add.graphics();
    drawBox(card, this.area, { fill: COLOR.cardFace, radius: metrics.px(SIZE.radius) });
    this.frame.push(card);

    this.frame.push(
      addLabel(scene, metrics, this.area.x + padding, this.area.y + padding, this.options.title, {
        size: TITLE_SIZE,
      }),
    );

    this.addTabs();

    this.frame.push(
      addTextButton(
        scene,
        metrics,
        {
          x: this.area.x + padding,
          y: this.area.y + this.area.height - padding - metrics.px(CLOSE_HEIGHT),
          width: this.area.width - padding * 2,
          height: metrics.px(CLOSE_HEIGHT),
        },
        '閉じる',
        { fill: COLOR.button },
        this.options.onClose,
      ),
    );

    this.showCategory(this.selected);
  }

  /** カテゴリのタブ。1つしか無ければ出さない（切り替え先が無い行に場所を取らせない）。 */
  private addTabs(): void {
    const categories = this.options.categories;
    if (categories.length <= 1) return;

    const padding = this.metrics.px(PADDING);
    const gap = this.metrics.px(8);
    const inner = this.area.width - padding * 2;
    const width = (inner - gap * (categories.length - 1)) / categories.length;

    categories.forEach((category, index) => {
      this.frame.push(
        addTextButton(
          this.scene,
          this.metrics,
          {
            x: this.area.x + padding + index * (width + gap),
            y: this.tabsTop,
            width,
            height: this.metrics.px(TAB_HEIGHT),
          },
          category.label,
          { fill: index === this.selected ? COLOR.buttonActive : COLOR.button },
          () => this.select(index),
        ),
      );
    });
  }

  private select(index: number): void {
    if (index === this.selected) return;
    this.selected = index;
    this.clear(this.frame);
    this.frame = [];
    this.build();
  }

  /** 選んだタブの中身へ差し替える。 */
  private showCategory(index: number): void {
    this.clear(this.body);
    this.body = [];

    const padding = this.metrics.px(PADDING);
    const gap = this.metrics.px(GAP);
    const width = this.area.width - padding * 2;
    const entries = this.options.categories[index]?.entries ?? [];

    if (entries.length === 0) {
      this.body.push(
        addLabel(this.scene, this.metrics, this.area.x + padding, this.bodyTop, this.options.emptyText, {
          size: 22,
        }),
      );
      return;
    }

    entries.forEach((entry, row) => {
      const locked = entry.lockedReason !== undefined;
      this.body.push(
        addTextButton(
          this.scene,
          this.metrics,
          {
            x: this.area.x + padding,
            y: this.bodyTop + row * (this.metrics.px(ENTRY_HEIGHT) + gap),
            width,
            height: this.metrics.px(ENTRY_HEIGHT),
          },
          locked ? `${entry.label}（${entry.lockedReason}）` : entry.label,
          { fill: locked ? COLOR.buttonDisabled : COLOR.button },
          () => {
            if (!locked) entry.onSelect();
          },
        ),
      );
    });
  }

  private clear(objects: readonly Phaser.GameObjects.GameObject[]): void {
    for (const object of objects) object.destroy();
  }

  destroy(): void {
    this.clear(this.body);
    this.clear(this.frame);
    this.overlay.destroy();
  }
}
