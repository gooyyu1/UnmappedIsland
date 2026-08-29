import Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import type { Daybreak } from '../view/daylight';
import { cssColor } from '../../util/cssColor';
import { uiText } from '../../locale/uiTexts';
import { FONT_FAMILY } from '../looks/theme';

/**
 * 染まってから醒めるまで（ms）。1回の経過に使う実時間の上限（PlayScene.REAL_MS_MAX）より短くして、
 * **経過を見せ終えるより先に空が醒める**ようにする——結果を見せる画面の上に演出が残らない。
 */
const DURATION_MS = 2200;

/** 出入りに使う割合。真ん中は染まったまま留める。 */
const FADE_IN = 0.18;
const FADE_OUT = 0.28;

/** 日数の文字が出るまでの割合。太陽が地平線を越えてから読ませる。 */
const DAY_TEXT_DELAY = 0.45;

/** 空の染まりの濃さ。下のカードが読める濃さに留める。 */
const SKY_ALPHA = 0.5;

/** 寸法（u単位）。地平線は演出の矩形の中央に引く。 */
const BODY_RADIUS = 96;
const BODY_OFFSET_X = 268;
const TRAVEL = 300;
const HORIZON_THICKNESS = 5;
const DAY_TEXT_SIZE = 128;
const DAY_TEXT_STROKE = 10;
const DAY_TEXT_Y = 320;

/**
 * 天体を離す幅と日数の高さの、矩形の大きさに対する上限。**狭い画面では中央へ寄せる**——演出は
 * 自分の矩形を切り抜かないので、はみ出せば隣のエリアの上に太陽が出る。
 */
const BODY_OFFSET_X_RATIO = 0.3;
const DAY_TEXT_Y_RATIO = 0.36;

/**
 * 演出そのものの色。**`theme.ts`へは出さない**——画面のどこかと揃える色ではなく、この演出だけが
 * 使う空の色だから。
 */
interface DaybreakLook {
  /** 空を染める色と、地平線の線。 */
  readonly sky: number;
  readonly horizon: number;
  /** 日数の文字と、その縁取り。染まった空の上でも読めるだけの差を付ける。 */
  readonly text: number;
  readonly textOutline: number;
}

const LOOK: Readonly<Record<Daybreak['kind'], DaybreakLook>> = {
  sunrise: { sky: 0xff9d4a, horizon: 0xfff0cf, text: 0xfff6e0, textOutline: 0x5a2a08 },
  sunset: { sky: 0x1d2a56, horizon: 0xff9f7a, text: 0xffe6d0, textOutline: 0x120a24 },
};

const SUN_GLOW = 0xffc24a;
const SUN_DISC = 0xffd34a;
const SUN_CORE = 0xfff3b8;
const MOON_DISC = 0xeef1f8;
const MOON_CRATER = 0xc2cad9;

/** 太陽の光条の本数と、月の海の位置・大きさ（半径に対する割合）。 */
const SUN_RAYS = 8;
const MOON_CRATERS: readonly (readonly [number, number, number])[] = [
  [-0.32, -0.26, 0.24],
  [0.3, 0.08, 0.17],
  [-0.06, 0.4, 0.13],
];

/**
 * 日が昇った・日が沈んだことを告げる演出（ScreenLayout.md 7.5.6節）。太陽が沈んで替わりに月が昇り、
 * 日の出のときはその上に日数が出る。
 *
 * **絵を持たず図形で描く。** 一度きり数秒だけ出るものなので、素材を1組増やす価値が無い。
 *
 * 入力は遮らない（下のカードもボタンもそのまま操作できる）。ほぼ全ての表示物より手前へ出す必要が
 * あるため、depthは置く側が与える（PlayScene参照）。
 */
export class DaybreakOverlay extends Phaser.GameObjects.Container {
  private readonly tweenList: Phaser.Tweens.Tween[] = [];

  /** rectの中央を地平線の高さとして描く。演出が終わると自分を片付ける。 */
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, rect: Rect, daybreak: Daybreak) {
    super(scene, rect.x + rect.width / 2, rect.y + rect.height / 2);

    const look = LOOK[daybreak.kind];
    this.add(scene.add.rectangle(0, 0, rect.width, rect.height, look.sky, SKY_ALPHA));
    this.add(scene.add.rectangle(0, 0, rect.width, metrics.px(HORIZON_THICKNESS), look.horizon, 0.85));

    // 沈む側は左（西）、昇る側は右（東）。どちらの向きでも、去る天体と現れる天体の位置は変わらない。
    const offsetX = Math.min(metrics.px(BODY_OFFSET_X), rect.width * BODY_OFFSET_X_RATIO);
    const rising = daybreak.kind === 'sunrise' ? this.sun(scene, metrics) : this.moon(scene, metrics);
    const setting = daybreak.kind === 'sunrise' ? this.moon(scene, metrics) : this.sun(scene, metrics);
    this.travel(rising, offsetX, metrics, true);
    this.travel(setting, -offsetX, metrics, false);

    if (daybreak.kind === 'sunrise') {
      const y = -Math.min(metrics.px(DAY_TEXT_Y), rect.height * DAY_TEXT_Y_RATIO);
      this.addDayText(scene, metrics, y, daybreak.elapsedDays, look);
    }

    this.setAlpha(0);
    this.tweenList.push(
      scene.tweens.add({ targets: this, alpha: 1, duration: DURATION_MS * FADE_IN, ease: 'Sine.easeOut' }),
      scene.tweens.add({
        targets: this,
        alpha: 0,
        delay: DURATION_MS * (1 - FADE_OUT),
        duration: DURATION_MS * FADE_OUT,
        ease: 'Sine.easeIn',
        onComplete: () => this.destroy(),
      }),
    );

    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      for (const tween of this.tweenList) tween.stop();
    });
    scene.add.existing(this);
  }

  /**
   * 天体を地平線の下（上）から上（下）へ動かす。**地平線の向こう側では透けさせる**ので、
   * 沈み切った天体が下に残らない。
   */
  private travel(body: Phaser.GameObjects.Graphics, x: number, metrics: ScreenMetrics, rises: boolean): void {
    const travel = metrics.px(TRAVEL);
    const below = travel / 2;
    body.setPosition(x, rises ? below : -below);
    body.setAlpha(rises ? 0 : 1);
    this.add(body);

    this.tweenList.push(
      this.scene.tweens.add({
        targets: body,
        y: rises ? -below : below,
        duration: DURATION_MS,
        ease: 'Sine.easeInOut',
      }),
      this.scene.tweens.add({
        targets: body,
        alpha: rises ? 1 : 0,
        delay: rises ? 0 : DURATION_MS / 2,
        duration: DURATION_MS / 2,
        ease: 'Linear',
      }),
    );
  }

  /** 日の出のときだけ出す `DAY 10`。太陽が昇り切るころに現れる。 */
  private addDayText(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    y: number,
    elapsedDays: number,
    look: DaybreakLook,
  ): void {
    const text = scene.add
      .text(0, y, `${uiText('day')} ${elapsedDays}`, {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(DAY_TEXT_SIZE)}px`,
        fontStyle: 'bold',
        color: cssColor(look.text),
      })
      .setOrigin(0.5)
      .setStroke(cssColor(look.textOutline), metrics.px(DAY_TEXT_STROKE))
      .setAlpha(0);
    this.add(text);

    this.tweenList.push(
      scene.tweens.add({
        targets: text,
        alpha: 1,
        delay: DURATION_MS * DAY_TEXT_DELAY,
        duration: DURATION_MS * FADE_IN,
        ease: 'Sine.easeOut',
      }),
    );
  }

  /** 光条を伸ばした陽。 */
  private sun(scene: Phaser.Scene, metrics: ScreenMetrics): Phaser.GameObjects.Graphics {
    const radius = metrics.px(BODY_RADIUS);
    const graphics = scene.add.graphics();
    graphics.fillStyle(SUN_GLOW, 0.35).fillCircle(0, 0, radius * 1.35);
    graphics.fillStyle(SUN_DISC, 1).fillCircle(0, 0, radius);
    graphics.fillStyle(SUN_CORE, 1).fillCircle(0, 0, radius * 0.6);
    graphics.lineStyle(Math.max(2, radius * 0.09), SUN_DISC, 0.9);
    for (let ray = 0; ray < SUN_RAYS; ray++) {
      const angle = ((Math.PI * 2) / SUN_RAYS) * ray;
      const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
      graphics.lineBetween(cos * radius * 1.3, sin * radius * 1.3, cos * radius * 1.75, sin * radius * 1.75);
    }
    return graphics;
  }

  /** 海の窪みを持つ月。満ち欠けは描かない——満ち欠けを表す値をワールドが持たないため。 */
  private moon(scene: Phaser.Scene, metrics: ScreenMetrics): Phaser.GameObjects.Graphics {
    const radius = metrics.px(BODY_RADIUS);
    const graphics = scene.add.graphics();
    graphics.fillStyle(MOON_DISC, 0.25).fillCircle(0, 0, radius * 1.25);
    graphics.fillStyle(MOON_DISC, 1).fillCircle(0, 0, radius);
    graphics.fillStyle(MOON_CRATER, 1);
    for (const [x, y, size] of MOON_CRATERS) graphics.fillCircle(x * radius, y * radius, size * radius);
    return graphics;
  }
}
