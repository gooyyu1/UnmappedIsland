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
const PADDING = 32;
const GAP = 16;
const TITLE_SIZE = 28;
/** 棚の見出しと、作れるものが無いときの1行の文字の大きさ。 */
const HEADING_SIZE = 24;
/** 折り返しで並べるカードの間隔。 */
const CARD_GAP = 12;
const CLOSE_HEIGHT = 72;

/** 横に並べたいカードの枚数。窓の幅はこれが収まる寸法を上限にする。 */
const WINDOW_COLUMNS = 4;
const WINDOW_MAX_WIDTH = PADDING * 2 + WINDOW_COLUMNS * SIZE.cardWidth + (WINDOW_COLUMNS - 1) * CARD_GAP;

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

/** 棚1つ。カテゴリはタグ（GameElementDefinition.md 4.1節）で表す。 */
export interface RecipeCategory {
  readonly label: string;
  readonly entries: readonly RecipeEntry[];
}

export interface RecipeWindowOptions {
  readonly title: string;

  /** 棚は空でないものだけを、見せたい順に渡す（見出しだけが並ぶ行を作らない）。 */
  readonly categories: readonly RecipeCategory[];

  /** 作れるものが1つも無いときに出す1行。 */
  readonly emptyText: string;

  readonly onClose: () => void;
}

/**
 * 何を作るかを選ぶ一覧（RecipeSystem.md）。レシピボタンから開く。
 *
 * **棚は見出しとして1ページに積み、タブでは分けない**（Windows.md 9節）。タブは横幅を等分するので、
 * 棚が増えるほど文字が収まらなくなる——縦に積めば伸びるだけで、送る仕組みは既にある。
 *
 * 解放条件を満たしていないレシピも**理由つきで並べる**——作れないものが見えないと、必要な
 * レシピに辿り着けないまま詰むため（SkillSystem.md 4節）。
 */
export class RecipeWindow {
  private readonly scene: Phaser.Scene;
  private readonly metrics: ScreenMetrics;
  private readonly options: RecipeWindowOptions;

  /** 開いている間ずっと出ているもの（背景・見出し・カード・閉じる）。 */
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  private readonly overlay: Phaser.GameObjects.GameObject;
  private readonly area: Rect;
  private readonly bodyTop: number;

  /** 1列に並ぶカードの枚数。窓の内寸から決まるので、狭い画面ではWINDOW_COLUMNSより少ない。 */
  private readonly columns: number;

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
    const cardWidth = metrics.px(SIZE.cardWidth);
    const cardGap = metrics.px(CARD_GAP);
    this.columns = Math.max(1, Math.floor((width - padding * 2 + cardGap) / (cardWidth + cardGap)));

    // 窓は中身の高さそのままに開き、画面に収まらない分だけスクロールへ回す。
    const chrome = padding * 2 + metrics.px(TITLE_SIZE) + gap * 2 + metrics.px(CLOSE_HEIGHT);
    const height = Math.min(metrics.height * 0.92, chrome + this.contentHeight());

    this.area = { x: (metrics.width - width) / 2, y: (metrics.height - height) / 2, width, height };
    this.bodyTop = this.area.y + padding + metrics.px(TITLE_SIZE) + gap;

    this.build();
  }

  /** 棚をすべて積んだ高さ。窓の高さと、スクロールで送れる量の両方がこれで決まる。 */
  private contentHeight(): number {
    const { metrics } = this;
    if (this.options.categories.length === 0) return metrics.px(HEADING_SIZE);

    const rowHeight = metrics.px(SIZE.cardHeight) + metrics.px(CARD_GAP);
    return this.options.categories.reduce((total, category, index) => {
      const rows = Math.ceil(category.entries.length / this.columns);
      const heading = metrics.px(HEADING_SIZE) + metrics.px(CARD_GAP);
      const between = index === 0 ? 0 : metrics.px(GAP);
      return total + between + heading + rows * rowHeight - metrics.px(CARD_GAP);
    }, 0);
  }

  private build(): void {
    const { scene, metrics } = this;
    const padding = metrics.px(PADDING);

    const box = scene.add.graphics();
    drawBox(box, this.area, { fill: COLOR.cardFace, radius: metrics.px(SIZE.radius) });
    this.objects.push(box);

    this.objects.push(
      addLabel(scene, metrics, this.area.x + padding, this.area.y + padding, this.options.title, {
        size: TITLE_SIZE,
      }),
    );

    this.fillBody();

    this.objects.push(
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
  }

  /** 棚の見出しと、その下に折り返して並ぶ完成品のカードを積む。窓からはみ出す分はスクロールで送る。 */
  private fillBody(): void {
    const { scene, metrics } = this;
    const padding = metrics.px(PADDING);
    const left = this.area.x + padding;
    const innerWidth = this.area.width - padding * 2;
    const viewHeight =
      this.area.y + this.area.height - padding - metrics.px(CLOSE_HEIGHT) - metrics.px(GAP) - this.bodyTop;

    if (this.options.categories.length === 0) {
      this.objects.push(
        addLabel(scene, metrics, left, this.bodyTop, this.options.emptyText, { size: HEADING_SIZE }),
      );
      return;
    }

    // 中身は1つのコンテナへ入れて、窓の中だけに切り抜く。スクロールはこのコンテナを上下へ送る。
    const viewport = scene.add.container(0, 0);
    const releaseClip = clipToRect(scene, viewport, {
      x: left,
      y: this.bodyTop,
      width: innerWidth,
      height: viewHeight,
    });
    this.objects.push(viewport);

    const cardWidth = metrics.px(SIZE.cardWidth);
    const cardHeight = metrics.px(SIZE.cardHeight);
    const cardGap = metrics.px(CARD_GAP);

    let top = this.bodyTop;
    this.options.categories.forEach((category, index) => {
      if (index > 0) top += metrics.px(GAP);
      viewport.add(addLabel(scene, metrics, left, top, category.label, { size: HEADING_SIZE, bold: true }));
      top += metrics.px(HEADING_SIZE) + cardGap;

      const rowTop = top;
      category.entries.forEach((entry, position) => {
        const locked = entry.lockedReason !== undefined;
        const x = left + (position % this.columns) * (cardWidth + cardGap);
        const y = rowTop + Math.floor(position / this.columns) * (cardHeight + cardGap);
        viewport.add(
          new Card(scene, metrics, x, y, {
            ...entry.card,
            // 未解放のレシピも並べる。押せないことは名前の後ろの理由で伝える。
            name: locked ? `${entry.card.name}（${entry.lockedReason}）` : entry.card.name,
            // 送られていることがあるので、居場所は押した時点で測る（viewportの送り量を足す）。
            onTap: locked
              ? undefined
              : () => entry.onSelect({ x, y: y + viewport.y, width: cardWidth, height: cardHeight }),
          }),
        );
      });
      top += Math.ceil(category.entries.length / this.columns) * (cardHeight + cardGap) - cardGap;
    });

    this.addScrolling(viewport, top - this.bodyTop - viewHeight);
    this.objects.push({ destroy: releaseClip } as unknown as Phaser.GameObjects.GameObject);
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

    this.objects.push({
      destroy: () => {
        this.scene.input.off('wheel', onWheel);
        this.scene.input.off('pointerdown', onDown);
        this.scene.input.off('pointermove', onMove);
        this.scene.input.off('pointerup', onUp);
      },
    } as unknown as Phaser.GameObjects.GameObject);
  }

  destroy(): void {
    for (const object of this.objects) object.destroy();
    this.overlay.destroy();
  }
}
