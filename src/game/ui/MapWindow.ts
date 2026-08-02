import Phaser from 'phaser';
import type { ScreenMetrics } from '../layout/ScreenMetrics';
import type { MapLandView, MapRoadView } from '../PlayScreenView';
import { addTextButton } from './Button';
import { Card, cardFace } from './Card';
import { ACTION_HEIGHT, ACTION_MAX_WIDTH, WINDOW_PADDING } from './childWindow';
import { addLabel } from './labels';
import { addPanel } from './shapes';
import { COLOR, SIZE } from './theme';

/** 地図上のカードの縮尺（レーンのカードに対する比）。一覧性を優先して小さめにする。 */
const CARD_SCALE = 0.5;

/** 海図風の下地（羊皮紙の薄茶）と、島の輪郭のごく薄い線の色。 */
const CHART_PAPER = 0xf3ead4;
const CHART_LINE = 0xcdbb92;

/** 道の点線のインクの色と、1点の半径・間隔（u単位）。 */
const ROAD_INK = 0x8a6f4f;
const ROAD_DOT_RADIUS = 5;
const ROAD_DOT_SPACING = 22;

/** 道の弧の膨らみ（両端の距離に対する比）。直線ではなく手描きの海路らしい曲線にする。 */
const ROAD_BEND_RATIO = 0.18;

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
 * 自分だけの地図を作る（ScreenLayout.md 地図ウィンドウ節）。
 *
 * 背景の島の輪郭は実際の地形ではなく、カードを置くときの目安になる「個性のない円形に近い島」。
 * 実際の配置を写してしまうと、自分で地図を描き上げる遊びが成り立たないため。
 */
export class MapWindow {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly metrics: ScreenMetrics;

  /** サイトindex→そのカード。道の描き直し（drawRoads）とドラッグの追従に使う。 */
  private readonly cards = new Map<number, Card>();

  private readonly roads: readonly MapRoadView[];
  private readonly roadInk: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, options: MapWindowOptions) {
    this.metrics = metrics;
    this.roads = options.roads;
    const { width, height } = metrics;
    const padding = metrics.px(WINDOW_PADDING);

    this.objects.push(addPanel(scene, { x: 0, y: 0, width, height }, CHART_PAPER));

    const outline = scene.add.graphics();
    drawIslandOutline(outline, metrics);
    this.objects.push(outline);

    // 道はカードより奥に描く（カードの下から点線が延びて見える）。
    this.roadInk = scene.add.graphics();
    this.objects.push(this.roadInk);

    const title = addLabel(scene, metrics, padding, padding, '地図', { size: 34, bold: true });
    this.objects.push(
      title,
      addLabel(
        scene,
        metrics,
        padding,
        padding + title.height + metrics.px(4),
        'カードを動かして、自分だけの地図を作る',
        {
          size: 22,
          color: COLOR.textMuted,
        },
      ),
    );

    let unplaced = 0;
    for (const land of options.lands) {
      const at = options.positions.get(land.site) ?? this.traySlot(unplaced++);
      this.addCard(scene, land, at, options.onPlace);
    }
    this.drawRoads();

    const actionHeight = metrics.px(ACTION_HEIGHT);
    const actionWidth = Math.min(metrics.px(ACTION_MAX_WIDTH), width - padding * 2);
    this.objects.push(
      addTextButton(
        scene,
        metrics,
        {
          x: (width - actionWidth) / 2,
          y: height - padding - actionHeight,
          width: actionWidth,
          height: actionHeight,
        },
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

  private addCard(
    scene: Phaser.Scene,
    land: MapLandView,
    at: MapPlacement,
    onPlace: MapWindowOptions['onPlace'],
  ): void {
    const card = new Card(scene, this.metrics, 0, 0, { ...cardFace(land.card), draggable: true });
    card.setScale(CARD_SCALE);
    this.placeCard(card, at);

    // 掴んだカードは他のカードより手前へ出す（重なりの下へ潜ったまま動くと掴んでいる実感が無い）。
    card.on('dragstart', () => scene.children.bringToTop(card));
    card.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      const clamped = this.clampTopLeft(dragX, dragY);
      card.setPosition(clamped.x, clamped.y);
      this.drawRoads();
    });
    card.on('dragend', () => onPlace(land.site, this.centerOf(card)));

    this.cards.set(land.site, card);
    this.objects.push(card);
  }

  /** カードを正規化座標（中心）で置く。保存された位置が今の画面外を指していても、必ず画面内へ収める。 */
  private placeCard(card: Card, at: MapPlacement): void {
    const clamped = this.clampTopLeft(
      at.x * this.metrics.width - (card.cardWidth * CARD_SCALE) / 2,
      at.y * this.metrics.height - (card.cardHeight * CARD_SCALE) / 2,
    );
    card.setPosition(clamped.x, clamped.y);
  }

  /** カードの左上位置を、閉じるボタンの帯を除いた画面内へ収める。 */
  private clampTopLeft(x: number, y: number): { x: number; y: number } {
    const cardWidth = this.metrics.px(SIZE.cardWidth) * CARD_SCALE;
    const cardHeight = this.metrics.px(SIZE.cardHeight) * CARD_SCALE;
    const bottom =
      this.metrics.height - this.metrics.px(WINDOW_PADDING) - this.metrics.px(ACTION_HEIGHT) - cardHeight;
    return {
      x: Phaser.Math.Clamp(x, 0, this.metrics.width - cardWidth),
      y: Phaser.Math.Clamp(y, 0, Math.max(0, bottom)),
    };
  }

  private centerOf(card: Card): MapPlacement {
    return {
      x: (card.x + (card.cardWidth * CARD_SCALE) / 2) / this.metrics.width,
      y: (card.y + (card.cardHeight * CARD_SCALE) / 2) / this.metrics.height,
    };
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

  private centerPointOf(card: Card): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(
      card.x + (card.cardWidth * CARD_SCALE) / 2,
      card.y + (card.cardHeight * CARD_SCALE) / 2,
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

    // 折れ線で近似して弧長を測り、その上へ等間隔に点を置く。
    const samples = 64;
    const points: Phaser.Math.Vector2[] = [];
    const lengths: number[] = [0];
    for (let i = 0; i <= samples; i++) {
      points.push(pointAt(i / samples));
      if (i > 0) lengths.push(lengths[i - 1] + Phaser.Math.Distance.BetweenPoints(points[i - 1], points[i]));
    }
    const total = lengths[samples];
    const dots = Math.max(1, Math.round(total / this.metrics.px(ROAD_DOT_SPACING)));

    let segment = 1;
    for (let dot = 0; dot <= dots; dot++) {
      const target = (dot / dots) * total;
      while (segment < samples && lengths[segment] < target) segment++;
      const over = lengths[segment] - lengths[segment - 1];
      const ratio = over === 0 ? 0 : (target - lengths[segment - 1]) / over;
      const point = points[segment - 1].clone().lerp(points[segment], ratio);
      this.roadInk.fillCircle(point.x, point.y, this.metrics.px(ROAD_DOT_RADIUS));
    }
  }

  close(): void {
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
    this.cards.clear();
  }
}

/**
 * 背景の島の輪郭。円の半径をいくつかの正弦波で揺らしただけの、実際の地形とは無関係の適当な形。
 * 揺らし方は固定で、どのセーブでも同じ輪郭になる。
 */
function drawIslandOutline(outline: Phaser.GameObjects.Graphics, metrics: ScreenMetrics): void {
  const centerX = metrics.width / 2;
  const centerY = metrics.height / 2;
  const radius = Math.min(metrics.width, metrics.height) * 0.42;

  outline.lineStyle(Math.max(1, metrics.px(3)), CHART_LINE, 0.7);
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
