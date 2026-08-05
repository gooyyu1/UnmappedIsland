import Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import type { RainStyle } from './rainStyle';
import { rainStyleFor } from './rainStyle';
import { COLOR } from './theme';

/** 風の筋の、雨粒に対する長さ・太さ・濃さ・速さの倍率。 */
const GUST_LENGTH_SCALE = 5;
const GUST_THICKNESS_SCALE = 2.2;
const GUST_ALPHA_SCALE = 0.35;
const GUST_SPEED_SCALE = 0.55;

/** 雨粒の長さの散らばり。この割合から等倍までの間で、1本ずつ長さを変える。 */
const LENGTH_JITTER_MIN = 0.6;

/** 雨粒の散らばりの種。毎回同じ散らばりにして、画面の見え方が起動ごとに変わらないようにする。 */
const SCATTER_SEED = 0x9e3779b9;

/**
 * 雨天のあいだフィールドエリアへかぶせる、翳りと雨（ScreenLayout.md 雨の演出節）。
 * 天気ごとの見え方はrainStyle.tsが決め、こちらは「その通りに降らせる」ことだけを行う。
 *
 * 入力は遮らない（下のカードをそのまま操作できる）。フィールドエリアの外へはみ出さないよう、
 * 矩形で切り抜く。常にカードより手前・隣接エリアより奥へ置く必要があるため、depthは置く側が与える
 * （PlayScene参照）。
 */
export class WeatherOverlay extends Phaser.GameObjects.Container {
  private readonly metrics: ScreenMetrics;
  private readonly rect: Rect;
  private readonly dim: Phaser.GameObjects.Rectangle;
  private readonly maskShape: Phaser.GameObjects.Graphics;

  /** 今降らせている雨の見え方。undefinedなら降っていない。差が無ければ作り直さない。 */
  private style: RainStyle | undefined;
  private layers: Phaser.GameObjects.Graphics[] = [];
  private tweens: Phaser.Tweens.Tween[] = [];

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, rect: Rect, weather: string | undefined) {
    super(scene, rect.x, rect.y);
    this.metrics = metrics;
    this.rect = rect;

    this.dim = scene.add
      .rectangle(rect.width / 2, rect.height / 2, rect.width, rect.height, COLOR.rainDim, 1)
      .setVisible(false);
    this.add(this.dim);

    // 切り抜きはフィルタとしてのマスクで行う（Phaser 4のsetMaskはCanvas専用。CardLane参照）。
    this.maskShape = scene.make.graphics({});
    this.maskShape.fillStyle(COLOR.rain, 1);
    this.maskShape.fillRect(rect.x, rect.y, rect.width, rect.height);
    this.enableFilters();
    this.filters?.internal.addMask(this.maskShape);

    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.stopRain();
      this.maskShape.destroy();
    });
    scene.add.existing(this);
    this.setWeather(weather);
  }

  /** 今の天気に合わせて降らせ直す。雨の降らない天気にすると消える。 */
  setWeather(weather: string | undefined): void {
    const style = rainStyleFor(weather);
    if (style === this.style) return;

    this.stopRain();
    this.style = style;
    if (style === undefined) {
      this.dim.setVisible(false);
      return;
    }

    this.dim.setVisible(true).setAlpha(style.dim);
    this.addLayer(style, style.drops, style.length, style.thickness, style.alpha, style.fallMs);
    if (style.gusts > 0)
      this.addLayer(
        style,
        style.gusts,
        style.length * GUST_LENGTH_SCALE,
        style.thickness * GUST_THICKNESS_SCALE,
        style.alpha * GUST_ALPHA_SCALE,
        style.fallMs * GUST_SPEED_SCALE,
      );
  }

  /**
   * 同じ向き・同じ速さで落ちる筋を1層ぶん足す。
   *
   * 1周期で「高さ1つぶん下・傾きのぶん横」へ動かし、そこで最初へ戻す。戻った瞬間に絵が飛ばないよう、
   * 同じ散らばりをその移動量ぶんずらして2つ描いてあり、どの時点でも上下が繋がって見える。
   */
  private addLayer(
    style: RainStyle,
    visibleCount: number,
    lengthUnits: number,
    thicknessUnits: number,
    alpha: number,
    durationMs: number,
  ): void {
    const { width, height } = this.rect;
    const shift = height * Math.tan(Phaser.Math.DegToRad(style.slantDegrees));
    const length = this.metrics.px(lengthUnits);
    // 横へ広がったぶん薄まるので、画面に見えている本数が指定どおりになるよう本数を増やす。
    const count = Math.round((visibleCount * (width + 2 * shift)) / width);

    const graphics = this.scene.add.graphics();
    graphics.lineStyle(Math.max(1, this.metrics.px(thicknessUnits)), COLOR.rain, alpha);

    // 落ちる向きと筋の向きは常に一致させる（斜めに降る雨が縦に伸びていると、風の向きが読めない）。
    const travel = Math.hypot(shift, height);
    const random = scatter(SCATTER_SEED + this.layers.length);
    for (let i = 0; i < count; i++) {
      const x = random() * (width + 2 * shift) - shift;
      const y = random() * height;
      // 長さを散らす。すべて同じ長さだと、降っているというより破線が並んでいるように見える。
      const scale = LENGTH_JITTER_MIN + random() * (1 - LENGTH_JITTER_MIN);
      const tipX = (length * scale * shift) / travel;
      const tipY = (length * scale * height) / travel;
      // 折り返した瞬間に絵が飛ばないよう、同じ筋を移動量ぶんずらして2つ描く。
      for (const copy of [-1, 0]) {
        const originX = x + copy * shift;
        const originY = y + copy * height;
        graphics.lineBetween(originX, originY, originX + tipX, originY + tipY);
      }
    }

    this.add(graphics);
    this.layers.push(graphics);
    this.tweens.push(
      this.scene.tweens.add({
        targets: graphics,
        x: shift,
        y: height,
        duration: durationMs,
        repeat: -1,
        ease: 'Linear',
      }),
    );
  }

  private stopRain(): void {
    for (const tween of this.tweens) tween.stop();
    for (const layer of this.layers) layer.destroy();
    this.tweens = [];
    this.layers = [];
  }
}

/** 0以上1未満を返す、種から決まる乱数列（mulberry32）。 */
function scatter(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
