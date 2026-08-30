import type Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { addTextButton } from './Button';
import type { CardContent } from './Card';
import { Card } from './Card';
import { addLabel } from '../../ui/labels';
import { ScrollArea } from '../../ui/scrollArea';
import { Tooltip } from './Tooltip';
import { addInputBlockingPanel, drawBox } from '../../ui/shapes';
import { COLOR, SIZE } from '../looks/theme';
import { uiText } from '../../locale/uiTexts';
import {
  ACTION_HEIGHT,
  CONTENT_GAP,
  WINDOW_PADDING,
  centeredWindowRect,
  closeRow,
} from '../looks/childWindowLayout';

/** 一覧の寸法（モーダルとして画面の中央に置く。余白・間隔・最下段は他の子ウィンドウと同じ）。 */
const TITLE_SIZE = 28;
/** 棚の見出しと、作れるものが無いときの1行の文字の大きさ。 */
const HEADING_SIZE = 24;
/** 折り返しで並べるカードの間隔。 */
const CARD_GAP = 12;

/** 横に並べたいカードの枚数。窓の幅はこれが収まる寸法を上限にする。 */
const WINDOW_COLUMNS = 4;
const WINDOW_MAX_WIDTH =
  WINDOW_PADDING * 2 + WINDOW_COLUMNS * SIZE.cardWidth + (WINDOW_COLUMNS - 1) * CARD_GAP;

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
 * 解放条件を満たしていないレシピも**並べる**——作れないものが見えないと、必要なレシピに辿り着けない
 * まま詰むため（SkillSystem.md 4節）。押せないことは札の鍵の印が、なぜ作れないかは押している間の
 * 吹き出しが言う（Windows.md 9.3節）。
 */
export class RecipeWindow {
  private readonly scene: Phaser.Scene;
  private readonly metrics: ScreenMetrics;
  private readonly options: RecipeWindowOptions;

  /** 開いている間ずっと出ているもの（背景・見出し・カード・閉じる）。 */
  private readonly ownedObjects: Phaser.GameObjects.GameObject[] = [];

  private readonly area: Rect;
  private readonly bodyTop: number;

  /** 1列に並ぶカードの枚数。窓の内寸から決まるので、狭い画面ではWINDOW_COLUMNSより少ない。 */
  private readonly columns: number;

  /** 窓に収まらない分の送り（作れるものが1つも無ければ持たない）。 */
  private scroll: ScrollArea | undefined;

  /** 未解放の札を押している間だけ出す吹き出し（ObjectWindowと同じ持ち方で、窓が閉じるときに捨てる）。 */
  private readonly tooltip: Tooltip;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, options: RecipeWindowOptions) {
    this.scene = scene;
    this.metrics = metrics;
    this.options = options;
    // 札より先に作ってよい。手前に出ることは吹き出し自身が層で保つ（SCREEN_DEPTH.tooltip）。
    this.tooltip = new Tooltip(scene, metrics);

    // 覆いも他の表示物と同じ後片付けに載せる（closeで一括して捨てる）。
    this.ownedObjects.push(
      addInputBlockingPanel(
        scene,
        { x: 0, y: 0, width: metrics.width, height: metrics.height },
        COLOR.modalOverlay,
        0.5,
      ),
    );

    const padding = metrics.px(WINDOW_PADDING);
    const gap = metrics.px(CONTENT_GAP);
    const width = Math.min(metrics.px(WINDOW_MAX_WIDTH), metrics.width * 0.9);
    const cardWidth = metrics.px(SIZE.cardWidth);
    const cardGap = metrics.px(CARD_GAP);
    this.columns = Math.max(1, Math.floor((width - padding * 2 + cardGap) / (cardWidth + cardGap)));

    // 窓は中身の高さそのままに開き、画面に収まらない分だけスクロールへ回す。
    const chrome = padding * 2 + metrics.px(TITLE_SIZE) + gap * 2 + metrics.px(ACTION_HEIGHT);
    const height = Math.min(metrics.height * 0.92, chrome + this.contentHeight());

    this.area = centeredWindowRect(
      metrics,
      { x: 0, y: 0, width: metrics.width, height: metrics.height },
      width,
      height,
    );
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
      const between = index === 0 ? 0 : metrics.px(CONTENT_GAP);
      return total + between + heading + rows * rowHeight - metrics.px(CARD_GAP);
    }, 0);
  }

  private build(): void {
    const { scene, metrics } = this;
    const padding = metrics.px(WINDOW_PADDING);

    const box = scene.add.graphics();
    drawBox(box, this.area, { fillColor: COLOR.cardFace, radius: metrics.px(SIZE.radius) });
    this.ownedObjects.push(box);

    this.ownedObjects.push(
      addLabel(scene, metrics, this.area.x + padding, this.area.y + padding, this.options.title, {
        size: TITLE_SIZE,
      }),
    );

    this.fillBody();

    this.ownedObjects.push(
      addTextButton(
        scene,
        metrics,
        closeRow(metrics, this.area),
        uiText('close'),
        { fill: COLOR.button },
        () => {
          this.close();
          this.options.onClose();
        },
      ),
    );
  }

  /** 棚の見出しと、その下に折り返して並ぶ完成品のカードを積む。窓からはみ出す分はスクロールで送る。 */
  private fillBody(): void {
    const { scene, metrics } = this;
    const padding = metrics.px(WINDOW_PADDING);
    const left = this.area.x + padding;
    const innerWidth = this.area.width - padding * 2;
    const viewHeight =
      this.area.y +
      this.area.height -
      padding -
      metrics.px(ACTION_HEIGHT) -
      metrics.px(CONTENT_GAP) -
      this.bodyTop;

    if (this.options.categories.length === 0) {
      this.ownedObjects.push(
        addLabel(scene, metrics, left, this.bodyTop, this.options.emptyText, { size: HEADING_SIZE }),
      );
    } else {
      this.fillCategories(left, innerWidth, viewHeight);
    }
  }

  /** 棚ごとの見出しとカードを、送れるコンテナへ積む。 */
  private fillCategories(left: number, innerWidth: number, viewHeight: number): void {
    const { scene, metrics } = this;

    // ドラッグとホイールを受ける面は、**中身より先に**敷く（後に敷くとカードを押せなくなる）。
    // 面だけでは札に覆われて指が届かないので、札も一緒に送りへ渡す（ScrollArea.inputSurfaces）。
    const area = { x: left, y: this.bodyTop, width: innerWidth, height: viewHeight };
    const surface = addInputBlockingPanel(scene, area, COLOR.cardFace, 0);
    this.ownedObjects.push(surface);

    // 中身は1つのコンテナへ入れて、窓の中だけに切り抜く。スクロールはこのコンテナを上下へ送る。
    const viewport = scene.add.container(0, 0);
    this.ownedObjects.push(viewport);

    const cardWidth = metrics.px(SIZE.cardWidth);
    const cardHeight = metrics.px(SIZE.cardHeight);
    const cardGap = metrics.px(CARD_GAP);

    /** 送りも受ける札（ScrollArea.inputSurfaces）。札は面を覆うので、札の上から送れないと窓が動かない。 */
    const cards: Card[] = [];
    let top = this.bodyTop;
    this.options.categories.forEach((category, index) => {
      if (index > 0) top += metrics.px(CONTENT_GAP);
      viewport.add(addLabel(scene, metrics, left, top, category.label, { size: HEADING_SIZE, bold: true }));
      top += metrics.px(HEADING_SIZE) + cardGap;

      const rowTop = top;
      category.entries.forEach((entry, position) => {
        const lockedReason = entry.lockedReason;
        const x = left + (position % this.columns) * (cardWidth + cardGap);
        const y = rowTop + Math.floor(position / this.columns) * (cardHeight + cardGap);
        // 送られていることがあるので、居場所は押した時点で測る（viewportの送り量を足す）。
        const rect = (): Rect => ({ x, y: y + viewport.y, width: cardWidth, height: cardHeight });
        const card = new Card(scene, metrics, x, y, {
          ...entry.card,
          onTap: lockedReason === undefined ? () => entry.onSelect(rect()) : undefined,
          // 未解放のレシピは押しても選べない。なぜ作れないかは、押している間の吹き出しで言う。
          hold:
            lockedReason === undefined
              ? undefined
              : {
                  onStart: () => this.tooltip.show({ title: entry.card.name, body: lockedReason }, rect()),
                  onEnd: () => this.tooltip.hide(),
                  // 押せない札を待たせる理由が無い（ObjectWindowの押せないボタンと同じ）。
                  delayMs: 0,
                },
        });
        cards.push(card);
        viewport.add(card);
      });
      top += Math.ceil(category.entries.length / this.columns) * (cardHeight + cardGap) - cardGap;
    });

    this.scroll = new ScrollArea(scene, {
      axis: 'y',
      content: viewport,
      viewport: area,
      inputSurfaces: [surface, ...cards],
    });
    this.scroll.setContentLength(top - this.bodyTop);
  }

  /** 窓を畳む。**2度呼ばれても壊れない**——「閉じる」ボタンからと、呼び元の後片付けからの2回通る。 */
  close(): void {
    this.scroll?.destroy();
    this.tooltip.destroy();
    for (const object of this.ownedObjects) object.destroy();
    this.ownedObjects.length = 0;
  }
}
