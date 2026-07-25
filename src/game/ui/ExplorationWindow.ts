import type Phaser from 'phaser';
import type { ScreenMetrics } from '../layout/ScreenMetrics';
import { addTextButton } from './Button';
import { ProgressBar } from './ProgressBar';
import { addLabel } from './labels';
import { addPanel, drawBox } from './shapes';
import { COLOR, SIZE } from './theme';
import { wrapByCharacter } from './textLayout';

/** 子ウィンドウの内側パディングと、内容同士の間隔。 */
const WINDOW_PADDING = 32;
const CONTENT_GAP = 24;

/** 探索の進み具合を示すバーの高さ（ゲームの主操作なので、ステータスバーより大きく取る）。 */
const BAR_HEIGHT = 72;

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

  readonly onExplore: () => void;
  readonly onClose: () => void;
}

/**
 * ロケーションカードから開く探索の子ウィンドウ。探索率のバーと、探索・閉じるのボタンを持つ。
 *
 * 探索率が100%でも探索は続けられる（ExplorationSystem.md 2節）ため、探索ボタンは常に押せる。
 * 100%で変わるのは「隠された道がもう見つからない」ことだけなので、それを補足の1行で伝える。
 */
export class ExplorationWindow {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

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

    const windowHeight =
      padding * 2 + title.height + gap + barHeight + gap + note.height + gap + actionHeight;
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
        { fill: COLOR.primaryButton },
        options.onExplore,
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

  close(): void {
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
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
