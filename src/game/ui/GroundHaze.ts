import type Phaser from 'phaser';
import type { HeatHaze } from './heatHaze';

/** 変位マップの一辺（px）と、テクスチャマネージャへ入れるキー。 */
const MAP_SIZE = 128;
const MAP_KEY = 'ground-haze-map';

/** 変位マップの波の細かさ（縦・横それぞれ、1辺あたりの波の数）。 */
const WAVE_ACROSS = 4;
const WAVE_DOWN = 2;

/** 横のゆがみは縦より弱くする（陽炎は立ち上る＝縦に伸び縮みして見える）。 */
const HORIZONTAL_RATIO = 0.35;

/**
 * 変位を0へ落とす、四辺それぞれの帯の幅（一辺に対する割合）。
 *
 * 変位フィルタは掛けた絵の外から画素を引いてくるが、外側は透明なので、縁では欠けて背景が覗く
 * （ゆらぎを強くするほど、レーンの縁が扇形に食われる）。縁での変位を0にすれば、引いてくる先が
 * 絵の中に収まる。
 */
const EDGE_FADE = 0.25;

/**
 * 地面の絵だけを陽炎でゆがませる（ScreenLayout.md 空の演出節）。
 *
 * **カードには掛けない。** 画面全体を歪ませるとカードの名前まで揺れて読めなくなるうえ、実際の
 * 陽炎も焼けた地面の上に立つもので、手前の物が歪んで見えるわけではない。Phaserのフィルタは
 * 掛けた表示物の中だけを歪ませるので、レーンに敷かれた地面の絵（CardLane.ground）へ掛ける。
 */
export class GroundHaze {
  private readonly scene: Phaser.Scene;
  private targets: readonly Phaser.GameObjects.TileSprite[] = [];
  private haze: HeatHaze | undefined;
  private tweens: Phaser.Tweens.Tween[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** 掛ける対象。フィールドエリアを作り直すと地面ごと入れ替わるので、その都度渡し直す。 */
  setTargets(targets: readonly Phaser.GameObjects.TileSprite[]): void {
    this.stop();
    this.targets = targets;
    this.apply();
  }

  /** 今の陽炎。undefinedなら立てない。 */
  setHaze(haze: HeatHaze | undefined): void {
    if (haze?.strength === this.haze?.strength && haze?.swayMs === this.haze?.swayMs) return;
    this.stop();
    this.haze = haze;
    this.apply();
  }

  /** 掛けたフィルタとゆらぎを外す（対象そのものは破棄しない）。 */
  stop(): void {
    for (const tween of this.tweens) tween.stop();
    this.tweens = [];
    // 画面を作り直した後は、前の地面はもう破棄されている（sceneを失う）。
    for (const target of this.targets) if (target.scene !== undefined) target.filters?.internal.clear();
  }

  private apply(): void {
    const haze = this.haze;
    if (haze === undefined || this.targets.length === 0) return;

    const texture = this.ensureMap();
    if (texture === undefined) return;

    for (const target of this.targets) {
      target.enableFilters();
      const displacement = target.filters?.internal.addDisplacement(
        texture,
        haze.strength * HORIZONTAL_RATIO,
        haze.strength,
      );
      if (displacement === undefined) continue;

      // ゆがみの量そのものを往復させて、立ち上る空気のゆらぎに見せる。縦横で周期をずらすと、
      // 同じ形が伸び縮みするだけの動きにならない。
      this.tweens.push(
        this.scene.tweens.add({
          targets: displacement,
          y: haze.strength * 0.3,
          duration: haze.swayMs,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        }),
        this.scene.tweens.add({
          targets: displacement,
          x: -haze.strength * HORIZONTAL_RATIO,
          duration: Math.round(haze.swayMs * 1.6),
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        }),
      );
    }
  }

  /**
   * 変位マップを作る（1度だけ）。緑（縦の変位）を波打たせ、赤（横の変位）は控えめにする。
   * 各成分は、それが動かす向きの縁（縦なら上下、横なら左右）で0へ落とす（EDGE_FADE参照）。
   */
  private ensureMap(): string | undefined {
    if (this.scene.textures.exists(MAP_KEY)) return MAP_KEY;

    const canvas = this.scene.textures.createCanvas(MAP_KEY, MAP_SIZE, MAP_SIZE);
    if (canvas === null) return undefined;

    const image = canvas.context.createImageData(MAP_SIZE, MAP_SIZE);
    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        const across = (x / MAP_SIZE) * Math.PI * 2 * WAVE_ACROSS;
        const down = (y / MAP_SIZE) * Math.PI * 2 * WAVE_DOWN;
        const index = (y * MAP_SIZE + x) * 4;
        image.data[index] = 128 + Math.sin(down) * 60 * edgeFade(x / MAP_SIZE);
        image.data[index + 1] = 128 + Math.sin(across) * Math.cos(down) * 110 * edgeFade(y / MAP_SIZE);
        image.data[index + 2] = 128;
        image.data[index + 3] = 255;
      }
    }
    canvas.context.putImageData(image, 0, 0);
    canvas.refresh();
    return MAP_KEY;
  }
}

/**
 * 一辺の中での位置（0〜1）に対する変位の倍率。両端で0、内側ではEDGE_FADEぶんかけて1へ上がる。
 * 折れ線で繋ぐと倍率の変わり目に筋が見えるので、傾きも連続な曲線（smoothstep）を使う。
 */
function edgeFade(position: number): number {
  const t = Math.min(position, 1 - position) / EDGE_FADE;
  return t >= 1 ? 1 : t * t * (3 - 2 * t);
}
