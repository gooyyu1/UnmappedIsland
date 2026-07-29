import type Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import { addTextButton } from './Button';
import type { CardContent } from './Card';
import { Card, cardFace } from './Card';
import { addLabel } from './labels';
import { addPanel, drawBox } from './shapes';
import { COLOR, SIZE } from './theme';
import { wrapByCharacter } from './textLayout';

/** 子ウィンドウの内側パディングと、内容同士の間隔（他の子ウィンドウと揃える）。 */
const WINDOW_PADDING = 32;
const CONTENT_GAP = 24;

/** 見出しと説明文の間隔。同じまとまりなので、内容同士の間隔より詰める。 */
const TITLE_GAP = 12;

/** ウィンドウの横幅（プロパティウィンドウと揃える）。狭い画面ではカードごと縮める。 */
const WINDOW_WIDTH = 760;

/** ボタンの高さ（アイコンボタンと同じ最小タップ領域）と、幅の上限・間隔。 */
const ACTION_HEIGHT = SIZE.iconButton;
const ACTION_MAX_WIDTH = 420;
const ACTION_GAP = 24;

/** 説明文がまだ用意されていないオブジェクトに出す、代わりの1行。 */
const NO_DESCRIPTION = 'これについて分かっていることはまだ無い。';

/** ボタンとして並べる1つの操作。 */
export interface ObjectWindowAction {
  readonly label: string;
  readonly onTap: () => void;
}

export interface ObjectWindowOptions {
  /** 左に置くカード。見た目だけを使う（操作は引き継がない）。 */
  readonly card: CardContent;

  /** 右に置く説明文。無ければ代わりの1行を薄く出す。 */
  readonly description: string | undefined;

  /** 下に横並びにする操作。空でも「閉じる」だけの行になる。 */
  readonly actions: readonly ObjectWindowAction[];

  /** ウィンドウを収める領域。 */
  readonly area: Rect;

  readonly onClose: () => void;
}

/**
 * カードを押すと開く、そのオブジェクトの子ウィンドウ（ScreenLayout.md オブジェクトの子ウィンドウ節）。
 * 左にカード、右に名前と説明文、その下に操作のボタンを横並びにする。
 */
export class ObjectWindow {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, options: ObjectWindowOptions) {
    const { width, height } = metrics;
    // 中身を出し入れしない読み取り専用のウィンドウなので、覆いは画面全体に敷く（プロパティウィンドウと同じ）。
    this.objects.push(addPanel(scene, { x: 0, y: 0, width, height }, COLOR.modalOverlay, 0.5));

    const padding = metrics.px(WINDOW_PADDING);
    const gap = metrics.px(CONTENT_GAP);
    const actionHeight = metrics.px(ACTION_HEIGHT);

    const windowWidth = Math.min(metrics.px(WINDOW_WIDTH), options.area.width, width * 0.92);
    const contentWidth = windowWidth - padding * 2;
    // 横幅が足りない画面では、カードと説明文の取り分の比を保ったまま両方を縮める。
    const scale = Math.min(1, contentWidth / metrics.px(WINDOW_WIDTH - WINDOW_PADDING * 2));
    const cardWidth = metrics.px(SIZE.cardWidth) * scale;
    const cardHeight = metrics.px(SIZE.cardHeight) * scale;
    const textWidth = contentWidth - cardWidth - gap;

    // 台紙は寸法が決まる前に作る。表示順は生成順で決まるため、後から作る文字より先に置く必要がある。
    const board = scene.add.graphics();
    this.objects.push(board);

    const title = addLabel(scene, metrics, 0, 0, options.card.name, { size: 34, bold: true });
    title.setWordWrapCallback(wrapByCharacter(textWidth));
    const description = addLabel(scene, metrics, 0, 0, options.description ?? NO_DESCRIPTION, {
      size: 26,
      color: options.description === undefined ? COLOR.textMuted : COLOR.text,
    }).setLineSpacing(metrics.px(6));
    description.setWordWrapCallback(wrapByCharacter(textWidth));

    const titleGap = metrics.px(TITLE_GAP);
    const contentHeight = Math.max(cardHeight, title.height + titleGap + description.height);
    const windowHeight = padding * 2 + contentHeight + gap + actionHeight;
    const windowX = clamp(options.area.x + (options.area.width - windowWidth) / 2, 0, width - windowWidth);
    const windowY = clamp(
      options.area.y + (options.area.height - windowHeight) / 2,
      0,
      height - windowHeight,
    );
    drawBox(
      board,
      { x: windowX, y: windowY, width: windowWidth, height: windowHeight },
      { fill: COLOR.cardFace, radius: metrics.px(SIZE.radius) },
    );

    this.objects.push(
      new Card(scene, metrics, windowX + padding, windowY + padding, cardFace(options.card)).setScale(scale),
    );

    const textX = windowX + padding + cardWidth + gap;
    title.setPosition(textX, windowY + padding);
    description.setPosition(textX, title.y + title.height + titleGap);
    this.objects.push(title, description);

    this.addActions(scene, metrics, options, {
      x: windowX + padding,
      y: windowY + padding + contentHeight + gap,
      width: contentWidth,
      height: actionHeight,
    });
  }

  /**
   * 操作のボタンを1行に横並びにする。「閉じる」も同じ行の末尾に置く（探索ウィンドウと同じ扱い）。
   * 幅は行の中で等分し、数が少ないときに間延びしないよう上限で頭打ちにして、行ごと中央へ寄せる。
   */
  private addActions(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    options: ObjectWindowOptions,
    row: Rect,
  ): void {
    const close: ObjectWindowAction = {
      label: '閉じる',
      onTap: () => {
        this.close();
        options.onClose();
      },
    };
    const buttons = [...options.actions, close];

    const gap = metrics.px(ACTION_GAP);
    const buttonWidth = Math.min(
      metrics.px(ACTION_MAX_WIDTH),
      (row.width - gap * (buttons.length - 1)) / buttons.length,
    );
    const left = row.x + (row.width - (buttonWidth * buttons.length + gap * (buttons.length - 1))) / 2;

    buttons.forEach((action, index) => {
      this.objects.push(
        addTextButton(
          scene,
          metrics,
          { x: left + index * (buttonWidth + gap), y: row.y, width: buttonWidth, height: row.height },
          action.label,
          { fill: action === close ? COLOR.button : COLOR.primaryButton },
          action.onTap,
        ),
      );
    });
  }

  close(): void {
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
