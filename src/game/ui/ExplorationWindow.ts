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

/** 発見物の枠の数。1枠はレーンのカードと同じ幅で、ウィンドウの横幅はこの4枠から決まる。 */
const FOUND_SLOTS = 4;

/** 操作ボタンの高さ（アイコンボタンと同じ最小タップ領域）と、幅の上限・間隔。 */
const ACTION_HEIGHT = SIZE.iconButton;
const ACTION_MAX_WIDTH = 420;
const ACTION_GAP = 24;

export interface ExplorationWindowOptions {
  /** 探索する土地の名前。 */
  readonly locationName: string;

  /** 探索率（0〜1）。 */
  readonly ratio: number;

  /**
   * ウィンドウを収める領域。フィールドエリアを渡す（ScreenLayout.md 探索ウィンドウ節）。
   * ウィンドウはこの中央へ置く——画面の中央に置くと、縦型では状況エリアの時計を覆ってしまうため。
   */
  readonly area: Rect;

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

    const padding = metrics.px(WINDOW_PADDING);
    const gap = metrics.px(CONTENT_GAP);
    const barHeight = metrics.px(BAR_HEIGHT);
    const actionHeight = metrics.px(ACTION_HEIGHT);

    // 横幅は発見物の4枠ぶんで決める。領域（横型のフィールドエリア）に合わせて広げると横に間延びし、
    // 4枠が離れて散らばって見えるため。入りきらない画面ではその範囲まで絞る（枠が縮む、addFound参照）。
    const foundWidth = metrics.px(SIZE.cardWidth) * FOUND_SLOTS + metrics.px(SIZE.gap) * (FOUND_SLOTS - 1);
    const windowWidth = Math.min(foundWidth + padding * 2, options.area.width, width * 0.92);
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

    const slotWidth = (contentWidth - metrics.px(SIZE.gap) * (FOUND_SLOTS - 1)) / FOUND_SLOTS;
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
    // 領域の中央へ置く。領域より背が高い場合でも画面の外へは出さない。
    const windowX = clamp(options.area.x + (options.area.width - windowWidth) / 2, 0, width - windowWidth);
    const windowY = clamp(
      options.area.y + (options.area.height - windowHeight) / 2,
      0,
      height - windowHeight,
    );
    const centerX = windowX + windowWidth / 2;
    drawBox(
      card,
      { x: windowX, y: windowY, width: windowWidth, height: windowHeight },
      { fill: COLOR.cardFace, radius: metrics.px(SIZE.radius) },
    );

    title.setPosition(centerX, windowY + padding);
    this.objects.push(title, note);

    let cursorY = windowY + padding + title.height + gap;
    this.addFound(scene, metrics, options.found, {
      x: windowX + padding,
      y: cursorY,
      width: contentWidth,
      height: foundHeight,
    });

    cursorY += foundHeight + gap;
    this.objects.push(
      new ProgressBar(scene, metrics, windowX + padding, cursorY, contentWidth, barHeight, options.ratio),
      addLabel(scene, metrics, centerX, cursorY + barHeight / 2, percentOf(options.ratio), {
        size: 32,
        bold: true,
      }).setOrigin(0.5),
    );

    cursorY += barHeight + gap;
    note.setPosition(centerX, cursorY);

    cursorY += note.height + gap;
    const actionWidth = Math.min(metrics.px(ACTION_MAX_WIDTH), (contentWidth - metrics.px(ACTION_GAP)) / 2);
    const actionsX = centerX - (actionWidth * 2 + metrics.px(ACTION_GAP)) / 2;
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
   * カードはレーンと同じ寸法で描く。ウィンドウの横幅が4枠ぶんに足りない画面でだけ、収まる大きさへ縮める。
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
          : // 操作は持たせない（見つけたものを見せるだけの枠）。
            new Card(scene, metrics, 0, 0, { icon: content.icon, name: content.name, art: content.art });
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function noteFor(ratio: number): string {
  return ratio >= 1
    ? 'この土地に隠された道はすべて見つけた。探索を続ければ、まだ何かは見つかる。'
    : '探索を続けると、アイテムや他の土地へ続く道が見つかる。';
}
