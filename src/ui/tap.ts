import type Phaser from 'phaser';

/** 押して離す操作の受け口。いずれも省略できる。 */
export interface TapHandlers {
  /** 押し始めたとき（押下中の見た目へ切り替える）。 */
  readonly onPress?: () => void;
  /** 同じ表示物の上で離したとき。ここで初めて「押された」ことになる。 */
  readonly onRelease?: () => void;
  /** 押したまま外れたとき（離した先がここではなかった場合を含む）。 */
  readonly onCancel?: () => void;
}

/**
 * 押下を取り消す合図。**押している間に別の操作（送り・運び）が始まったとき**、始めた側がこれを
 * 出す。指がそこから外れたのと同じ扱いになる。
 */
const TAP_CANCEL_EVENT = 'tapcancel';

/**
 * その表示物で始まっている押下を取り消す。指を離してもonReleaseは呼ばれない。
 *
 * 押下が別の操作に変わったことを知っているのは、その操作を始めた側（ScrollArea）だけ。押した側は
 * 「もう押されたことにならない」とだけ分かればよいので、合図は取り消しの一言に留める。
 */
export function cancelTap(target: Phaser.GameObjects.GameObject): void {
  target.emit(TAP_CANCEL_EVENT);
}

/**
 * 「押して離す」を、その表示物の上で押し始めた場合だけ受け付けるように繋ぐ。
 *
 * Phaserのpointerupは押し始めた場所と関係なく「離した時点で下にあるもの」へ届くため、素直に
 * 繋ぐと、そこで押していないのに押されたことになってしまう。何かを運んで離した先や、動いている
 * ものが指の下へ滑り込んできた場合に、押していないものが押されたことになる。
 */
export function onPressRelease(target: Phaser.GameObjects.GameObject, handlers: TapHandlers): void {
  let pressed = false;

  const cancel = (): void => {
    if (!pressed) return;
    pressed = false;
    handlers.onCancel?.();
  };

  target.on('pointerdown', () => {
    pressed = true;
    handlers.onPress?.();
  });
  target.on('pointerout', cancel);
  target.on(TAP_CANCEL_EVENT, cancel);
  target.on('pointerup', () => {
    if (!pressed) return;
    pressed = false;
    handlers.onRelease?.();
  });
}
