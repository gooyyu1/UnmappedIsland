import Phaser from 'phaser';
import type { Rect } from '../looks/ScreenMetrics';
import type { HeatHaze } from '../looks/heatHaze';

/** 変位マップの一辺（px）と、テクスチャマネージャへ入れるキー。 */
const MAP_SIZE = 128;
const MAP_KEY = 'lane-haze-map';

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

/** 陽炎を掛けられる表示物（フィルタと位置を持つもの）。 */
export type HazeTarget = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform;

/**
 * 陽炎を掛ける面。
 *
 * objectsは、rectいっぱいに広がる**1枚の空気ごしに見えているもの**として歪む。波はrectの中に
 * 並ぶので、地面とその上のカードは、同じ位置なら同じだけ揺れる。
 */
export interface HazeSurface {
  readonly objects: readonly HazeTarget[];
  readonly rect: Rect;
}

/**
 * レーンを陽炎でゆがませる（ScreenLayout.md 7.5節 空の演出）。
 *
 * Phaserのフィルタは掛けた表示物の中だけを歪ませるので、地面とカードには別々に掛けることになる。
 * 掛ける相手ごとに変位マップの写り方が変わると両者が別の周期で揺れてしまうため、どの表示物でも
 * フィルタがレーンの矩形を写すように据える（focusOn）。
 */
export class LaneHaze {
  private readonly scene: Phaser.Scene;
  private surfaces: readonly HazeSurface[] = [];
  private haze: HeatHaze | undefined;
  private tweens: Phaser.Tweens.Tween[] = [];

  /**
   * 掛けたフィルタ。外すときに掛ける前からあったフィルタ（子ウィンドウの切り抜き）を巻き込まないため
   * だけでなく、面ごとに違う矩形へ据え直す（focusOn）ためにも、対象と矩形を組で覚える。
   */
  private applied: {
    readonly target: HazeTarget;
    readonly filter: Phaser.Filters.Displacement;
    readonly rect: Rect;
  }[] = [];

  /** 据え直しを繋いだかどうか（focusOn参照）。 */
  private refocusing = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** 掛ける面。フィールドエリアを作り直すとレーンごと入れ替わるので、その都度渡し直す。 */
  setSurfaces(surfaces: readonly (HazeSurface | undefined)[]): void {
    this.stop();
    this.surfaces = surfaces.filter((surface) => surface !== undefined);
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
    // 画面を作り直した後は、前のレーンはもう破棄されている（sceneを失う）。
    for (const { target, filter } of this.applied) {
      if (target.scene !== undefined) target.filters?.internal.remove(filter);
    }
    this.applied = [];

    if (!this.refocusing) return;
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.focusOn, this);
    this.refocusing = false;
  }

  /**
   * フィルタが写す範囲をレーンの矩形へ据え直す。
   *
   * 対象の位置を矩形の中での位置として渡すと、フィルタのカメラはその矩形を写す。ただしPhaserは
   * 「対象の今の位置」から写した結果を戻す先を決めるので、**動く対象では毎フレーム据え直す**
   * 必要がある。据え置くと、カードが送られた量だけ戻す先までずれて、二重に動いて見える。
   */
  private focusOn(): void {
    for (const { target, rect } of this.applied) {
      target.focusFiltersOverride(target.x - rect.x, target.y - rect.y, rect.width, rect.height);
    }
  }

  private apply(): void {
    const haze = this.haze;
    if (haze === undefined || this.surfaces.length === 0) return;

    const texture = this.ensureMap();
    if (texture === undefined) return;

    const filters: Phaser.Filters.Displacement[] = [];
    for (const { objects, rect } of this.surfaces) {
      for (const target of objects) {
        target.enableFilters();
        // 大きさを持たない表示物（カードを束ねるコンテナ）は、既定では画面全体を写す設定になる。
        // 写す範囲はこちらで据えるので、その設定を降ろす。
        target.setFiltersFocusContext(false);

        const displacement = target.filters?.internal.addDisplacement(
          texture,
          haze.strength * HORIZONTAL_RATIO,
          haze.strength,
        );
        if (displacement === undefined) continue;
        this.applied.push({ target, filter: displacement, rect });
        filters.push(displacement);
      }
    }
    if (filters.length === 0) return;

    // ゆがみの量そのものを往復させて、立ち上る空気のゆらぎに見せる。縦横で周期をずらすと、
    // 同じ形が伸び縮みするだけの動きにならない。掛けたフィルタは1つのtweenでまとめて動かす
    // ——別々に動かすと、レーンごと・表示物ごとにゆらぎの位相がずれる。
    this.tweens.push(
      this.scene.tweens.add({
        targets: filters,
        y: haze.strength * 0.3,
        duration: haze.swayMs,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }),
      this.scene.tweens.add({
        targets: filters,
        x: -haze.strength * HORIZONTAL_RATIO,
        duration: Math.round(haze.swayMs * 1.6),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }),
    );

    this.scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.focusOn, this);
    this.refocusing = true;
    this.focusOn();
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
