import type Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import { Card, cardFace } from './Card';
import type { CardLane, LaneDropTarget } from './CardLane';
import type { TooltipContent } from './Tooltip';
import { Tooltip } from './Tooltip';
import { drawBox } from './shapes';
import { COLOR, SIZE } from './theme';

/** その場で押し続けたらドラッグとみなすまでの時間（ミリ秒）と、その間に許す指のぶれ（u単位）。 */
const LONG_PRESS_MS = 300;
const LONG_PRESS_SLOP = 12;

/** 方向で判断を始めるまでの移動距離（u単位）と、「明らかに縦」とみなす縦横比。 */
const DIRECTION_THRESHOLD = 20;
const VERTICAL_RATIO = 1.5;

/** ドロップ先を示す枠の太さ（u単位）と、塗りの濃さ。 */
const INDICATOR_BORDER = 6;
const INDICATOR_FILL_ALPHA = 0.3;

/**
 * 受け入れられるカードのふちの光。太さの違う枠を重ねて、外側ほど薄くすることで滲みを作る
 * （Phaserに発光の描画が無いため）。明滅は左右の往復で、止まった枠との違いを出す。
 */
const GLOW_LAYERS = [
  { border: 34, alpha: 0.25 },
  { border: 20, alpha: 0.5 },
  { border: 10, alpha: 1 },
];
const GLOW_PULSE_MS = 1200;
const GLOW_PULSE_ALPHA = 0.2;

/** ドラッグしたカードを落とした先。 */
export interface CardDrop {
  readonly from: CardLane;
  readonly fromIndex: number;
  readonly to: CardLane;
  readonly target: LaneDropTarget;
}

/** そのドロップで何が起きるか。 */
export interface CardDropInfo {
  /** 重ねたときに何が起きるかの説明（combinationのときだけ持つ）。 */
  readonly tooltip?: TooltipContent;
}

export interface CardDragHandlers {
  /**
   * そのドロップで何が起きるか（何も起きないならundefined）。ドロップ先の枠・受け入れ側のふちの光・
   * 説明の吹き出しは、いずれもこの答えだけを見て決める。
   */
  readonly describeDrop: (drop: CardDrop) => CardDropInfo | undefined;
  /** releasedは手を離した時点で分身が居た矩形。落とした後の動きの出発点になる（CardMotion参照）。 */
  readonly onDrop: (drop: CardDrop, released: Rect) => void;
}

/** 押してから離すまでの1回の操作。カードのドラッグとレーンのスクロールのどちらになるかは押した後に決まる。 */
interface Gesture {
  readonly lane: CardLane;
  readonly index: number;
  readonly card: Card;
  readonly startX: number;
  readonly startY: number;
  kind: 'pending' | 'scrolling' | 'dragging';
  longPress: Phaser.Time.TimerEvent | undefined;
  ghost: Card | undefined;
  indicator: Phaser.GameObjects.Graphics | undefined;
  /** 受け入れられるカードのふちの光と、その明滅。 */
  glow: Phaser.GameObjects.Graphics | undefined;
  glowPulse: Phaser.Tweens.Tween | undefined;
  tooltip: Tooltip | undefined;
}

/**
 * レーンをまたぐカードのドラッグ＆ドロップ（ScreenLayout.md カードのドラッグ＆ドロップ節）。
 *
 * レーン自体も横ドラッグでスクロールするため、カードの上から始まったドラッグがどちらの操作なのかを
 * 押した後に見分ける: その場でのロングプレス、または明らかに縦方向の動きならカードを掴んだとみなし、
 * それ以外の横方向の動きはレーンのスクロールへ回す。
 *
 * ドラッグ中の表示は元のカードではなく、シーン直下に作る分身で行う。レーンからはみ出したカードは
 * 隣接エリアの背景板に隠れてしまう（CardLane参照）ため、レーンの外へは持ち出せないため。
 */
export class CardDragController {
  private readonly scene: Phaser.Scene;
  /** 画面を作り直すと寸法が変わるため、その都度の値を引けるようにしておく。 */
  private readonly metrics: () => ScreenMetrics;
  private readonly handlers: CardDragHandlers;
  private readonly lanes: CardLane[] = [];

  private gesture: Gesture | undefined;

  /**
   * ドラッグの受け口はカード個別ではなくシーンに置く。カードは画面の更新をまたいで生き残り、
   * 属するレーンも並びの位置も変わる（CardLane.setCards）ため、掴まれた時点で引き直す。
   */
  constructor(scene: Phaser.Scene, metrics: () => ScreenMetrics, handlers: CardDragHandlers) {
    this.scene = scene;
    this.metrics = metrics;
    this.handlers = handlers;

    scene.input.on('dragstart', (pointer: Phaser.Input.Pointer, object: Phaser.GameObjects.GameObject) =>
      this.begin(object, pointer),
    );
    scene.input.on('drag', (pointer: Phaser.Input.Pointer) => this.update(pointer));
    scene.input.on('dragend', (pointer: Phaser.Input.Pointer) => this.end(pointer));
  }

  /** ドラッグ元・ドロップ先になるレーンを差し替える（画面を組み立て直したとき）。 */
  setLanes(lanes: readonly CardLane[]): void {
    this.cancel();
    this.lanes.length = 0;
    this.lanes.push(...lanes);
  }

  /** 掴まれたものが、管理下のレーンに並ぶカードならその居場所。 */
  private locate(object: Phaser.GameObjects.GameObject): { lane: CardLane; index: number } | undefined {
    for (const lane of this.lanes) {
      const index = lane.cardObjects.indexOf(object as Card);
      if (index >= 0) return { lane, index };
    }
    return undefined;
  }

  /**
   * Phaserはしきい値なしでポインタを押した時点でdragstartを出すため、ここではまだどちらの操作かを
   * 決めず、ロングプレスの計測だけを始める（レーン側もスクロールの基準を控えておく）。
   */
  private begin(object: Phaser.GameObjects.GameObject, pointer: Phaser.Input.Pointer): void {
    this.cancel();

    const found = this.locate(object);
    if (found === undefined) return;

    const { lane, index } = found;
    lane.beginScroll();

    const gesture: Gesture = {
      lane,
      index,
      card: object as Card,
      startX: pointer.x,
      startY: pointer.y,
      kind: 'pending',
      longPress: undefined,
      ghost: undefined,
      indicator: undefined,
      glow: undefined,
      glowPulse: undefined,
      tooltip: undefined,
    };
    this.gesture = gesture;

    const slop = this.metrics().px(LONG_PRESS_SLOP);
    gesture.longPress = this.scene.time.delayedCall(LONG_PRESS_MS, () => {
      if (this.gesture !== gesture || gesture.kind !== 'pending') return;
      if (Math.hypot(pointer.x - gesture.startX, pointer.y - gesture.startY) > slop) return;
      this.startDragging(pointer);
    });
  }

  private update(pointer: Phaser.Input.Pointer): void {
    const gesture = this.gesture;
    if (gesture === undefined) return;

    if (gesture.kind === 'pending') this.decide(gesture, pointer);
    if (gesture.kind === 'scrolling') gesture.lane.scrollByDrag(pointer.x - pointer.downX);
    else if (gesture.kind === 'dragging') this.follow(pointer);
  }

  /** 動きが十分に大きくなったら、その向きでカードのドラッグかレーンのスクロールかを決める。 */
  private decide(gesture: Gesture, pointer: Phaser.Input.Pointer): void {
    const dx = pointer.x - gesture.startX;
    const dy = pointer.y - gesture.startY;
    if (Math.hypot(dx, dy) < this.metrics().px(DIRECTION_THRESHOLD)) return;

    if (Math.abs(dy) > Math.abs(dx) * VERTICAL_RATIO) {
      this.startDragging(pointer);
      return;
    }

    gesture.kind = 'scrolling';
    gesture.card.cancelTap();
  }

  private startDragging(pointer: Phaser.Input.Pointer): void {
    const gesture = this.gesture;
    if (gesture === undefined) return;

    gesture.kind = 'dragging';
    // 掴んで動かす操作になったので、掴んだカードの上で指を離してもタップにはしない（Card.cancelTap）。
    gesture.card.cancelTap();

    // 作る順がそのまま重なりの順になる。ふちの光もどこへ落ちるかの枠もレーンのカードの装飾なので
    // 分身より奥（指が運んでいるカードは常に見えている必要がある）、説明だけが分身より手前。
    this.showAcceptingCards(gesture);
    gesture.indicator = this.scene.add.graphics();
    gesture.ghost = new Card(this.scene, this.metrics(), 0, 0, cardFace(gesture.card.content));
    gesture.tooltip = new Tooltip(this.scene, this.metrics());
    this.follow(pointer);
  }

  /** 今掴んでいるカードを受け入れられるカードすべてのふちを光らせる。 */
  private showAcceptingCards(gesture: Gesture): void {
    const glow = this.scene.add.graphics();
    gesture.glow = glow;

    for (const lane of this.lanes) {
      lane.cardObjects.forEach((card, index) => {
        if (card === undefined) return;
        const drop = { from: gesture.lane, fromIndex: gesture.index, to: lane, target: cardTarget(index) };
        if (this.handlers.describeDrop(drop) === undefined) return;

        const rect = lane.slotRect(index);
        for (const layer of GLOW_LAYERS) {
          glow.lineStyle(this.metrics().px(layer.border), COLOR.cardDropAccept, layer.alpha);
          glow.strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, this.metrics().px(SIZE.radius));
        }
      });
    }

    gesture.glowPulse = this.scene.tweens.add({
      targets: glow,
      alpha: GLOW_PULSE_ALPHA,
      duration: GLOW_PULSE_MS,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });
  }

  /** 分身をポインタの中心へ置き、今の位置で成立するドロップ先を枠で示す。 */
  private follow(pointer: Phaser.Input.Pointer): void {
    const gesture = this.gesture;
    if (gesture?.ghost === undefined || gesture.indicator === undefined) return;

    gesture.ghost.setPosition(
      pointer.x - gesture.ghost.cardWidth / 2,
      pointer.y - gesture.ghost.cardHeight / 2,
    );

    gesture.indicator.clear();
    const found = this.dropAt(gesture, pointer);
    if (found === undefined) {
      gesture.tooltip?.hide();
      return;
    }

    const { drop, info } = found;
    const rect = drop.to.dropIndicatorRect(drop.target);
    drawBox(gesture.indicator, rect, {
      fill: COLOR.cardDropTarget,
      fillAlpha: INDICATOR_FILL_ALPHA,
      border: COLOR.cardDropTarget,
      borderWidth: this.metrics().px(INDICATOR_BORDER),
      radius: this.metrics().px(SIZE.radius),
    });

    if (info.tooltip === undefined) gesture.tooltip?.hide();
    else gesture.tooltip?.show(info.tooltip, ghostRect(gesture)!);
  }

  /** 今のポインタ位置で成立するドロップと、そこで起きること（何も起きないものはundefined）。 */
  private dropAt(
    gesture: Gesture,
    pointer: Phaser.Input.Pointer,
  ): { drop: CardDrop; info: CardDropInfo } | undefined {
    for (const lane of this.lanes) {
      const target = lane.dropTargetAt(pointer.x, pointer.y);
      if (target === undefined) continue;

      const drop = { from: gesture.lane, fromIndex: gesture.index, to: lane, target };
      const info = this.handlers.describeDrop(drop);
      return info === undefined ? undefined : { drop, info };
    }
    return undefined;
  }

  /** ドロップの実行はカードを動かすので、その前にドラッグ中の表示物を片付けておく。 */
  private end(pointer: Phaser.Input.Pointer): void {
    const gesture = this.gesture;
    if (gesture === undefined) return;

    const found = gesture.kind === 'dragging' ? this.dropAt(gesture, pointer) : undefined;
    // 分身はcancelで消えるので、その居場所を先に控える。落としたカードはここから動き出す。
    const released = ghostRect(gesture);
    this.cancel();
    if (found !== undefined && released !== undefined) this.handlers.onDrop(found.drop, released);
  }

  private cancel(): void {
    const gesture = this.gesture;
    if (gesture === undefined) return;

    gesture.longPress?.remove();
    gesture.ghost?.destroy();
    gesture.indicator?.destroy();
    gesture.glowPulse?.remove();
    gesture.glow?.destroy();
    gesture.tooltip?.destroy();
    this.gesture = undefined;
  }
}

/** 掴んでいる分身が今いる矩形（掴んでいなければundefined）。 */
function ghostRect(gesture: Gesture): Rect | undefined {
  const { ghost } = gesture;
  return ghost === undefined
    ? undefined
    : { x: ghost.x, y: ghost.y, width: ghost.cardWidth, height: ghost.cardHeight };
}

/** レーンの添字のカードに重ねるドロップ先。 */
function cardTarget(index: number): LaneDropTarget {
  return { kind: 'combine', index };
}
