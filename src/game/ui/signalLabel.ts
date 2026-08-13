import type Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import { addLabel } from './labels';
import { COLOR, cssColor } from './theme';

/**
 * 文字の大きさ（u単位）とふちの太さ。カードの名前（16u）よりずっと大きく取る——一瞬しか出ないので、
 * 読みに行かなくても目に入る必要がある。
 *
 * ふちは、カードの絵の濃淡の上でも字形が切れないように付ける。**線の太さは字の細さに対して決める**
 * ——ふちは字の輪郭の内側にも太るので、太くすると文字の色ではなくふちの色に見えてしまう。
 */
const TEXT_SIZE = 52;
const STROKE = 3;

/**
 * 浮かび上がる高さ（u単位。カードの高さの1/4ほど）と、出てから消えるまでの時間（ミリ秒）。
 *
 * **薄れ始めるのは終わりの間際だけ。** 浮かび始めから薄れさせると、読める濃さで居る間が
 * ほとんど残らない（立ち上がりの動きに合わせて薄れると、目を向けた時にはもう消えかけている）。
 */
const RISE = 80;
const SHOW_MS = 900;
const FADE_MS = 300;

/**
 * 世界に起きた出来事を、それが起きた札の上に文字として浮かべる（CardView.md 14節）。文字は札の中ほどから
 * 立ち上がって薄れ、消えたら自分を片付ける。
 *
 * **語そのものはワールドとlocaleが決める**（GameElementDefinition.md 9.8節のsignal）ので、ここは
 * 受け取った1語を置くだけ。出来事の種類が増えてもこの関数は変わらない。
 */
export function floatSignalLabel(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  content: string,
  at: Rect,
): Phaser.GameObjects.Text {
  const label = addLabel(scene, metrics, at.x + at.width / 2, at.y + at.height / 2, content, {
    size: TEXT_SIZE,
    bold: true,
  });
  label.setOrigin(0.5, 0.5);
  label.setStroke(cssColor(COLOR.cardFace), metrics.px(STROKE));

  scene.tweens.add({
    targets: label,
    y: label.y - metrics.px(RISE),
    duration: SHOW_MS,
    ease: 'Quad.easeOut',
  });
  scene.tweens.add({
    targets: label,
    alpha: 0,
    delay: SHOW_MS - FADE_MS,
    duration: FADE_MS,
    ease: 'Linear',
    onComplete: () => label.destroy(),
  });
  return label;
}
