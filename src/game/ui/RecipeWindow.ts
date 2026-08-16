import type Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { addTextButton } from './Button';
import type { CardContent } from './Card';
import { Card } from './Card';
import { clipToRect } from '../../ui/clip';
import { addLabel } from '../../ui/labels';
import { wheelPixels } from '../../ui/scroll';
import { addPanel, drawBox } from '../../ui/shapes';
import { COLOR, SIZE } from '../looks/theme';

/** 一覧の寸法（モーダルとして画面の中央に置く）。 */
const WINDOW_MAX_WIDTH = 760;
const PADDING = 32;
const GAP = 16;
const TITLE_SIZE = 28;
const TAB_HEIGHT = 64;
/** 折り返しで並べるカードの間隔と、スクロールせずに見せる段数。 */
const CARD_GAP = 12;
const VISIBLE_ROWS = 2;
const CLOSE_HEIGHT = 72;

/** 一覧に並ぶレシピ1つ。完成品のカードとして出す。 */
export interface RecipeEntry {
  /** 完成品のカード（絵と名前）。押すとそのレシピを選ぶ。 */
  readonly card: CardContent;

  /** 満たしていない解放条件の理由（SkillSystem.md 4節）。解放済みならundefined。 */
  readonly lockedReason: string | undefined;

  /**
   * originは押した時点でそのカードが居た画面上の矩形。製作中オブジェクトのカードはここから
   * 飛んでくる（CardInteraction.md 6節 カードの移動アニメーション）。
   */
  readonly onSelect: (origin: Rect) => void;
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
    const tabsHeight = options.categories.length > 1 ? metrics.px(TAB_HEIGHT) + gap : 0;
    const cardHeight = metrics.px(SIZE.cardHeight);
    const cardGap = metrics.px(CARD_GAP);
    // 段数はスクロールせずに見せるぶんで決め打つ。これを超える分は縦にスクロールさせる。
    const rows = Math.min(VISIBLE_ROWS, Math.max(1, this.rowsNeeded(width - padding * 2, metrics)));
    const height = Math.min(
      metrics.height * 0.92,
      padding * 2 +
        metrics.px(TITLE_SIZE) +
        gap +
        tabsHeight +
        rows * cardHeight +
        (rows - 1) * cardGap +
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

  /** 1列に何枚並ぶか。窓の内寸をカードの幅で割る（最低1枚）。 */
  private columns(innerWidth: number, metrics: ScreenMetrics): number {
    const cardWidth = metrics.px(SIZE.cardWidth);
    const gap = metrics.px(CARD_GAP);
    return Math.max(1, Math.floor((innerWidth + gap) / (cardWidth + gap)));
  }

  /** どのタブでも収まるだけの段数（窓の高さを決めるために、最も多いタブで測る）。 */
  private rowsNeeded(innerWidth: number, metrics: ScreenMetrics): number {
    const columns = this.columns(innerWidth, metrics);
    return this.options.categories.reduce(
      (most, category) => Math.max(most, Math.ceil(category.entries.length / columns)),
      1,
    );
  }

  /**
   * 選んだタブの中身へ差し替える。完成品のカードを左から並べ、窓の幅で折り返す。
   * 見せる段数（VISIBLE_ROWS）に収まらない分は、縦にスクロールして送る。
   */
  private showCategory(index: number): void {
    this.clear(this.body);
    this.body = [];

    const { scene, metrics } = this;
    const padding = metrics.px(PADDING);
    const innerWidth = this.area.width - padding * 2;
    const entries = this.options.categories[index]?.entries ?? [];

    if (entries.length === 0) {
      this.body.push(
        addLabel(scene, metrics, this.area.x + padding, this.bodyTop, this.options.emptyText, { size: 22 }),
      );
      return;
    }

    const cardWidth = metrics.px(SIZE.cardWidth);
    const cardHeight = metrics.px(SIZE.cardHeight);
    const cardGap = metrics.px(CARD_GAP);
    const columns = this.columns(innerWidth, metrics);
    const viewHeight =
      this.area.y + this.area.height - padding - metrics.px(CLOSE_HEIGHT) - metrics.px(GAP) - this.bodyTop;

    // カードは1つのコンテナへ入れて、窓の中だけに切り抜く。スクロールはこのコンテナを上下へ送る。
    const viewport = scene.add.container(0, 0);
    const releaseClip = clipToRect(scene, viewport, {
      x: this.area.x + padding,
      y: this.bodyTop,
      width: innerWidth,
      height: viewHeight,
    });
    this.body.push(viewport);

    entries.forEach((entry, position) => {
      const column = position % columns;
      const row = Math.floor(position / columns);
      const locked = entry.lockedReason !== undefined;
      const x = this.area.x + padding + column * (cardWidth + cardGap);
      const y = this.bodyTop + row * (cardHeight + cardGap);
      const card = new Card(scene, metrics, x, y, {
        ...entry.card,
        // 未解放のレシピも並べる。押せないことは名前の後ろの理由で伝える。
        name: locked ? `${entry.card.name}（${entry.lockedReason}）` : entry.card.name,
        // 送られていることがあるので、居場所は押した時点で測る（viewportの送り量を足す）。
        onTap: locked
          ? undefined
          : () => entry.onSelect({ x, y: y + viewport.y, width: cardWidth, height: cardHeight }),
      });
      viewport.add(card);
    });

    const contentHeight = Math.ceil(entries.length / columns) * (cardHeight + cardGap) - cardGap;
    this.addScrolling(viewport, contentHeight - viewHeight);
    this.body.push({ destroy: releaseClip } as unknown as Phaser.GameObjects.GameObject);
  }

  /** はみ出した高さぶんだけ、ホイールとドラッグで送れるようにする。 */
  private addScrolling(viewport: Phaser.GameObjects.Container, overflow: number): void {
    if (overflow <= 0) return;

    const move = (delta: number) => {
      viewport.y = Math.min(0, Math.max(-overflow, viewport.y + delta));
    };

    const onWheel = (pointer: Phaser.Input.Pointer, _over: unknown, deltaX: number, deltaY: number): void => {
      move(-wheelPixels(pointer, deltaX, deltaY));
    };
    this.scene.input.on('wheel', onWheel);

    let dragging = false;
    let lastY = 0;
    const onDown = (pointer: Phaser.Input.Pointer): void => {
      dragging = true;
      lastY = pointer.y;
    };
    const onMove = (pointer: Phaser.Input.Pointer): void => {
      if (!dragging) return;
      move(pointer.y - lastY);
      lastY = pointer.y;
    };
    const onUp = (): void => {
      dragging = false;
    };
    this.scene.input.on('pointerdown', onDown);
    this.scene.input.on('pointermove', onMove);
    this.scene.input.on('pointerup', onUp);

    this.body.push({
      destroy: () => {
        this.scene.input.off('wheel', onWheel);
        this.scene.input.off('pointerdown', onDown);
        this.scene.input.off('pointermove', onMove);
        this.scene.input.off('pointerup', onUp);
      },
    } as unknown as Phaser.GameObjects.GameObject);
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
