import type Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import type { Card } from './Card';
import type { CardLane, LaneDropTarget } from './CardLane';
import type { CarriedCard } from './CardTable';
import { noteOperation } from '../errorReport';
import { HoldRepeat } from '../../ui/holdRepeat';
import type { TooltipContent } from './Tooltip';
import { Tooltip } from './Tooltip';
import { drawBox } from '../../ui/shapes';
import { COLOR, SIZE } from '../looks/theme';

/** タップの指のぶれと見分けて、動かす操作が始まったとみなす移動距離（u単位）。 */
const MOVE_THRESHOLD = 20;

/**
 * 「落とし先の上で指を止めたまま待つ」の、止まっているとみなす揺れの上限（u単位）。これを超えて
 * 動いている間は待ち時間を数えない——空き枠は当たり判定が広いので、上を通り過ぎるだけの時間まで
 * 数えると、落とすつもりで横切っただけの指に2枚目がついてきてしまう。
 */
const CARRY_REST_SLOP = 12;

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
  /** この操作で動かす枚数（1以上）。束をまとめて運んでいるときだけ2以上になる。 */
  readonly count: number;
}

/** そのドロップで何が起きるか。 */
export interface CardDropInfo {
  /** 重ねたときに何が起きるかの説明（combinationのときだけ持つ）。 */
  readonly tooltip?: TooltipContent;
  /**
   * その落とし先へまとめて動かせる最大枚数（省略時は1＝ついてこない）。**ついてきた枚数はそのまま
   * 「これだけ入る」という約束**なので、入りきらないぶんは最初からついてこない。
   */
  readonly maxCount?: number;
}

export interface CardDragHandlers {
  /**
   * そのドロップで何が起きるか（何も起きないならundefined）。ドロップ先の枠・受け入れ側のふちの光・
   * 説明の吹き出しは、いずれもこの答えだけを見て決める。
   */
  readonly describeDrop: (drop: CardDrop) => CardDropInfo | undefined;
  /** releasedRectは手を離した時点で札が居た矩形。落とした後の動きの出発点になる（CardTable参照）。 */
  readonly onDrop: (drop: CardDrop, releasedRect: Rect) => void;
  /** 掴んだ札を指の運ぶ実体の札にする（CardTable.grab）。 */
  readonly grab: (card: Card, home: () => Rect) => CarriedCard;
}

/** ついてくる枚数を数え続けている落とし先。ここが変わらない限り数え続ける（trackCarry参照）。 */
interface CarryTarget {
  readonly to: CardLane;
  readonly target: LaneDropTarget;
}

/** 押してから離すまでの1回の操作。カードのドラッグとレーンのスクロールのどちらになるかは押した後に決まる。 */
interface Gesture {
  readonly lane: CardLane;
  readonly index: number;
  readonly card: Card;
  readonly startX: number;
  readonly startY: number;
  kind: 'pending' | 'scrolling' | 'dragging';
  /** 指が運んでいる札（実体のカードそのもの。CardTable.CarriedCard）。 */
  carried: CarriedCard | undefined;
  indicator: Phaser.GameObjects.Graphics | undefined;
  /** 受け入れられるカードのふちの光と、その明滅。 */
  glow: Phaser.GameObjects.Graphics | undefined;
  glowPulse: Phaser.Tweens.Tween | undefined;
  tooltip: Tooltip | undefined;
  /** 最後に指が居た場所。ついてくる枚数が増えたときに、そこから表示を作り直す。 */
  pointer: Phaser.Input.Pointer | undefined;
  /** ついてくる枚数を数え続けている落とし先と、数える時計。 */
  carryTarget: CarryTarget | undefined;
  carryHold: HoldRepeat | undefined;
  /** 指が止まっているとみなしている位置。ここからCARRY_REST_SLOPを超えて動いたら数え直す。 */
  carryAnchor: { readonly x: number; readonly y: number } | undefined;
}

/**
 * レーンをまたぐカードのドラッグ＆ドロップ（CardInteraction.md 2節 カードのドラッグ＆ドロップ）。
 *
 * レーン自体も横ドラッグでスクロールするため、カードの上から始まったドラッグがどちらの操作なのかを
 * **押し始めた位置**で見分ける: カードの本体から始まればカードを掴んだとみなし、左右の端から始まった
 * ものはレーンのスクロールへ回す（CardLane.isCardBody）。どちらになるかは押した時点で決まっているので、
 * 掴むのに待ち時間は要らない。
 *
 * 指が運ぶのは実体の札そのもの（CardTable.CarriedCard）。掴んだ時点で元の束から分かれ、最前面の
 * 層で指に追従する——レーンからはみ出したカードは隣接エリアの背景板に隠れてしまう（CardLane参照）
 * ため、レーンの中に置いたままでは持ち出せない。
 *
 * **落とし先の上で待つと、同じ束の2枚目以降がついてくる**（trackCarry）。離せばついてきたぶんが
 * 一度に入る。ついてくるのは入る枚数までで、ついてきた枚数はそのまま「これだけ入る」という約束になる。
 * 運んでいる札そのものはCarriedCardが持ち、ここは「いつ増やすか・何枚まで許されるか」だけを決める。
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
   * 属するレーンも並びの位置も変わる（CardLane.reconcile）ため、掴まれた時点で引き直す。
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

  /** 掴まれた札が、管理下のレーンに並んでいるならその居場所。 */
  private locate(card: Card): { lane: CardLane; index: number } | undefined {
    for (const lane of this.lanes) {
      const index = lane.indexOf(card);
      if (index !== undefined) return { lane, index };
    }
    return undefined;
  }

  /**
   * Phaserはしきい値なしでポインタを押した時点でdragstartを出すため、ここではまだ何も始めない
   * ——押しただけならタップなので、押し始めた場所だけ控えて動き出すのを待つ（レーン側も
   * スクロールの基準を控えておく）。
   */
  private begin(object: Phaser.GameObjects.GameObject, pointer: Phaser.Input.Pointer): void {
    this.cancel();

    const card = object as Card;
    const found = this.locate(card);
    // 0枚の枠に在るのは札ではなく、帰ってくる場所を示す印なので掴めない（Card.holdsCard）。
    if (found === undefined || !card.holdsCard) return;

    const { lane, index } = found;
    lane.beginScroll();

    const gesture: Gesture = {
      lane,
      index,
      card,
      startX: pointer.x,
      startY: pointer.y,
      kind: 'pending',
      carried: undefined,
      indicator: undefined,
      glow: undefined,
      glowPulse: undefined,
      tooltip: undefined,
      pointer: undefined,
      carryTarget: undefined,
      carryHold: undefined,
      carryAnchor: undefined,
    };
    this.gesture = gesture;
  }

  private update(pointer: Phaser.Input.Pointer): void {
    const gesture = this.gesture;
    if (gesture === undefined) return;

    if (gesture.kind === 'pending') this.decide(gesture, pointer);
    if (gesture.kind === 'scrolling') gesture.lane.scrollByDrag(pointer.x - pointer.downX);
    else if (gesture.kind === 'dragging') this.follow(gesture, pointer);
  }

  /**
   * タップと見分けられるだけ動いたら、**押し始めた位置**でカードのドラッグかレーンのスクロールかを
   * 決める。向きは見ない——どちらの操作かは押した時点で決まっており、動きはその始まりを知らせるだけ。
   */
  private decide(gesture: Gesture, pointer: Phaser.Input.Pointer): void {
    const dx = pointer.x - gesture.startX;
    const dy = pointer.y - gesture.startY;
    if (Math.hypot(dx, dy) < this.metrics().px(MOVE_THRESHOLD)) return;

    if (gesture.lane.isCardBody(gesture.startX, gesture.startY, gesture.index)) {
      this.startDragging(gesture, pointer);
      return;
    }

    gesture.kind = 'scrolling';
    gesture.card.cancelTap();
  }

  private startDragging(gesture: Gesture, pointer: Phaser.Input.Pointer): void {
    gesture.kind = 'dragging';
    noteOperation(`カードを掴んだ: ${gesture.card.content.name}`);
    // 掴んで動かす操作になったので、掴んだカードの上で指を離してもタップにはしない（Card.cancelTap）。
    gesture.card.cancelTap();

    // 作る順がそのまま重なりの順になる。ふちの光もどこへ落ちるかの枠もレーンのカードの装飾なので
    // 運んでいる札より奥（指が運んでいるカードは常に見えている必要がある）、説明だけが手前。
    this.showAcceptingCards(gesture);
    gesture.indicator = this.scene.add.graphics();
    gesture.carried = this.handlers.grab(gesture.card, () => gesture.lane.cellRect(gesture.index));
    gesture.tooltip = new Tooltip(this.scene, this.metrics());
    gesture.carryHold = new HoldRepeat(this.scene);
    this.follow(gesture, pointer);
  }

  /** 今掴んでいるカードを受け入れられるカードすべてのふちを光らせる。 */
  private showAcceptingCards(gesture: Gesture): void {
    const glow = this.scene.add.graphics();
    gesture.glow = glow;

    for (const lane of this.lanes) {
      for (const { index, rect } of lane.placements) {
        const drop = {
          from: gesture.lane,
          fromIndex: gesture.index,
          to: lane,
          target: { kind: 'combine', index } as const,
          count: 1,
        };
        if (this.handlers.describeDrop(drop) === undefined) continue;

        for (const layer of GLOW_LAYERS) {
          glow.lineStyle(this.metrics().px(layer.border), COLOR.cardDropAccept, layer.alpha);
          glow.strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, this.metrics().px(SIZE.radius));
        }
      }
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

  /** 運んでいる札をポインタの中心へ置き、今の位置で成立するドロップ先を枠で示す。 */
  private follow(gesture: Gesture, pointer: Phaser.Input.Pointer): void {
    if (gesture.carried === undefined || gesture.indicator === undefined) return;

    gesture.pointer = pointer;
    gesture.carried.follow(pointer.x, pointer.y);

    gesture.indicator.clear();
    let found = this.dropCandidateAt(gesture, pointer);
    // 数え直したなら運ぶ枚数が変わったので、そのドロップが何をするのかも引き直す。
    if (this.trackCarry(gesture, found, pointer)) found = this.dropCandidateAt(gesture, pointer);
    if (found === undefined) {
      gesture.tooltip?.hide();
    } else {
      const { drop, info } = found;
      const rect = drop.to.dropIndicatorRect(drop.target);
      drawBox(gesture.indicator, rect, {
        fillColor: COLOR.cardDropTarget,
        fillAlpha: INDICATOR_FILL_ALPHA,
        borderColor: COLOR.cardDropTarget,
        borderWidth: this.metrics().px(INDICATOR_BORDER),
        radius: this.metrics().px(SIZE.radius),
      });

      if (info.tooltip === undefined) gesture.tooltip?.hide();
      else gesture.tooltip?.show(info.tooltip, gesture.carried.rect);
    }
  }

  /** 今のポインタ位置で成立するドロップと、そこで起きること（何も起きないものはundefined）。 */
  private dropCandidateAt(
    gesture: Gesture,
    pointer: Phaser.Input.Pointer,
  ): { drop: CardDrop; info: CardDropInfo } | undefined {
    for (const lane of this.lanes) {
      const target = lane.dropTargetAt(pointer.x, pointer.y);
      if (target === undefined) continue;

      const drop = {
        from: gesture.lane,
        fromIndex: gesture.index,
        to: lane,
        target,
        count: gesture.carried?.count ?? 1,
      };
      const info = this.handlers.describeDrop(drop);
      return info === undefined ? undefined : { drop, info };
    }
    return undefined;
  }

  /**
   * 同じ落とし先の上に指を止めて留まっている間、束の2枚目以降を1枚ずつ引き連れていく（レーンの端を
   * 押し続けて送るのと同じ速さ、holdRepeat）。**待ち時間は指が止まってから数える**——動いている間に
   * 時計を進めると、落とすつもりで空き枠を横切っただけでついてきてしまう（CARRY_REST_SLOP）。
   *
   * 落とし先が変わっても、**そこがそのまま受け取れるなら運んでいる枚数は保つ**。運んでいる枚数は
   * 「これだけ入る」という約束なので、守れなくなる枚数——新しい落とし先に入りきらないぶん——だけを
   * 返せばよい。ハンドレーンの隣の空き枠へずらしただけで数え直しになると、枚数が多いほど待たされる。
   *
   * 戻り値は運ぶ枚数が変わったかどうか。
   */
  private trackCarry(
    gesture: Gesture,
    found: { drop: CardDrop; info: CardDropInfo } | undefined,
    pointer: Phaser.Input.Pointer,
  ): boolean {
    const anchor = gesture.carryAnchor;
    const resting =
      anchor !== undefined &&
      Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y) <= this.metrics().px(CARRY_REST_SLOP);
    if (!resting) gesture.carryAnchor = { x: pointer.x, y: pointer.y };
    if (resting && sameTarget(gesture.carryTarget, found?.drop)) return false;

    gesture.carryTarget = found === undefined ? undefined : { to: found.drop.to, target: found.drop.target };
    const max = found?.info.maxCount ?? 1;
    const changed = gesture.carried?.keepAtMost(max) ?? false;
    gesture.carryHold?.stop();
    if ((gesture.carried?.count ?? max) < max) {
      gesture.carryHold?.start(() => this.carryOne(gesture, max));
    }
    return changed;
  }

  /** ついてくる札を1枚増やす。入る枚数まで数えたら止まる（それ以上はついてこない）。 */
  private carryOne(gesture: Gesture, max: number): boolean {
    gesture.carried?.addOne();
    if (gesture.pointer !== undefined) this.follow(gesture, gesture.pointer);
    return (gesture.carried?.count ?? max) < max;
  }

  /** ドロップの実行はカードを動かすので、その前にドラッグ中の表示物を片付けておく。 */
  private end(pointer: Phaser.Input.Pointer): void {
    const gesture = this.gesture;
    if (gesture === undefined) return;

    const found = gesture.kind === 'dragging' ? this.dropCandidateAt(gesture, pointer) : undefined;
    if (found === undefined || gesture.carried === undefined) {
      // 落とさなかったので、運んでいた札は元の枠へ飛んで帰る（帰り着いた時点で元の束に合流する）。
      if (gesture.kind === 'dragging') {
        noteOperation(`カードを離した: ${gesture.card.content.name}（落とし先なし）`);
      }
      gesture.carried?.flyBackToSource();
      gesture.carried = undefined;
      this.cancel();
    } else {
      // 落とした札は自由な札として離した場所に残り、行き先は世界の差し替えが決める（CardTable.freed）。
      const releasedRect = gesture.carried.rect;
      gesture.carried.release();
      this.cancel();
      this.handlers.onDrop(found.drop, releasedRect);
    }
  }

  private cancel(): void {
    const gesture = this.gesture;
    if (gesture === undefined) return;

    gesture.carryHold?.stop();
    gesture.carried?.mergeBackImmediately();
    gesture.indicator?.destroy();
    gesture.glowPulse?.remove();
    gesture.glow?.destroy();
    gesture.tooltip?.destroy();
    this.gesture = undefined;
  }
}

/** 前回と同じ落とし先か（どちらも「無し」なら同じ）。 */
function sameTarget(previous: CarryTarget | undefined, drop: CardDrop | undefined): boolean {
  if (previous === undefined || drop === undefined) return previous === undefined && drop === undefined;
  return (
    previous.to === drop.to &&
    previous.target.kind === drop.target.kind &&
    previous.target.index === drop.target.index
  );
}
