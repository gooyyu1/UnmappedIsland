import type Phaser from 'phaser';
import type { ScreenMetrics } from '../layout/ScreenMetrics';
import { Card, cardFace } from './Card';
import type { CardLane, LaneDropTarget } from './CardLane';
import { drawBox } from './shapes';
import { COLOR, SIZE } from './theme';

/** その場で押し続けたらドラッグとみなすまでの時間（ミリ秒）と、その間に許す指のぶれ（u単位）。 */
const LONG_PRESS_MS = 300;
const LONG_PRESS_SLOP = 12;

/** 方向で判断を始めるまでの移動距離（u単位）と、「明らかに縦」とみなす縦横比。 */
const DIRECTION_THRESHOLD = 20;
const VERTICAL_RATIO = 1.5;

/** ドラッグ中の分身の濃さと、掴まれて場所が空いた元のカードの濃さ。 */
const GHOST_ALPHA = 0.9;
const GRABBED_ALPHA = 0.3;

/** ドロップ先を示す枠の太さ（u単位）と、塗りの濃さ。 */
const INDICATOR_BORDER = 6;
const INDICATOR_FILL_ALPHA = 0.3;

/** ドラッグしたカードを落とした先。 */
export interface CardDrop {
  readonly from: CardLane;
  readonly fromIndex: number;
  readonly to: CardLane;
  readonly target: LaneDropTarget;
}

export interface CardDragHandlers {
  /** そのドロップで何かが起きるか。起きないドロップは枠を出さず、離しても何もしない。 */
  readonly canDrop: (drop: CardDrop) => boolean;
  readonly onDrop: (drop: CardDrop) => void;
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

    if (Math.abs(dy) > Math.abs(dx) * VERTICAL_RATIO) this.startDragging(pointer);
    else gesture.kind = 'scrolling';
  }

  private startDragging(pointer: Phaser.Input.Pointer): void {
    const gesture = this.gesture;
    if (gesture === undefined) return;

    gesture.kind = 'dragging';
    // 掴んで動くのは1つだけなので、スタックは残りがそこに居る。薄くするのは場所ごと空くときだけ。
    if ((gesture.card.content.count ?? 1) < 2) gesture.card.setAlpha(GRABBED_ALPHA);
    // 分身を先に作り、枠を後から作る（後に作ったものが手前に描かれる）。どこへ落ちるかの方が
    // 分身の見た目より大事なので、枠を分身の上に出す。
    gesture.ghost = new Card(this.scene, this.metrics(), 0, 0, cardFace(gesture.card.content));
    gesture.ghost.setAlpha(GHOST_ALPHA);
    gesture.indicator = this.scene.add.graphics();
    this.follow(pointer);
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
    const drop = this.dropAt(gesture, pointer);
    if (drop === undefined) return;

    const rect = drop.to.dropIndicatorRect(drop.target);
    drawBox(gesture.indicator, rect, {
      fill: COLOR.cardDropTarget,
      fillAlpha: INDICATOR_FILL_ALPHA,
      border: COLOR.cardDropTarget,
      borderWidth: this.metrics().px(INDICATOR_BORDER),
      radius: this.metrics().px(SIZE.radius),
    });
  }

  /** 今のポインタ位置で成立するドロップ（何も起きないものはundefined）。 */
  private dropAt(gesture: Gesture, pointer: Phaser.Input.Pointer): CardDrop | undefined {
    for (const lane of this.lanes) {
      const target = lane.dropTargetAt(pointer.x, pointer.y);
      if (target === undefined) continue;

      const drop = { from: gesture.lane, fromIndex: gesture.index, to: lane, target };
      return this.handlers.canDrop(drop) ? drop : undefined;
    }
    return undefined;
  }

  /** ドロップの実行はカードを動かすので、その前にドラッグ中の表示物を片付けておく。 */
  private end(pointer: Phaser.Input.Pointer): void {
    const gesture = this.gesture;
    if (gesture === undefined) return;

    const drop = gesture.kind === 'dragging' ? this.dropAt(gesture, pointer) : undefined;
    this.cancel();
    if (drop !== undefined) this.handlers.onDrop(drop);
  }

  private cancel(): void {
    const gesture = this.gesture;
    if (gesture === undefined) return;

    gesture.longPress?.remove();
    gesture.ghost?.destroy();
    gesture.indicator?.destroy();
    // 掴んでいたカードは、画面を作り直していれば既に破棄されている（sceneがundefinedになる）。
    if (gesture.card.scene !== undefined) gesture.card.setAlpha(1);
    this.gesture = undefined;
  }
}
