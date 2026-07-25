import type Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import type { Button } from './Button';
import { addTextButton } from './Button';
import { addLabel } from './labels';
import { addPanel, drawBox } from './shapes';
import { COLOR, SIZE } from './theme';
import { wrapByCharacter } from './textLayout';

/** モーダルの寸法（StartScreen_Mock.htmlの.modal-card/.modal-button）。 */
const CARD_MAX_WIDTH = 520;
const CARD_PADDING = 32;
const CARD_GAP = 24;
const ACTION_HEIGHT = 72;
const ACTION_GAP = 16;

/** ボタンの見た目。取り消せない操作の確定側は警告色（danger）にする。 */
export type DialogActionStyle = 'default' | 'primary' | 'danger';

export interface DialogAction {
  readonly label: string;
  readonly style?: DialogActionStyle;
  /** 押すとモーダルは必ず閉じる。閉じた後に行うことだけを書く。 */
  readonly onTap?: () => void;
}

export interface ModalDialogOptions {
  readonly title: string;
  readonly body: string;
  readonly actions: readonly DialogAction[];
}

/**
 * 画面の上に重ねる確認・通知のモーダル。
 * 取り消せない操作の確認は必須（StartScreen.md 設計原則「削除は確認必須」）。
 */
export class ModalDialog {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, options: ModalDialogOptions) {
    const { width, height } = metrics;
    this.objects.push(addPanel(scene, { x: 0, y: 0, width, height }, COLOR.modalOverlay, 0.5));

    const cardWidth = Math.min(metrics.px(CARD_MAX_WIDTH), width * 0.88);
    const padding = metrics.px(CARD_PADDING);
    const gap = metrics.px(CARD_GAP);
    const actionHeight = metrics.px(ACTION_HEIGHT);
    const contentWidth = cardWidth - padding * 2;

    // 台紙は寸法が決まる前に作る。表示順は生成順で決まるため、後から作る文字より先に置く必要がある。
    const card = scene.add.graphics();
    this.objects.push(card);

    const title = addLabel(scene, metrics, 0, 0, options.title, { size: 28, bold: true })
      .setOrigin(0.5, 0)
      .setAlign('center');
    title.setWordWrapCallback(wrapByCharacter(contentWidth));
    const body = addLabel(scene, metrics, 0, 0, options.body, { size: 24 })
      .setOrigin(0.5, 0)
      .setAlign('center');
    body.setWordWrapCallback(wrapByCharacter(contentWidth));

    const cardHeight = padding * 2 + title.height + gap + body.height + gap + actionHeight;
    const cardX = (width - cardWidth) / 2;
    const cardY = (height - cardHeight) / 2;

    drawBox(
      card,
      { x: cardX, y: cardY, width: cardWidth, height: cardHeight },
      { fill: COLOR.cardFace, radius: metrics.px(SIZE.radius) },
    );

    title.setPosition(width / 2, cardY + padding);
    body.setPosition(width / 2, cardY + padding + title.height + gap);
    this.objects.push(title, body);

    const actionGap = metrics.px(ACTION_GAP);
    const actionWidth = (contentWidth - actionGap * (options.actions.length - 1)) / options.actions.length;
    options.actions.forEach((action, index) => {
      this.objects.push(
        this.addAction(scene, metrics, action, {
          x: cardX + padding + index * (actionWidth + actionGap),
          y: cardY + cardHeight - padding - actionHeight,
          width: actionWidth,
          height: actionHeight,
        }),
      );
    });
  }

  close(): void {
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
  }

  private addAction(scene: Phaser.Scene, metrics: ScreenMetrics, action: DialogAction, rect: Rect): Button {
    const danger = action.style === 'danger';
    return addTextButton(
      scene,
      metrics,
      rect,
      action.label,
      {
        fill: danger ? COLOR.dangerButton : action.style === 'primary' ? COLOR.primaryButton : COLOR.button,
        border: danger ? COLOR.dangerButton : undefined,
        textColor: danger ? COLOR.textOnDark : undefined,
      },
      () => {
        this.close();
        action.onTap?.();
      },
    );
  }
}
