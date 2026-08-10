import type Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import type { CardContent } from './Card';
import { Card, cardFace } from './Card';
import type { CardLane, LaneDropTarget } from './CardLane';
import { FLY_EASE, FLY_MS } from './cardFlight';
import { HoldRepeat } from './holdRepeat';
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

/**
 * 束を丸ごと持ち出して場所が空いた、元のカードの濃さ（showStack参照）。掴んでいるカード自身も、
 * まだ束が残っている元のカードも不透明のまま——札が透けるのはカードゲームらしくないため。
 */
const EMPTIED_ALPHA = 0.3;

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

/**
 * まとめて運ぶとき、指の下の分身の後ろへ重ねて見せる枚数の上限と、1枚ごとのずらし幅（u単位）。
 * 何枚運んでいるかは右上の数字が正確に伝えるので、後ろの札は「1枚ではない」と分かれば足りる。
 */
const CARRY_PILE_MAX = 4;
const CARRY_PILE_OFFSET = 14;

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
  /** releasedは手を離した時点で分身が居た矩形。落とした後の動きの出発点になる（CardMotion参照）。 */
  readonly onDrop: (drop: CardDrop, released: Rect) => void;
}

/** 押してから離すまでの1回の操作。カードのドラッグとレーンのスクロールのどちらになるかは押した後に決まる。 */
interface Gesture {
  readonly lane: CardLane;
  readonly index: number;
  readonly card: Card;
  /** 掴んだカードの見た目だけを写したもの。分身も、ついてくる札も、これで作る。 */
  readonly face: CardContent;
  /** 掴んだ時点で元の束が映していた枚数。ついてきたぶんを引いて見せる（showCarried参照）。 */
  readonly sourceCount: number;
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
  /** 最後に指が居た場所。ついてくる枚数が増えたときに、そこから表示を作り直す。 */
  pointer: Phaser.Input.Pointer | undefined;
  /** 今まとめて運んでいる枚数と、その落とし先が受け取れる最大枚数（trackCarry参照）。 */
  carried: number;
  carryMax: number;
  /** 枚数を数え続けている落とし先（変われば1枚に戻す）と、数える時計。 */
  carryKey: string | undefined;
  carryHold: HoldRepeat | undefined;
  /** 分身の後ろへ重ねる札（分身より奥に置くため、先に作った器へ入れる）。 */
  pile: Phaser.GameObjects.Container | undefined;
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
 *
 * **落とし先の上で待つと、同じ束の2枚目以降がついてくる**（trackCarry）。離せばついてきたぶんが
 * 一度に入る。ついてくるのは入る枚数までで、ついてきた枚数はそのまま「これだけ入る」という約束になる。
 *
 * ついてくる札は元の枠から飛んでくる（carryIn）。落とさずに離した・ついてこなくなったぶんは、同じ
 * 道を元の枠へ返る（returnAll・returnCarried）。指の下に出ている札は必ずどこかから来てどこかへ帰る。
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
    const card = object as Card;
    lane.beginScroll();

    const gesture: Gesture = {
      lane,
      index,
      card,
      face: cardFace(card.content),
      sourceCount: card.content.count ?? 1,
      startX: pointer.x,
      startY: pointer.y,
      kind: 'pending',
      longPress: undefined,
      ghost: undefined,
      indicator: undefined,
      glow: undefined,
      glowPulse: undefined,
      tooltip: undefined,
      pointer: undefined,
      carried: 1,
      carryMax: 1,
      carryKey: undefined,
      carryHold: undefined,
      pile: undefined,
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
    // ついてきた札は分身のさらに奥なので、器を先に作っておく。
    this.showAcceptingCards(gesture);
    gesture.indicator = this.scene.add.graphics();
    gesture.pile = this.scene.add.container(0, 0);
    gesture.ghost = new Card(this.scene, this.metrics(), 0, 0, gesture.face);
    gesture.tooltip = new Tooltip(this.scene, this.metrics());
    gesture.carryHold = new HoldRepeat(this.scene);
    // 1枚しか映していないカードを掴んだ時点で、その場所はもう空（showStack）。
    this.showCarried(gesture);
    this.follow(pointer);
  }

  /** 今掴んでいるカードを受け入れられるカードすべてのふちを光らせる。 */
  private showAcceptingCards(gesture: Gesture): void {
    const glow = this.scene.add.graphics();
    gesture.glow = glow;

    for (const lane of this.lanes) {
      lane.cardObjects.forEach((card, index) => {
        if (card === undefined) return;
        const drop = {
          from: gesture.lane,
          fromIndex: gesture.index,
          to: lane,
          target: cardTarget(index),
          count: 1,
        };
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

    gesture.pointer = pointer;
    gesture.ghost.setPosition(
      pointer.x - gesture.ghost.cardWidth / 2,
      pointer.y - gesture.ghost.cardHeight / 2,
    );
    gesture.pile?.setPosition(gesture.ghost.x, gesture.ghost.y);

    gesture.indicator.clear();
    let found = this.dropAt(gesture, pointer);
    // 数え直したなら運ぶ枚数が変わったので、そのドロップが何をするのかも引き直す。
    if (this.trackCarry(gesture, found)) found = this.dropAt(gesture, pointer);
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

      const drop = {
        from: gesture.lane,
        fromIndex: gesture.index,
        to: lane,
        target,
        count: gesture.carried,
      };
      const info = this.handlers.describeDrop(drop);
      return info === undefined ? undefined : { drop, info };
    }
    return undefined;
  }

  /**
   * 同じ落とし先の上に留まっている間、束の2枚目以降を1枚ずつ引き連れていく（レーンの端を押し続けて
   * 送るのと同じ速さ、holdRepeat）。落とし先が変われば1枚に戻して数え直す。
   *
   * 戻り値は数え直したかどうか（＝運ぶ枚数が変わったか）。
   */
  private trackCarry(gesture: Gesture, found: { drop: CardDrop; info: CardDropInfo } | undefined): boolean {
    const key =
      found === undefined
        ? undefined
        : `${this.lanes.indexOf(found.drop.to)}:${found.drop.target.kind}:${found.drop.target.index}`;
    if (key === gesture.carryKey) return false;

    gesture.carryKey = key;
    gesture.carryMax = found?.info.maxCount ?? 1;
    const changed = gesture.carried !== 1;
    gesture.carried = 1;
    gesture.carryHold?.stop();
    // 数え直しでついてこなくなったぶんは、元の枠へ返る。
    if (changed) this.returnCarried(gesture);
    if (gesture.carryMax > 1) gesture.carryHold?.start(() => this.carryOne(gesture));
    this.showCarried(gesture);
    return changed;
  }

  /** ついてくる札を1枚増やす。入る枚数まで数えたら止まる（それ以上はついてこない）。 */
  private carryOne(gesture: Gesture): boolean {
    gesture.carried += 1;
    this.showCarried(gesture);
    this.carryIn(gesture);
    if (gesture.pointer !== undefined) this.follow(gesture.pointer);
    return gesture.carried < gesture.carryMax;
  }

  /**
   * 運んでいる枚数を、分身の右上の数字と、元の束の見え方で見せる。**ついてきたぶんは元の束から
   * 抜けて見える**（掴んだ1枚ぶんは元のカードが場所に残ったまま——ScreenLayout.md ドラッグ＆ドロップ節）。
   */
  private showCarried(gesture: Gesture): void {
    gesture.ghost?.setContent({ ...gesture.face, count: gesture.carried });
    // 束を丸ごと運び出していれば、元の場所はもう空。
    showStack(
      gesture.card,
      gesture.sourceCount - (gesture.carried - 1),
      gesture.carried >= gesture.sourceCount,
    );
  }

  /**
   * 増えた1枚を、元の枠から指の下へ飛ばして重ねる。重ねて見せるのはCARRY_PILE_MAX枚までで、それを
   * 超えたぶんは着いた時点で捨てる——同じ場所には既に札が居るので、束の厚みは変わらない。
   */
  private carryIn(gesture: Gesture): void {
    const { pile } = gesture;
    if (pile === undefined) return;

    const from = gesture.lane.slotRect(gesture.index);
    const card = new Card(this.scene, this.metrics(), from.x - pile.x, from.y - pile.y, gesture.face);
    // 器の並び順がそのまま重なりの順。後から来た札ほど奥へ入れる。
    pile.addAt(card, 0);

    const depth = Math.min(gesture.carried - 1, CARRY_PILE_MAX);
    const rest = -this.metrics().px(CARRY_PILE_OFFSET) * depth;
    const merges = gesture.carried - 1 > CARRY_PILE_MAX;
    this.scene.tweens.add({
      targets: card,
      x: rest,
      y: rest,
      duration: FLY_MS,
      ease: FLY_EASE,
      onComplete: () => {
        if (merges) card.destroy();
      },
    });
  }

  /**
   * ついてきた札を元の枠へ飛ばして返す。着いた時点で捨てる——そこには元の束が居るので、束は戻った
   * ままに見える。器は指について行くので、指を動かしながら返せば帰り道もそのぶん引かれる。
   */
  private returnCarried(gesture: Gesture): void {
    const { pile } = gesture;
    if (pile === undefined) return;

    const to = gesture.lane.slotRect(gesture.index);
    for (const card of [...pile.list]) {
      this.scene.tweens.killTweensOf(card);
      this.scene.tweens.add({
        targets: card,
        x: to.x - pile.x,
        y: to.y - pile.y,
        duration: FLY_MS,
        ease: FLY_EASE,
        onComplete: () => card.destroy(),
      });
    }
  }

  /**
   * 落とさずに離したときは、指の下に出ていた札がすべて元の枠へ飛んで返る。返し終わるまで生かして
   * おく必要があるので、ジェスチャからは取り上げておく（cancelが捨ててしまわないように）。
   */
  private returnAll(gesture: Gesture): void {
    const { ghost, pile } = gesture;
    if (ghost === undefined) return;

    this.returnCarried(gesture);
    gesture.ghost = undefined;
    gesture.pile = undefined;

    const to = gesture.lane.slotRect(gesture.index);
    this.scene.tweens.add({
      targets: ghost,
      x: to.x,
      y: to.y,
      duration: FLY_MS,
      ease: FLY_EASE,
      onComplete: () => {
        ghost.destroy();
        pile?.destroy();
      },
    });
  }

  /** ドロップの実行はカードを動かすので、その前にドラッグ中の表示物を片付けておく。 */
  private end(pointer: Phaser.Input.Pointer): void {
    const gesture = this.gesture;
    if (gesture === undefined) return;

    const found = gesture.kind === 'dragging' ? this.dropAt(gesture, pointer) : undefined;
    // 分身はcancelで消えるので、その居場所を先に控える。落としたカードはここから動き出す。
    const released = ghostRect(gesture);
    if (found === undefined || released === undefined) {
      this.returnAll(gesture);
      this.cancel();
      return;
    }

    this.cancel();
    this.handlers.onDrop(found.drop, released);
  }

  private cancel(): void {
    const gesture = this.gesture;
    if (gesture === undefined) return;

    gesture.longPress?.remove();
    gesture.carryHold?.stop();
    // 減らして見せていた元の束を戻す。返す札が飛んでいる間も、数はここで戻る（飛んでいるのは
    // もう束に在るものの姿で、着けば重なって消える）。
    showStack(gesture.card, gesture.sourceCount, false);
    gesture.pile?.destroy();
    gesture.ghost?.destroy();
    gesture.indicator?.destroy();
    gesture.glowPulse?.remove();
    gesture.glow?.destroy();
    gesture.tooltip?.destroy();
    this.gesture = undefined;
  }
}

/**
 * 掴んでいる間の、元のカードの見え方（残って見える枚数と濃さ）。画面を作り直していれば、そのカードは
 * もう無い。
 *
 * **薄くするのは場所ごと空くときだけ。** 束が残っているうちは、そこに在るのはまだ本物の札なので
 * そのままの濃さで残す。丸ごと運び出したときだけ、残るのは「返ってくる場所」を示す姿になる。
 */
function showStack(card: Card, count: number, emptied: boolean): void {
  if (card.scene === undefined) return;

  if ((card.content.count ?? 1) !== count) card.setContent({ ...card.content, count });
  card.setAlpha(emptied ? EMPTIED_ALPHA : 1);
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
