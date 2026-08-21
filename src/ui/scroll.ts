import type Phaser from 'phaser';

/** deltaModeがピクセル・行・ページのときの、delta1あたりのピクセル数。 */
const WHEEL_DELTA_PIXELS = [1, 16, 400];

/**
 * ホイールの回転量をスクロールするピクセル数に直す。
 *
 * 縦ホイールしか無いマウスでも送れるよう、横方向の回転が無ければ縦方向の回転を横スクロールに使う。
 * ブラウザによってdeltaの単位が行・ページになるため（Phaserは正規化しない）、ピクセルへ揃える。
 * ブラウザが渡すのはCSSピクセルなので、Phaserの座標系（物理ピクセル）へ換算する。
 */
export function wheelPixels(pointer: Phaser.Input.Pointer, deltaX: number, deltaY: number): number {
  const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  const mode = pointer.event instanceof WheelEvent ? pointer.event.deltaMode : 0;
  return delta * (WHEEL_DELTA_PIXELS[mode] ?? 1) * pointer.manager.scaleManager.displayScale.x;
}

/** スクロールバーのつまみが占める範囲（トラックの左端からの位置と長さ、ピクセル）。 */
export interface ThumbSpan {
  readonly x: number;
  readonly width: number;
}

/**
 * 送り具合を、つまみの位置と長さに直す。scrollXは0が左端・minScrollXが右端（左へずらすので
 * 負の値）で、送る必要が無ければminScrollXは0になる。
 *
 * 長さは中身に対する可視域の割合そのものだが、中身が長いと1ピクセル未満まで痩せて見失うため、
 * minLengthで下限を切る。トラックの中でつまみが動ける幅もそのぶん縮み、両端は必ず端に着く。
 */
export function scrollThumbSpan(
  trackWidth: number,
  scrollX: number,
  minScrollX: number,
  minLength: number,
): ThumbSpan {
  if (minScrollX >= 0) return { x: 0, width: trackWidth };

  const contentWidth = trackWidth - minScrollX;
  const width = Math.min(trackWidth, Math.max(minLength, (trackWidth * trackWidth) / contentWidth));
  const progress = Math.min(1, Math.max(0, scrollX / minScrollX));
  return { x: (trackWidth - width) * progress, width };
}

/**
 * 送れる下限（ScrollArea）。**0が先頭で、送るほど負**——中身を負の向きへずらして見せるため、
 * 送り量はそのまま中身の位置の差になる。中身が可視域に収まるなら0（送る先が無い）。
 */
export function minScrollFor(viewportLength: number, contentLength: number): number {
  return Math.min(0, viewportLength - contentLength);
}

/** 送り量を可動範囲（minScroll〜0）へ収める。 */
export function clampScroll(offset: number, minScroll: number): number {
  return Math.min(0, Math.max(minScroll, offset));
}
