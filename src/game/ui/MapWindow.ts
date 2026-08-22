import Phaser from 'phaser';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import type { MapLandView, MapRoadView } from '../view/PlayScreenView';
import { addTextButton } from './Button';
import { Card, PAPER_RADIUS, paperRect } from './Card';
import { cardFace } from './cardFace';
import { ACTION_HEIGHT, WINDOW_PADDING, closeRow } from '../looks/childWindowLayout';
import { addLabel } from '../../ui/labels';
import { addPanel, drawBox } from '../../ui/shapes';
import { COLOR, SIZE } from '../looks/theme';

/** 地図上のカードの縮尺（レーンのカードに対する比）。一覧性を優先して小さめにする。 */
const CARD_SCALE = 0.5;

/** ズームの上限（下限は等倍）。スマホでもカード名が読める倍率まで寄れるようにする。 */
const MAX_ZOOM = 3;

/** ホイール1目盛り（deltaY=100）でおよそ1.16倍になる拡大率の底。 */
const WHEEL_ZOOM_BASE = 1.0015;

/** 海図風の下地（羊皮紙の薄茶）と、島の輪郭のごく薄い線の色。 */
const CHART_PAPER = 0xf3ead4;
const CHART_LINE = 0xcdbb92;

/** 道の点線のインクの色と、1点の半径・間隔（u単位）。 */
const ROAD_INK = 0x8a6f4f;
const ROAD_DOT_RADIUS = 5;
const ROAD_DOT_SPACING = 22;

/** 道の弧の膨らみ（両端の距離に対する比）。直線ではなく手描きの海路らしい曲線にする。 */
const ROAD_BEND_RATIO = 0.18;

/** 現在地のカードを囲む黒枠の太さ（u単位。カードの縮尺がかかる前の値）。 */
const CURRENT_BORDER_WIDTH = 12;

/** 地図上のカードの置き場所（画面に対する0〜1の正規化座標、カード中心）。 */
export interface MapPlacement {
  readonly x: number;
  readonly y: number;
}

export interface MapWindowOptions {
  /** 既知の土地と発見済みの道（PlayScreenView.mapLands/mapRoads）。 */
  readonly lands: readonly MapLandView[];
  readonly roads: readonly MapRoadView[];

  /** サイトindex→ユーザが置いた位置。無い土地は下端の待機列に並ぶ。 */
  readonly positions: ReadonlyMap<number, MapPlacement>;

  /** カードを置いた（ドラッグを離した）ときに呼ぶ。 */
  readonly onPlace: (site: number, at: MapPlacement) => void;

  readonly onClose: () => void;
}

/**
 * 地図ボタンから開く全画面の子ウィンドウ。既知の土地のカードを、ユーザがドラッグで並べて
 * 自分だけの地図を作る（Windows.md 7節 地図ウィンドウ）。
 *
 * 背景の島の輪郭は実際の地形ではなく、カードを置くときの目安になる「個性のない円形に近い島」。
 * 実際の配置を写してしまうと、自分で地図を描き上げる遊びが成り立たないため。
 *
 * ピンチ（スマホ）・ホイール（PC）で等倍〜MAX_ZOOM倍に拡大でき、拡大中は背景のドラッグで
 * 見る範囲を動かせる。カードの位置は画面に対する正規化座標で持ち、ズームとパンは描画の変換
 * だけに閉じる——保存される位置（onPlace）がズーム状態に依存しないようにするため。
 */
export class MapWindow {
  private readonly scene: Phaser.Scene;
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly metrics: ScreenMetrics;

  /** サイトindex→そのカードと、正規化座標での現在位置（ウィンドウ内の真実はこちら）。 */
  private readonly cards = new Map<number, Card>();
  private readonly placements = new Map<number, MapPlacement>();

  private readonly roads: readonly MapRoadView[];
  private readonly roadInk: Phaser.GameObjects.Graphics;
  private readonly outline: Phaser.GameObjects.Graphics;

  /** 描画の変換。screen = norm × 画面寸法 × zoom + pan。 */
  private zoom = 1;
  private panX = 0;
  private panY = 0;

  /** ピンチ中の直前の2本指の間隔と中点（両指が揃っていない間はundefined）。 */
  private pinchDistance: number | undefined;
  private pinchMid: Phaser.Math.Vector2 | undefined;

  /** 背景ドラッグ（パン）の直前のポインタ位置。差分で送ることでピンチと干渉しない。 */
  private panLast: Phaser.Math.Vector2 | undefined;

  /** シーン全体の入力に付けた聞き手。closeで必ず外す。 */
  private readonly sceneListeners: { event: string; handler: (...args: never[]) => void }[] = [];

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, options: MapWindowOptions) {
    this.scene = scene;
    this.metrics = metrics;
    this.roads = options.roads;
    const { width, height } = metrics;
    const padding = metrics.px(WINDOW_PADDING);

    const surface = addPanel(scene, { x: 0, y: 0, width, height }, CHART_PAPER);
    this.objects.push(surface);

    this.outline = scene.add.graphics();
    this.objects.push(this.outline);

    // 道はカードより奥に描く（カードの下から点線が延びて見える）。
    this.roadInk = scene.add.graphics();
    this.objects.push(this.roadInk);

    for (const land of options.lands) {
      this.placements.set(land.site, this.openingPlacement(land.site, options.positions));
      this.addCard(scene, land, options.onPlace);
    }
    this.applyTransform();

    this.addPan(scene, surface);
    this.addZoom(scene);

    const title = addLabel(scene, metrics, padding, padding, '地図', { size: 34, bold: true });
    this.objects.push(
      title,
      addLabel(
        scene,
        metrics,
        padding,
        padding + title.height + metrics.px(4),
        'カードを動かして、自分だけの地図を作る（ピンチ／ホイールで拡大）',
        {
          size: 22,
          color: COLOR.textMuted,
        },
      ),
    );

    this.objects.push(
      addTextButton(
        scene,
        metrics,
        closeRow(metrics, { x: 0, y: 0, width, height }),
        '閉じる',
        { fill: COLOR.button },
        () => {
          this.close();
          options.onClose();
        },
      ),
    );
  }

  /**
   * 開いた時点のカードの位置。保存済みならその位置（画面の向きが変わって画面外を指していても
   * 画面内へ収め直す）、まだ置かれていなければ下端の待機列に並べる。開く時点は必ず等倍なので、
   * 画面座標のクランプを正規化座標へそのまま書き戻せる。
   */
  private openingPlacement(site: number, saved: ReadonlyMap<number, MapPlacement>): MapPlacement {
    const at = saved.get(site) ?? this.traySlot(this.unplacedCount(saved));
    const clamped = this.clampTopLeft(
      at.x * this.metrics.width - (this.metrics.px(SIZE.cardWidth) * CARD_SCALE) / 2,
      at.y * this.metrics.height - (this.metrics.px(SIZE.cardHeight) * CARD_SCALE) / 2,
      1,
    );
    return {
      x: (clamped.x + (this.metrics.px(SIZE.cardWidth) * CARD_SCALE) / 2) / this.metrics.width,
      y: (clamped.y + (this.metrics.px(SIZE.cardHeight) * CARD_SCALE) / 2) / this.metrics.height,
    };
  }

  /** 保存済みの位置が無い土地のうち、これまでに待機列へ並べた数（次に使う待機列の枠番号）。 */
  private unplacedCount(saved: ReadonlyMap<number, MapPlacement>): number {
    let count = 0;
    for (const site of this.placements.keys()) if (!saved.has(site)) count++;
    return count;
  }

  /**
   * まだ置かれていないカードの初期位置。閉じるボタンにかからないよう、その上の帯へ左から並べ、
   * 入りきらない分は上の行へ折り返す。ここはあくまで待機列で、位置はドラッグで置くまで保存しない。
   */
  private traySlot(index: number): MapPlacement {
    const { width, height } = this.metrics;
    const padding = this.metrics.px(WINDOW_PADDING);
    const gap = this.metrics.px(SIZE.gap);
    const cardWidth = this.metrics.px(SIZE.cardWidth) * CARD_SCALE;
    const cardHeight = this.metrics.px(SIZE.cardHeight) * CARD_SCALE;

    const perRow = Math.max(1, Math.floor((width - padding * 2 + gap) / (cardWidth + gap)));
    const column = index % perRow;
    const row = Math.trunc(index / perRow);
    const bottom = height - padding - this.metrics.px(ACTION_HEIGHT) - gap;
    return {
      x: (padding + column * (cardWidth + gap) + cardWidth / 2) / width,
      y: (bottom - cardHeight / 2 - row * (cardHeight + gap)) / height,
    };
  }

  private addCard(scene: Phaser.Scene, land: MapLandView, onPlace: MapWindowOptions['onPlace']): void {
    const card = new Card(scene, this.metrics, 0, 0, { ...cardFace(land.card), draggable: true });

    // 現在地は太い黒枠で囲んで目立たせる。枠は紙の輪郭（Card.paperRect）にそのまま重ね、
    // カードの子にすることでドラッグ・ズームへそのまま追従させる。
    if (land.current) {
      const highlight = scene.add.graphics();
      drawBox(highlight, paperRect(this.metrics, card.cardWidth, card.cardHeight), {
        border: COLOR.cardBorder,
        borderWidth: this.metrics.px(CURRENT_BORDER_WIDTH),
        radius: this.metrics.px(PAPER_RADIUS),
      });
      card.add(highlight);
    }

    // 掴んだカードは他のカードより手前へ出す（重なりの下へ潜ったまま動くと掴んでいる実感が無い）。
    card.on('dragstart', () => scene.children.bringToTop(card));
    card.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      const clamped = this.clampTopLeft(dragX, dragY, this.zoom);
      card.setPosition(clamped.x, clamped.y);
      this.placements.set(land.site, this.placementOf(card));
      this.drawRoads();
    });
    card.on('dragend', () => onPlace(land.site, this.placements.get(land.site)!));

    this.cards.set(land.site, card);
    this.objects.push(card);
  }

  /** カードの左上位置を、閉じるボタンの帯を除いた画面内へ収める。 */
  private clampTopLeft(x: number, y: number, zoom: number): { x: number; y: number } {
    const cardWidth = this.metrics.px(SIZE.cardWidth) * CARD_SCALE * zoom;
    const cardHeight = this.metrics.px(SIZE.cardHeight) * CARD_SCALE * zoom;
    const bottom =
      this.metrics.height - this.metrics.px(WINDOW_PADDING) - this.metrics.px(ACTION_HEIGHT) - cardHeight;
    return {
      x: Phaser.Math.Clamp(x, 0, this.metrics.width - cardWidth),
      y: Phaser.Math.Clamp(y, 0, Math.max(0, bottom)),
    };
  }

  /** 画面上のカードの位置から、変換を逆に辿って正規化座標を求める。 */
  private placementOf(card: Card): MapPlacement {
    const center = this.centerPointOf(card);
    return {
      x: (center.x - this.panX) / (this.metrics.width * this.zoom),
      y: (center.y - this.panY) / (this.metrics.height * this.zoom),
    };
  }

  /** 背景のドラッグで見る範囲を動かす（等倍では動く余地が無いので実質ズーム中だけ）。 */
  private addPan(scene: Phaser.Scene, surface: Phaser.GameObjects.Rectangle): void {
    scene.input.setDraggable(surface);
    surface.on('dragstart', (pointer: Phaser.Input.Pointer) => {
      this.panLast = new Phaser.Math.Vector2(pointer.x, pointer.y);
    });
    surface.on('drag', (pointer: Phaser.Input.Pointer) => {
      if (this.panLast === undefined) return;
      // ピンチ中は中点の移動がパンを受け持つ。直前位置だけ更新して、指が1本へ戻った瞬間の飛びを防ぐ。
      if (this.pinchDistance === undefined) {
        this.panX += pointer.x - this.panLast.x;
        this.panY += pointer.y - this.panLast.y;
        this.applyTransform();
      }
      this.panLast.set(pointer.x, pointer.y);
    });
    surface.on('dragend', () => {
      this.panLast = undefined;
    });
  }

  /**
   * ホイールとピンチの拡大縮小。どちらもポインタ位置（2本指なら中点）の下の地点を動かさずに
   * 倍率だけを変える。ピンチはシーン全体の入力で見る——2本目の指はカードや背景のどれを押して
   * いるか分からないため、オブジェクト単位のイベントでは追えない。
   */
  private addZoom(scene: Phaser.Scene): void {
    // ピンチには2本目のタッチポインタが要る（Phaserの既定はタッチ1本）。既にあれば足さない。
    if (scene.input.pointer2 === undefined) scene.input.addPointer(1);

    const onWheel = (pointer: Phaser.Input.Pointer): void => {
      this.zoomAt(Math.pow(WHEEL_ZOOM_BASE, -pointer.deltaY), pointer.x, pointer.y);
    };
    const onPinch = (): void => {
      const first = scene.input.pointer1;
      const second = scene.input.pointer2;
      if (first === undefined || second === undefined || !first.isDown || !second.isDown) {
        this.pinchDistance = undefined;
        this.pinchMid = undefined;
      } else {
        const distance = Phaser.Math.Distance.Between(first.x, first.y, second.x, second.y);
        const mid = new Phaser.Math.Vector2((first.x + second.x) / 2, (first.y + second.y) / 2);
        if (this.pinchDistance !== undefined && this.pinchMid !== undefined && this.pinchDistance > 0) {
          this.panX += mid.x - this.pinchMid.x;
          this.panY += mid.y - this.pinchMid.y;
          this.zoomAt(distance / this.pinchDistance, mid.x, mid.y);
        }
        this.pinchDistance = distance;
        this.pinchMid = mid;
      }
    };

    this.listenScene(scene, 'wheel', onWheel);
    this.listenScene(scene, 'pointermove', onPinch);
    this.listenScene(scene, 'pointerup', onPinch);
    this.listenScene(scene, 'pointerdown', onPinch);
  }

  private listenScene(scene: Phaser.Scene, event: string, handler: (...args: never[]) => void): void {
    scene.input.on(event, handler);
    this.sceneListeners.push({ event, handler });
  }

  /** ポインタ位置の下の地点を固定したまま倍率を変える（等倍〜MAX_ZOOM倍）。 */
  private zoomAt(factor: number, x: number, y: number): void {
    const zoom = Phaser.Math.Clamp(this.zoom * factor, 1, MAX_ZOOM);
    const scale = zoom / this.zoom;
    this.panX = x - (x - this.panX) * scale;
    this.panY = y - (y - this.panY) * scale;
    this.zoom = zoom;
    this.applyTransform();
  }

  /** 今の変換（ズーム・パン）で、島の輪郭・カード・道を描き直す。 */
  private applyTransform(): void {
    // 地図の端が画面の内側へ入らない範囲にパンを収める（等倍では0に固定される）。
    this.panX = Phaser.Math.Clamp(this.panX, this.metrics.width * (1 - this.zoom), 0);
    this.panY = Phaser.Math.Clamp(this.panY, this.metrics.height * (1 - this.zoom), 0);

    this.outline.clear();
    drawIslandOutline(this.outline, this.metrics, this.zoom, this.panX, this.panY);

    for (const [site, card] of this.cards) {
      const at = this.placements.get(site);
      if (at === undefined) continue;
      card.setScale(CARD_SCALE * this.zoom);
      card.setPosition(
        at.x * this.metrics.width * this.zoom + this.panX - (card.cardWidth * CARD_SCALE * this.zoom) / 2,
        at.y * this.metrics.height * this.zoom + this.panY - (card.cardHeight * CARD_SCALE * this.zoom) / 2,
      );
    }
    this.drawRoads();
  }

  /** 発見済みの道を、カードの中心同士を結ぶ太めの点線の弧として描き直す。ドラッグ中も毎回呼ぶ。 */
  private drawRoads(): void {
    this.roadInk.clear();
    this.roadInk.fillStyle(ROAD_INK, 0.85);
    for (const road of this.roads) {
      const a = this.cards.get(road.a);
      const b = this.cards.get(road.b);
      if (a === undefined || b === undefined) continue;

      const from = this.centerPointOf(a);
      const to = this.centerPointOf(b);
      this.drawDottedArc(from, to, (road.a + road.b) % 2 === 0 ? 1 : -1);
    }
  }

  /** 画面上のカードの中心。 */
  private centerPointOf(card: Card): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(
      card.x + (card.cardWidth * CARD_SCALE * this.zoom) / 2,
      card.y + (card.cardHeight * CARD_SCALE * this.zoom) / 2,
    );
  }

  /**
   * 2点を結ぶ2次ベジェの弧に沿って、等間隔に点を打つ。膨らむ向きは辺ごとに固定（bendSign）で、
   * 開くたび・描き直すたびに同じ形になる。
   */
  private drawDottedArc(from: Phaser.Math.Vector2, to: Phaser.Math.Vector2, bendSign: number): void {
    const distance = Phaser.Math.Distance.BetweenPoints(from, to);
    if (distance === 0) return;

    const bend = distance * ROAD_BEND_RATIO * bendSign;
    const control = new Phaser.Math.Vector2(
      (from.x + to.x) / 2 - ((to.y - from.y) / distance) * bend,
      (from.y + to.y) / 2 + ((to.x - from.x) / distance) * bend,
    );
    const pointAt = (t: number): Phaser.Math.Vector2 =>
      new Phaser.Math.Vector2(
        (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * control.x + t * t * to.x,
        (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * control.y + t * t * to.y,
      );

    // 折れ線で近似して弧長を測り、その上へ等間隔に点を置く。点の大きさ・間隔もズームに合わせる。
    const samples = 64;
    const points: Phaser.Math.Vector2[] = [];
    const lengths: number[] = [0];
    for (let i = 0; i <= samples; i++) {
      points.push(pointAt(i / samples));
      if (i > 0) lengths.push(lengths[i - 1] + Phaser.Math.Distance.BetweenPoints(points[i - 1], points[i]));
    }
    const total = lengths[samples];
    const dots = Math.max(1, Math.round(total / (this.metrics.px(ROAD_DOT_SPACING) * this.zoom)));

    let segment = 1;
    for (let dot = 0; dot <= dots; dot++) {
      const target = (dot / dots) * total;
      while (segment < samples && lengths[segment] < target) segment++;
      const over = lengths[segment] - lengths[segment - 1];
      const ratio = over === 0 ? 0 : (target - lengths[segment - 1]) / over;
      const point = points[segment - 1].clone().lerp(points[segment], ratio);
      this.roadInk.fillCircle(point.x, point.y, this.metrics.px(ROAD_DOT_RADIUS) * this.zoom);
    }
  }

  close(): void {
    for (const { event, handler } of this.sceneListeners) this.scene.input.off(event, handler);
    this.sceneListeners.length = 0;
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
    this.cards.clear();
    this.placements.clear();
  }
}

/**
 * 背景の島の輪郭。円の半径をいくつかの正弦波で揺らしただけの、実際の地形とは無関係の適当な形。
 * 揺らし方は固定で、どのセーブでも同じ輪郭になる。ズーム・パンは点の変換で反映する。
 */
function drawIslandOutline(
  outline: Phaser.GameObjects.Graphics,
  metrics: ScreenMetrics,
  zoom: number,
  panX: number,
  panY: number,
): void {
  const centerX = (metrics.width / 2) * zoom + panX;
  const centerY = (metrics.height / 2) * zoom + panY;
  const radius = Math.min(metrics.width, metrics.height) * 0.42 * zoom;

  outline.lineStyle(metrics.linePx(3 * zoom), CHART_LINE, 0.7);
  outline.beginPath();
  const count = 128;
  for (let i = 0; i <= count; i++) {
    const angle = ((i % count) / count) * Math.PI * 2;
    const wobble =
      0.86 +
      0.07 * Math.sin(angle * 2 + 0.8) +
      0.05 * Math.sin(angle * 3 + 2.1) +
      0.03 * Math.sin(angle * 5 + 4.2);
    const x = centerX + Math.cos(angle) * radius * wobble;
    const y = centerY + Math.sin(angle) * radius * wobble;
    if (i === 0) outline.moveTo(x, y);
    else outline.lineTo(x, y);
  }
  outline.closePath();
  outline.strokePath();
}
