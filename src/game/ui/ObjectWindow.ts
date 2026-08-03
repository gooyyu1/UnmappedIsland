import type Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import { addTextButton } from './Button';
import type { HoldHandlers } from './Button';
import type { CardContent } from './Card';
import { Card, cardFace } from './Card';
import {
  ACTION_GAP,
  ACTION_HEIGHT,
  ACTION_MAX_WIDTH,
  CONTENT_GAP,
  WINDOW_PADDING,
  centerWindow,
} from './childWindow';
import { durationText } from './durationText';
import { addLabel } from './labels';
import { addPanel, drawBox } from './shapes';
import { COLOR, SIZE } from './theme';
import { wrapByCharacter } from './textLayout';
import { Tooltip } from './Tooltip';
import type { TooltipContent } from './Tooltip';

/** 見出しと説明文の間隔。同じまとまりなので、内容同士の間隔より詰める。 */
const TITLE_GAP = 12;

/** ウィンドウの横幅（プロパティウィンドウと揃える）。狭い画面ではカードごと縮める。 */
const WINDOW_WIDTH = 760;

/** 説明文がまだ用意されていないオブジェクトに出す、代わりの1行。 */
const NO_DESCRIPTION = 'これについて分かっていることはまだ無い。';

/** 実行できない理由（reason、14.6節）が宣言されていないアクションに出す、代わりの1行。 */
const CANNOT_DO_NOW = '今はできない。';

/** ボタンとして並べる1つの操作。説明文とかかる時間は、ボタンの長押しで吹き出しに出す。 */
export interface ObjectWindowAction {
  readonly label: string;
  readonly description: string | undefined;
  /** 実行にかかるゲーム内時間（分）。0なら吹き出しに時間の行を出さない。 */
  readonly minutes: number;
  readonly onTap: () => void;

  /**
   * 今この操作を実行できるか（conditionsを満たしているか、GameElementDefinition.md 14節）。
   * falseなら押しても実行されず、押している間だけ理由（reason）を吹き出しに出す。
   */
  readonly enabled?: boolean;

  /** 実行できない理由の文言。宣言が無ければundefined（理由を出さない）。 */
  readonly reason?: string | undefined;
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

  /** アクションのボタンを長押ししている間だけ出す吹き出し（addActions参照）。 */
  private readonly tooltip: Tooltip;

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
    const window = centerWindow(metrics, options.area, windowWidth, windowHeight);
    drawBox(board, window, { fill: COLOR.cardFace, radius: metrics.px(SIZE.radius) });

    this.objects.push(
      new Card(scene, metrics, window.x + padding, window.y + padding, cardFace(options.card)).setScale(
        scale,
      ),
    );

    const textX = window.x + padding + cardWidth + gap;
    title.setPosition(textX, window.y + padding);
    description.setPosition(textX, title.y + title.height + titleGap);
    this.objects.push(title, description);

    this.addActions(scene, metrics, options, {
      x: window.x + padding,
      y: window.y + padding + contentHeight + gap,
      width: contentWidth,
      height: actionHeight,
    });

    this.tooltip = new Tooltip(scene, metrics);
  }

  /**
   * 操作のボタンを1行に横並びにする。「閉じる」も同じ行の末尾に置く（探索ウィンドウと同じ扱い）。
   * 幅は行の中で等分し、数が少ないときに間延びしないよう上限で頭打ちにして、行ごと中央へ寄せる。
   *
   * アクションのボタンは、長押しの間だけ説明文とかかる時間を吹き出しに出す。ボタンには名前しか
   * 載らないので、実行する前に「何が起きるか・どれだけ時間を取られるか」を確かめられるようにする。
   */
  private addActions(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    options: ObjectWindowOptions,
    row: Rect,
  ): void {
    const close: ObjectWindowAction = {
      label: '閉じる',
      description: undefined,
      minutes: 0,
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
      const rect = {
        x: left + index * (buttonWidth + gap),
        y: row.y,
        width: buttonWidth,
        height: row.height,
      };
      const disabled = action.enabled === false;
      this.objects.push(
        addTextButton(
          scene,
          metrics,
          rect,
          action.label,
          disabled
            ? { fill: COLOR.buttonDisabled, textColor: COLOR.textMuted }
            : { fill: action === close ? COLOR.button : COLOR.primaryButton },
          // 押せないボタンは実行しない。押している間の吹き出し（下）だけが反応になる。
          disabled ? () => {} : action.onTap,
          action === close ? undefined : this.tooltipHandlers(action, rect, disabled),
        ),
      );
    });
  }

  /**
   * ボタンを押している間だけ出す吹き出し。実行できるアクションは長押しで「何が起きるか・どれだけ時間を
   * 取られるか」を、実行できないアクションは押した瞬間に「なぜできないか」を出す（待たせる理由が無いため）。
   */
  private tooltipHandlers(action: ObjectWindowAction, rect: Rect, disabled: boolean): HoldHandlers {
    const content: TooltipContent = disabled
      ? { title: action.label, body: action.reason ?? CANNOT_DO_NOW }
      : { title: action.label, body: action.description, note: durationText(action.minutes) };

    return {
      onStart: () => this.tooltip.show(content, rect),
      onEnd: () => this.tooltip.hide(),
      delayMs: disabled ? 0 : undefined,
    };
  }

  close(): void {
    this.tooltip.destroy();
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
  }
}
