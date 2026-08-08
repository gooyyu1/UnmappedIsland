import Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import type { RainStyle } from './rainStyle';
import { rainStyleFor } from './rainStyle';
import { COLOR, cssColor } from './theme';

/**
 * 雨を敷き詰める絵の一辺（u単位）。**フィールドエリアより少し大きく取る**ので、画面に繰り返しの
 * 継ぎ目が並んで見えることはない。u単位なので、この大きさは画面の解像度によらない。
 */
const RAIN_TILE = 1024;

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
 * フィールドエリアへ降らせる雨（ScreenLayout.md 空の演出節）。見え方はrainStyle.tsが決め、
 * こちらは「その通りに降らせる」ことだけを行う。
 *
 * 入力は遮らない（下のカードをそのまま操作できる）。常にカードより手前・隣接エリアより奥へ置く
 * 必要があるため、depthは置く側が与える（PlayScene参照）。
 *
 * **フィルタを使わない。** フィルタを掛けた表示物は一度画面サイズの描画バッファへ描かれるため、
 * 4Kでは1枚31MB・実測で221MBを占めていた。雨は敷き詰めた絵（TileSprite）が自分の矩形の外へ
 * 描かないことを使って収める。
 */
export class WeatherOverlay extends Phaser.GameObjects.Container {
  private readonly metrics: ScreenMetrics;
  private readonly rect: Rect;

  /** 今降らせている雨の見え方。undefinedなら降っていない。差が無ければ作り直さない。 */
  private style: RainStyle | undefined;
  private layers: Phaser.GameObjects.TileSprite[] = [];
  private textureKeys: string[] = [];
  private tweens: Phaser.Tweens.Tween[] = [];

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, rect: Rect, weather: string | undefined) {
    super(scene, rect.x, rect.y);
    this.metrics = metrics;
    this.rect = rect;

    this.once(Phaser.GameObjects.Events.DESTROY, () => this.stopRain());
    scene.add.existing(this);
    this.setWeather(weather);
  }

  /** 今の天気に合わせて降らせ直す。雨の降らない天気にすると消える。 */
  setWeather(weather: string | undefined): void {
    const style = rainStyleFor(weather);
    if (style === this.style) return;

    this.stopRain();
    this.style = style;
    if (style === undefined || weather === undefined) return;

    this.addLayer(weather, style, style.drops, style.length, style.thickness, style.alpha, style.fallMs);
    if (style.gusts > 0)
      this.addLayer(
        weather,
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
   * 敷き詰めた絵を縦横それぞれ1周ぶん送り、送り終えたら最初へ戻す。絵は継ぎ目なく繋がるので、
   * 戻った瞬間も見た目は変わらない。縦横の周期を別々に取ることで、絵の縦横比によらず、
   * 落ちる向きを筋の傾きへ合わせられる。
   */
  private addLayer(
    weather: string,
    style: RainStyle,
    visibleCount: number,
    lengthUnits: number,
    thicknessUnits: number,
    alpha: number,
    fallMs: number,
  ): void {
    const key = `rain-${weather}-${this.layers.length}`;
    const slant = Math.tan(Phaser.Math.DegToRad(style.slantDegrees));
    // 画面に見えている本数が指定どおりになるよう、絵1枚が受け持つ面積のぶんだけ散らす。
    const unitArea = (this.rect.width * this.rect.height) / this.metrics.u ** 2;
    const count = Math.max(1, Math.round((visibleCount * RAIN_TILE ** 2) / unitArea));
    if (!this.drawTile(key, count, slant, lengthUnits, thicknessUnits, alpha)) return;

    const tile = this.scene.add
      .tileSprite(this.rect.width / 2, this.rect.height / 2, this.rect.width, this.rect.height, key)
      .setTileScale(this.metrics.u, this.metrics.u);
    this.add(tile);
    this.layers.push(tile);
    this.textureKeys.push(key);

    // 落ちる速さは「フィールドエリアの高さぶんをfallMsで」。絵を送る量へ直すと、絵の大きさぶんを
    // 送る時間になる。横は同じ速さに傾きを掛けたもの。
    const fallPerTile = (fallMs * RAIN_TILE * this.metrics.u) / this.rect.height;
    this.tweens.push(
      this.scene.tweens.add({
        targets: tile,
        tilePositionY: -RAIN_TILE,
        duration: fallPerTile,
        repeat: -1,
        ease: 'Linear',
      }),
    );
    if (slant > 0)
      this.tweens.push(
        this.scene.tweens.add({
          targets: tile,
          tilePositionX: -RAIN_TILE,
          duration: fallPerTile / slant,
          repeat: -1,
          ease: 'Linear',
        }),
      );
  }

  /**
   * 敷き詰める絵を1枚描く。**上下左右で繋がるように、同じ筋を隣の位置にも描く**（端をまたぐ筋が
   * 反対側へ続く）。描けなければfalse。
   */
  private drawTile(
    key: string,
    count: number,
    slant: number,
    lengthUnits: number,
    thicknessUnits: number,
    alpha: number,
  ): boolean {
    if (this.scene.textures.exists(key)) return true;

    const canvas = this.scene.textures.createCanvas(key, RAIN_TILE, RAIN_TILE);
    if (canvas === null) return false;

    const context = canvas.context;
    context.strokeStyle = cssColor(COLOR.rain);
    context.globalAlpha = alpha;
    context.lineWidth = Math.max(1, thicknessUnits);
    context.lineCap = 'round';

    const travel = Math.hypot(slant, 1);
    const random = scatter(SCATTER_SEED + count);
    context.beginPath();
    for (let i = 0; i < count; i++) {
      const x = random() * RAIN_TILE;
      const y = random() * RAIN_TILE;
      // 長さを散らす。すべて同じ長さだと、降っているというより破線が並んでいるように見える。
      const length = lengthUnits * (LENGTH_JITTER_MIN + random() * (1 - LENGTH_JITTER_MIN));
      const tipX = (length * slant) / travel;
      const tipY = length / travel;
      for (const dx of [-RAIN_TILE, 0]) {
        for (const dy of [-RAIN_TILE, 0]) {
          context.moveTo(x + dx, y + dy);
          context.lineTo(x + dx + tipX, y + dy + tipY);
        }
      }
    }
    context.stroke();
    canvas.refresh();
    return true;
  }

  private stopRain(): void {
    for (const tween of this.tweens) tween.stop();
    for (const layer of this.layers) layer.destroy();
    // 絵は天気ごとに違うので、降り終えたら手放す（降り直すときに描き直す方が、抱え続けるより軽い）。
    for (const key of this.textureKeys) this.scene.textures.remove(key);
    this.tweens = [];
    this.layers = [];
    this.textureKeys = [];
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
