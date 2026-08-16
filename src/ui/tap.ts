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
 * 「押して離す」を、その表示物の上で押し始めた場合だけ受け付けるように繋ぐ。
 *
 * Phaserのpointerupは押し始めた場所と関係なく「離した時点で下にあるもの」へ届くため、素直に
 * 繋ぐと、そこで押していないのに押されたことになってしまう。何かを運んで離した先や、動いている
 * ものが指の下へ滑り込んできた場合に、押していないものが押されたことになる。
 */
export function onPressRelease(target: Phaser.GameObjects.GameObject, handlers: TapHandlers): void {
  let pressed = false;

  target.on('pointerdown', () => {
    pressed = true;
    handlers.onPress?.();
  });
  target.on('pointerout', () => {
    if (!pressed) return;
    pressed = false;
    handlers.onCancel?.();
  });
  target.on('pointerup', () => {
    if (!pressed) return;
    pressed = false;
    handlers.onRelease?.();
  });
}
