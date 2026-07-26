import Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import { addTextButton } from './Button';
import type { CardContent } from './Card';
import { Card, EmptyCard } from './Card';
import { ProgressBar } from './ProgressBar';
import { addLabel } from './labels';
import { wheelPixels } from './scroll';
import { addPanel, drawBox } from './shapes';
import { COLOR, SIZE } from './theme';
import { wrapByCharacter } from './textLayout';

/** 子ウィンドウの内側パディングと、内容同士の間隔。 */
const WINDOW_PADDING = 32;
const CONTENT_GAP = 24;

/** 探索の進み具合を示すバーの高さ（ゲームの主操作なので、ステータスバーより大きく取る）。 */
const BAR_HEIGHT = 72;

/** 発見物の枠の数と、1枠の幅（u単位）。カードはこの幅に合わせて縮めて描く。 */
const FOUND_SLOTS = 4;
const FOUND_SLOT_WIDTH = 150;

/** 操作ボタンの高さ（アイコンボタンと同じ最小タップ領域）と、幅の上限・間隔。 */
const ACTION_HEIGHT = SIZE.iconButton;
const ACTION_MAX_WIDTH = 420;
const ACTION_GAP = 24;

export interface ExplorationWindowOptions {
  /** 探索する土地の名前。 */
  readonly locationName: string;

  /** 探索率（0〜1）。 */
  readonly ratio: number;

  /** ウィンドウの横幅。フィールドエリアと同程度を渡す（ScreenLayout.md 探索ウィンドウ節）。 */
  readonly width: number;

  /** 直前の探索で見つかったもの（アイテムと道）。枠に収まらない分は横スクロールで見る。 */
  readonly found: readonly CardContent[];

  /** 探索中は結果待ちなので、もう一度探索を始めることはできない。 */
  readonly searching: boolean;

  readonly onExplore: () => void;
  readonly onClose: () => void;
}

/**
 * ロケーションカードから開く探索の子ウィンドウ。見つかったものの枠・探索率のバーと、
 * 探索・閉じるのボタンを持つ。
 *
 * 探索率が100%でも探索は続けられる（ExplorationSystem.md 2節）ため、探索ボタンは常に押せる。
 * 100%で変わるのは「隠された道がもう見つからない」ことだけなので、それを補足の1行で伝える。
 */
export class ExplorationWindow {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  /** 発見物の並びを切り抜くマスクの形。表示物ではないので、閉じるときに個別に捨てる。 */
  private maskShape: Phaser.GameObjects.Graphics | undefined;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, options: ExplorationWindowOptions) {
    const { width, height } = metrics;
    this.objects.push(addPanel(scene, { x: 0, y: 0, width, height }, COLOR.modalOverlay, 0.5));

    // 縦型はフィールドエリアが画面幅いっぱいなので、左右に画面の余白が残るところまでは絞る。
    const windowWidth = Math.min(options.width, width * 0.92);
    const padding = metrics.px(WINDOW_PADDING);
    const gap = metrics.px(CONTENT_GAP);
    const barHeight = metrics.px(BAR_HEIGHT);
    const actionHeight = metrics.px(ACTION_HEIGHT);
    const contentWidth = windowWidth - padding * 2;

    // 台紙は寸法が決まる前に作る。表示順は生成順で決まるため、後から作る文字より先に置く必要がある。
    const card = scene.add.graphics();
    this.objects.push(card);

    const title = addLabel(scene, metrics, 0, 0, options.locationName, { size: 34, bold: true })
      .setOrigin(0.5, 0)
      .setAlign('center');
    title.setWordWrapCallback(wrapByCharacter(contentWidth));
    const note = addLabel(scene, metrics, 0, 0, noteFor(options.ratio), {
      size: 24,
      color: COLOR.textMuted,
    })
      .setOrigin(0.5, 0)
      .setAlign('center');
    note.setWordWrapCallback(wrapByCharacter(contentWidth));

    const slotWidth = Math.min(
      metrics.px(FOUND_SLOT_WIDTH),
      (contentWidth - metrics.px(SIZE.gap) * (FOUND_SLOTS - 1)) / FOUND_SLOTS,
    );
    const foundHeight = (slotWidth * SIZE.cardHeight) / SIZE.cardWidth;

    const windowHeight =
      padding * 2 +
      title.height +
      gap +
      foundHeight +
      gap +
      barHeight +
      gap +
      note.height +
      gap +
      actionHeight;
    const windowX = (width - windowWidth) / 2;
    const windowY = (height - windowHeight) / 2;
    drawBox(
      card,
      { x: windowX, y: windowY, width: windowWidth, height: windowHeight },
      { fill: COLOR.cardFace, radius: metrics.px(SIZE.radius) },
    );

    title.setPosition(width / 2, windowY + padding);
    this.objects.push(title, note);

    let cursorY = windowY + padding + title.height + gap;
    this.addFound(scene, metrics, options.found, {
      x: windowX + (windowWidth - (slotWidth * FOUND_SLOTS + metrics.px(SIZE.gap) * (FOUND_SLOTS - 1))) / 2,
      y: cursorY,
      width: slotWidth * FOUND_SLOTS + metrics.px(SIZE.gap) * (FOUND_SLOTS - 1),
      height: foundHeight,
    });

    cursorY += foundHeight + gap;
    this.objects.push(
      new ProgressBar(scene, metrics, windowX + padding, cursorY, contentWidth, barHeight, options.ratio),
      addLabel(scene, metrics, width / 2, cursorY + barHeight / 2, percentOf(options.ratio), {
        size: 32,
        bold: true,
      }).setOrigin(0.5),
    );

    cursorY += barHeight + gap;
    note.setPosition(width / 2, cursorY);

    cursorY += note.height + gap;
    const actionWidth = Math.min(metrics.px(ACTION_MAX_WIDTH), (contentWidth - metrics.px(ACTION_GAP)) / 2);
    const actionsX = (width - (actionWidth * 2 + metrics.px(ACTION_GAP))) / 2;
    this.objects.push(
      addTextButton(
        scene,
        metrics,
        { x: actionsX, y: cursorY, width: actionWidth, height: actionHeight },
        '探索する',
        { fill: options.searching ? COLOR.buttonDisabled : COLOR.primaryButton },
        options.searching ? () => undefined : options.onExplore,
      ),
      addTextButton(
        scene,
        metrics,
        {
          x: actionsX + actionWidth + metrics.px(ACTION_GAP),
          y: cursorY,
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
  }

  /**
   * 見つかったものを並べる枠。枠はFOUND_SLOTS個で固定し、収まらない分は横スクロールで送る。
   * 枠からはみ出したカードは、レーンと違って背景板では隠せないのでマスクで切り抜く。
   *
   * カードは1枚をレーンと同じ形のまま、枠の幅に合わせて縮めて描く。
   */
  private addFound(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    found: readonly CardContent[],
    viewport: Rect,
  ): void {
    const gap = metrics.px(SIZE.gap);
    const slotWidth = (viewport.width - gap * (FOUND_SLOTS - 1)) / FOUND_SLOTS;
    const scale = slotWidth / metrics.px(SIZE.cardWidth);
    const pitch = slotWidth + gap;

    const strip = scene.add.container(viewport.x, viewport.y);
    this.objects.push(strip);
    for (let i = 0; i < Math.max(FOUND_SLOTS, found.length); i++) {
      const content = found[i];
      const slot =
        content === undefined
          ? new EmptyCard(scene, metrics, 0, 0)
          : new Card(scene, metrics, 0, 0, { icon: content.icon, name: content.name });
      strip.add(slot.setPosition(i * pitch, 0).setScale(scale));
    }

    const contentWidth = Math.max(FOUND_SLOTS, found.length) * pitch - gap;
    const minScrollX = Math.min(0, viewport.width - contentWidth);
    if (minScrollX === 0) return;

    // 送る必要があるときだけ、枠からはみ出す分を切り抜く。切り抜きはフィルタとしてのマスクで行う
    // （Phaser 4のsetMaskはCanvas専用）。マスクの形は表示物ではないので画面には出さない。
    this.maskShape = scene.make.graphics({});
    this.maskShape.fillStyle(COLOR.cardFace, 1);
    this.maskShape.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
    strip.enableFilters();
    strip.filters?.internal.addMask(this.maskShape);

    const scrollTo = (scrollX: number): void => {
      strip.x = viewport.x + Phaser.Math.Clamp(scrollX, minScrollX, 0);
    };
    let scrollStartX = 0;
    const surface = addPanel(scene, viewport, COLOR.cardFace, 0);
    this.objects.push(surface);
    scene.input.setDraggable(surface);
    surface.on('dragstart', () => {
      scrollStartX = strip.x - viewport.x;
    });
    surface.on('drag', (pointer: Phaser.Input.Pointer) =>
      scrollTo(scrollStartX + (pointer.x - pointer.downX)),
    );
    surface.on('wheel', (pointer: Phaser.Input.Pointer, deltaX: number, deltaY: number) => {
      scrollTo(strip.x - viewport.x - wheelPixels(pointer, deltaX, deltaY));
    });
  }

  close(): void {
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
    this.maskShape?.destroy();
    this.maskShape = undefined;
  }
}

/** 探索率は整数の%で見せる。100%に届いていない進捗を切り上げて100%と誤解させないよう切り捨てる。 */
function percentOf(ratio: number): string {
  return `${Math.min(100, Math.trunc(ratio * 100))}%`;
}

function noteFor(ratio: number): string {
  return ratio >= 1
    ? 'この土地に隠された道はすべて見つけた。探索を続ければ、まだ何かは見つかる。'
    : '探索を続けると、アイテムや他の土地へ続く道が見つかる。';
}
