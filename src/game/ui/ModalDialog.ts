import type Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import type { Button } from './Button';
import { addTextButton } from './Button';
import type { CardContent } from './Card';
import { Card } from './Card';
import { cardFace } from './cardFace';
import { addLabel } from '../../ui/labels';
import { addInputBlockingPanel, drawBox } from '../../ui/shapes';
import { COLOR, SIZE } from '../looks/theme';

/**
 * モーダルの寸法（StartScreen_Mock.htmlの.modal-card/.modal-button）。**子ウィンドウの寸法
 * （childWindowLayout）とは別の系統**で、値も揃わない——あちらはフィールドの上に開く窓、こちらは
 * 画面を覆うモーダルで、由来するモックが違う。台紙をPLATEと呼ぶのは、ここでのcardが札ではなく
 * モーダルの紙を指してしまうため。
 */
const PLATE_MAX_WIDTH = 520;
const PLATE_PADDING = 32;
const PLATE_GAP = 24;
const BUTTON_HEIGHT = 72;
const BUTTON_GAP = 16;

/**
 * 見出しの上に置く札の高さ（u単位）。原寸（SIZE.cardHeight）では台紙の半分以上を占めてしまうので、
 * 縦横同率で縮めて載せる。
 */
const PORTRAIT_HEIGHT = 200;

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
  /**
   * 見出しの上に置く札（誰の話かを絵で示す。死亡ダイアログのポートレイト）。押せる札にはならない
   * ——モーダルの中で行き先を持つのはボタンだけ。
   */
  readonly card?: CardContent;
}

/**
 * 画面の上に重ねる確認・通知のモーダル。
 * 取り消せない操作の確認は必須（StartScreen.md 設計原則「削除は確認必須」）。
 */
export class ModalDialog {
  private readonly ownedObjects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, options: ModalDialogOptions) {
    const { width, height } = metrics;
    this.ownedObjects.push(
      addInputBlockingPanel(scene, { x: 0, y: 0, width, height }, COLOR.modalOverlay, 0.5),
    );

    const plateWidth = Math.min(metrics.px(PLATE_MAX_WIDTH), width * 0.88);
    const padding = metrics.px(PLATE_PADDING);
    const gap = metrics.px(PLATE_GAP);
    const actionHeight = metrics.px(BUTTON_HEIGHT);
    const contentWidth = plateWidth - padding * 2;

    // 台紙は寸法が決まる前に作る。表示順は生成順で決まるため、後から作る札・文字より先に置く必要がある。
    const plate = scene.add.graphics();
    this.ownedObjects.push(plate);

    const portrait = options.card === undefined ? undefined : this.addPortrait(scene, metrics, options.card);
    const portraitHeight = portrait === undefined ? 0 : metrics.px(PORTRAIT_HEIGHT) + gap;

    const title = addLabel(scene, metrics, 0, 0, options.title, {
      size: 28,
      bold: true,
      wrapWidthPx: contentWidth,
    })
      .setOrigin(0.5, 0)
      .setAlign('center');
    const body = addLabel(scene, metrics, 0, 0, options.body, { size: 24, wrapWidthPx: contentWidth })
      .setOrigin(0.5, 0)
      .setAlign('center');

    const plateHeight = padding * 2 + portraitHeight + title.height + gap + body.height + gap + actionHeight;
    const plateX = (width - plateWidth) / 2;
    const plateY = (height - plateHeight) / 2;

    drawBox(
      plate,
      { x: plateX, y: plateY, width: plateWidth, height: plateHeight },
      { fillColor: COLOR.cardFace, radius: metrics.px(SIZE.radius) },
    );

    const portraitWidth = metrics.px((SIZE.cardWidth * PORTRAIT_HEIGHT) / SIZE.cardHeight);
    portrait?.setPosition((width - portraitWidth) / 2, plateY + padding);
    title.setPosition(width / 2, plateY + padding + portraitHeight);
    body.setPosition(width / 2, plateY + padding + portraitHeight + title.height + gap);
    this.ownedObjects.push(title, body);

    const actionGap = metrics.px(BUTTON_GAP);
    const actionWidth = (contentWidth - actionGap * (options.actions.length - 1)) / options.actions.length;
    options.actions.forEach((action, index) => {
      this.ownedObjects.push(
        this.addAction(scene, metrics, action, {
          x: plateX + padding + index * (actionWidth + actionGap),
          y: plateY + plateHeight - padding - actionHeight,
          width: actionWidth,
          height: actionHeight,
        }),
      );
    });
  }

  close(): void {
    for (const object of this.ownedObjects) object.destroy();
    this.ownedObjects.length = 0;
  }

  /** 見出しの上の札。位置は台紙の高さが決まってから与えるので、ここでは大きさだけを決める。 */
  private addPortrait(scene: Phaser.Scene, metrics: ScreenMetrics, content: CardContent): Card {
    const card = new Card(scene, metrics, 0, 0, cardFace(content)).setScale(
      PORTRAIT_HEIGHT / SIZE.cardHeight,
    );
    this.ownedObjects.push(card);
    return card;
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
