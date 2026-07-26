import type Phaser from 'phaser';

/** deltaModeがピクセル・行・ページのときの、delta1あたりのピクセル数。 */
const WHEEL_DELTA_PIXELS = [1, 16, 400];

/**
 * ホイールの回転量をスクロールするピクセル数に直す。
 *
 * 縦ホイールしか無いマウスでも送れるよう、横方向の回転が無ければ縦方向の回転を横スクロールに使う。
 * ブラウザによってdeltaの単位が行・ページになるため（Phaserは正規化しない）、ピクセルへ揃える。
 */
export function wheelPixels(pointer: Phaser.Input.Pointer, deltaX: number, deltaY: number): number {
  const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  const mode = pointer.event instanceof WheelEvent ? pointer.event.deltaMode : 0;
  return delta * (WHEEL_DELTA_PIXELS[mode] ?? 1);
}
