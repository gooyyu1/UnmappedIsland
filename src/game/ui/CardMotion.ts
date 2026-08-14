import type Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import type { CardContent } from './Card';
import { Card, cardFace } from './Card';
import type { CardLane, LaneUpdate, ReleasedCard } from './CardLane';
import { FLY_EASE, FLY_MS } from './cardFlight';
import { DustPuff } from './DustPuff';
import type { PlacedCard, ShownCard } from './cardMotionPlan';
import { planMotion } from './cardMotionPlan';
import { REPEAT_MIN_MS } from './holdRepeat';
import type { LaneCell } from './laneCells';

/** 出現元が分からないカードが、その場で現れる時間（ミリ秒）。 */
const FADE_MS = 200;

/**
 * 1枚ずつ間を置いて飛び立つときの間隔（ミリ秒）。押し続けて送り続けるときの最短間隔と揃える
 * （holdRepeat参照）。
 */
const GAP_MS = REPEAT_MIN_MS;

/**
 * 差し替えのきっかけ。どちらも「そのカードがどこから動き出すか」を決めるための情報。
 */
export interface MotionContext {
  /**
   * 差し替え前に画面に無かったインスタンスの出発点を、そのインスタンスごとに持ったもの。
   *
   * **世界に起きた変化のログから引く**（motionOrigins、HuntingSystem.md 6.2節）。ログが「この個体は
   * この札から来た」と言うので、UIはその札の矩形を引くだけになり、同じ差し替えで出どころの違う物が
   * 生まれてもそれぞれの出どころから飛べる。
   *
   * 一覧から作り始めた製作中オブジェクトだけは、出どころが世界ではなく画面の事実（閉じた一覧の中で
   * 選んだ札の位置）なので、UIが直に入れる。
   */
  readonly origins?: ReadonlyMap<number, Rect>;
  /**
   * 手から放したもの——掴んでいた1つ・待ってついてきたぶん・手を離した時点の矩形。いずれの
   * インスタンスも元の枠ではなく指の下に居たので、そこから動き出す。grabbedにとっては、
   * そこに置いたままにする間の居場所でもある（hold参照）。
   */
  readonly released?: {
    readonly grabbed: number;
    readonly followers: readonly number[];
    readonly rect: Rect;
  };
  /**
   * 世界から出たインスタンスと、世界に生まれたインスタンス（motionOrigins）。砂埃を立てる場所を
   * 決めるのに使う（cardMotionPlan）。**画面の出入りでは代われない**——別のレーンへ移っただけの
   * カードも、レーンから見れば消えて現れるため。
   */
  readonly vanished?: readonly number[];
  readonly born?: readonly number[];
}

/**
 * レーンの内容の差し替えを、カードの動きとして見せる。
 *
 * どの札がどこからどこへ飛ぶのかの解釈は計画（cardMotionPlan）が行う。このクラスが扱うのは
 * **レーンの並びから外れて宙に在る札**だけ——飛んでいる分身と、離した場所へ置いたままの分身
 * （hold）。カードの同定はインスタンスのID（CardContent.identity）で行う。
 *
 * カードゲームらしく、スタックへの合流は薄れさせずに「上に重ねて」見せる。重なった分身は着いた
 * 時点で捨てるが、その下には合流先のカードが既に居るので、見た目は札束が増えたまま残る。
 *
 * **飛ばすのは常に見た目だけの分身**で、レーンに並ぶカード自身は枠に居たまま待つ。宙に在る札は
 * まだその枠に居ないので、枠はそのぶんを引いた枚数で待ち（show）、1枚着くごとに1つ増える（arrive）。
 * 分身は最前面の層に置く——レーンからはみ出したカードは隣接エリアの背景板に隠れる設計
 * （CardLane参照）のため、レーンの中に置いたままでは境界をまたげない。
 *
 * 世界の出入り（MotionContext.vanished / born）には砂埃が立つ（DustPuff）。消えた札はその場で、
 * 生まれた札は飛んで着いた場所で立つ。
 */
export class CardMotion {
  private readonly scene: Phaser.Scene;
  private readonly metrics: ScreenMetrics;
  private readonly layer: Phaser.GameObjects.Container;

  /** 離した場所へ置いたままにしているもの（hold参照）。cardは分身の元になったレーンのカード。 */
  private held: { readonly id: number; readonly card: Card; readonly stand: Card } | undefined;

  /** 今飛んでいる分身（send参照）。着く前に次の差し替えが来たらsettleが始末する。 */
  private readonly flights: Flight[] = [];

  /** 各札に今いくつ在ると言ったか（show参照）。着いた分身を1枚ずつ足し戻すために控える。 */
  private readonly shown = new Map<Card, ShownCard<Card>>();

  /** 生まれた・壊れた札の居場所へ立てる砂埃。 */
  private readonly dust: DustPuff;

  /**
   * 動いている分身は常に最前面へ出す。探索の子ウィンドウを開いたまま探索したときに、見つけたものが
   * ウィンドウの覆いに隠れてしまわないようにするため（他はすべて既定のdepth 0で描画順に従う）。
   */
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics) {
    this.scene = scene;
    this.metrics = metrics;
    this.layer = scene.add.container(0, 0).setDepth(1);
    this.dust = new DustPuff(scene);
  }

  /**
   * 掴んで離したカードを、離した場所へ置いたままにする。時間のかかるcombinationでは経過を見せている
   * 間ずっとそこに在り、経過し切った差し替え（updateにreleasedが渡る）でそのインスタンスの居場所へ
   * 動く（CardInteraction.md 6節 カードの移動アニメーション）。
   */
  hold(lanes: readonly CardLane[], released: NonNullable<MotionContext['released']>): void {
    this.releaseHeld();

    // 立てる分身は1枚——掴んでいた1つのもの。ついてきたぶんは分身を持たない（landHeld参照）。
    const id = released.grabbed;
    const card = placedCards(lanes).find(({ ids }) => ids.includes(id))?.card;
    if (card === undefined) return;

    const stand = this.standAt(card.content, released.rect);
    this.layer.add(stand);
    this.held = { id, card, stand };
    // 手に取った1枚は、もう元の枠には居ない。掴んで運んでいる間の見え方（CarriedCards）が
    // そのまま続くので、離した瞬間に枚数は変わらない。
    this.show(card, this.remainingOf(card) - 1, true);
  }

  /**
   * 出している分身をすべて片付け、待たせていたカードを元の姿へ戻す。レーンを作り直すときは、本体ごと
   * 捨てられる前にここを通す。
   */
  release(): void {
    this.settle();
    this.releaseHeld();
  }

  /** 置いたままにしていた分身を、動かさずに本体へ返す。 */
  private releaseHeld(): void {
    const held = this.held;
    if (held === undefined) return;

    this.held = undefined;
    held.stand.destroy();
    this.arrive(held.card);
  }

  /**
   * その札の枠に今いくつ在るかを言い、言った内容を控える（Card.setRemaining）。控えを持つのは、
   * 分身が着くたびに1枚ずつ足し戻すため（arrive）。
   */
  private show(card: Card, remaining: number, emptied: boolean): void {
    this.shown.set(card, { card, remaining, emptied });
    // 画面を作り直していれば、カードは既に破棄されている。
    if (card.scene !== undefined) card.setRemaining(remaining, emptied);
  }

  /** 宙に在った1枚がその枠に着いた（分身が飛び着いた、または置いたままの分身が本体へ返った）。 */
  private arrive(card: Card): void {
    const shown = this.shown.get(card);
    if (shown !== undefined) this.show(card, shown.remaining + 1, shown.emptied);
  }

  /** その札の枠に今いくつ在るか（まだ何も引いていなければ、映しているインスタンスの数）。 */
  private remainingOf(card: Card): number {
    return this.shown.get(card)?.remaining ?? card.content.count ?? 1;
  }

  /** 各レーンの内容を差し替え、出入りするカードを動かす。lanesとcellsは同じ順に対応する。 */
  update(
    lanes: readonly CardLane[],
    cells: readonly (readonly LaneCell[])[],
    context: MotionContext = {},
  ): void {
    // まだ飛んでいる分身はここで着かせる。行き先は飛び始めた時点の枠なので、これから並びが変わる
    // 差し替えを跨がせると、カードの居なくなった枠へ着いて、そこでカードを表に戻すことになる。
    this.settle();

    // 置いたままの分身が運んでいる1枚は、着くまでどの枠にも居ない（heldId）。計画はそのIDを通常の
    // 便にしない（planArrivalsTo）ので、releasedはそのまま全部渡してよい。着地させるのは経過し切った
    // 差し替え（releasedが渡る）だけで、それまでは置いたまま待たせる。
    const heldId = this.held?.id;
    const landing = context.released === undefined ? undefined : this.takeHeld();

    const before = placedCards(lanes);
    // 「掴んで離したまま残ったカード」の扱い（滑らせずに置く）は、分身が運んで戻る場合には要らない。
    const releasedCard = landing === undefined ? releasedCardOf(before, context.released) : undefined;
    const updates = lanes.map((lane, index) => lane.setCells(cells[index], releasedCard));

    const arriving: PlacedCard<Card>[] = [];
    updates.forEach((update, index) => {
      for (const { card, index: slot } of arrivals(update)) {
        arriving.push({ card, ids: idsOf(card), rect: lanes[index].slotRect(slot) });
      }
    });
    const arrivingCards = new Set(arriving.map(({ card }) => card));
    const staying = placedCards(lanes).filter(({ card }) => !arrivingCards.has(card));
    const left = updates.flatMap((update) => update.left).map((card) => ({ card, ids: idsOf(card) }));

    const plan = planMotion({
      before,
      arriving,
      staying,
      left,
      origins: context.origins,
      released: releasedIdsOf(context.released),
      heldId,
      vanished: context.vanished,
      born: context.born,
    });

    // 控えは差し替えのたびに捨てて引き直す。飛んでいた分身はsettleで着かせた後なので、まだ宙に
    // 在るのは計画が数えたぶんだけになる。
    this.shown.clear();
    for (const { card, remaining, emptied } of plan.shown) this.show(card, remaining, emptied);
    for (const rect of plan.puffs) this.dust.burst(rect);
    for (const flight of plan.flights) {
      this.send(
        this.standAt(flight.face.content, flight.from),
        flight.to,
        flight.into,
        flight.delaySteps * GAP_MS,
        flight.puffs,
      );
    }
    for (const card of plan.fadeIns) this.fadeIn(card);
    for (const card of plan.discards) card.destroy();

    if (landing !== undefined) this.landHeld(landing, plan.landing);
    // 置いている途中でそのカードが失われたら（経過中に壊れた道具等）、立てていた分身も片付ける。
    if (this.held !== undefined && this.held.card.scene === undefined) this.releaseHeld();
  }

  /** 置いたままにしていたものを、片付けずに取り出す（運び先が決まってから始末するため）。 */
  private takeHeld(): NonNullable<CardMotion['held']> | undefined {
    const held = this.held;
    this.held = undefined;
    return held;
  }

  /**
   * 置いたままにしていた分身を、そのインスタンスの新しい居場所へ運ぶ。インスタンスが失われて
   * いれば（使い切った・壊れた）その場で捨てる。
   */
  private landHeld(
    held: NonNullable<CardMotion['held']>,
    landing: { readonly to: Rect; readonly into: Card } | undefined,
  ): void {
    if (landing === undefined) {
      // 運んでいたインスタンスはもう世界に無い（使い切った・壊れた）。どの枠にも着かないので、
      // 分身を捨てるだけ——元の枠の枚数は、それを引いた値で既に貼り直されている（plan.shown）。
      held.stand.destroy();
      return;
    }

    this.send(held.stand, landing.to, landing.into);
  }

  /** 出どころの無いカードを、その場で浮かび上がらせる。 */
  private fadeIn(card: Card): void {
    card.setVisible(true);
    card.setAlpha(0);
    this.scene.tweens.add({ targets: card, alpha: 1, duration: FADE_MS });
  }

  /** 見た目だけの分身を、その場所に作る。 */
  private standAt(content: CardContent, at: Rect): Card {
    return new Card(this.scene, this.metrics, at.x, at.y, cardFace(content));
  }

  /**
   * 分身をtoへ飛ばす。着いた時点で分身を捨て、運んでいた1枚がintoの枠に居るようになる（arrive）。
   *
   * delayを渡すと、その間は出発点に置いたまま待つ。複数生まれたぶんは出どころに積まれて見え、
   * 順に飛び立っていく。
   *
   * puffsを立てると、着いた場所で砂埃が立つ（生まれたものを運ぶ便）。
   */
  private send(stand: Card, to: Rect, into: Card, delay = 0, puffs = false): void {
    this.layer.add(stand);

    const flight: Flight = { stand, into, puffs: puffs ? to : undefined };
    this.flights.push(flight);
    this.scene.tweens.add({
      targets: stand,
      x: to.x,
      y: to.y,
      duration: FLY_MS,
      delay,
      ease: FLY_EASE,
      onComplete: () => this.land(flight),
    });
  }

  /** 1つの飛びを終わらせる（分身を捨て、運んでいた1枚を行き先の枠へ足す）。 */
  private land(flight: Flight): void {
    const index = this.flights.indexOf(flight);
    if (index < 0) return;

    this.flights.splice(index, 1);
    flight.stand.destroy();
    if (flight.puffs !== undefined) this.dust.burst(flight.puffs);
    this.arrive(flight.into);
  }

  /** 飛んでいる途中の分身を、その場で着かせる。 */
  private settle(): void {
    for (const flight of [...this.flights]) {
      this.scene.tweens.killTweensOf(flight.stand);
      this.land(flight);
    }
  }
}

/** 飛んでいる分身と、それが運んでいる1枚の行き先の札。 */
interface Flight {
  readonly stand: Card;
  readonly into: Card;
  /** 着いた時点で砂埃を立てる枠（立てないならundefined）。 */
  readonly puffs: Rect | undefined;
}

/** レーンに並んでいるカードを、位置とインスタンスのID付きで挙げる（計画の入力）。 */
function placedCards(lanes: readonly CardLane[]): PlacedCard<Card>[] {
  const placed: PlacedCard<Card>[] = [];
  for (const lane of lanes) {
    lane.cardObjects.forEach((card, index) => {
      if (card !== undefined) placed.push({ card, ids: idsOf(card), rect: lane.slotRect(index) });
    });
  }
  return placed;
}

/**
 * そのレーンで、枠の外から所定の位置へ動かすカード。新しく現れたカードと、掴んで離したまま同じレーンに
 * 残ったカード（CardLane.LaneUpdate）。
 */
function arrivals(update: LaneUpdate): readonly { readonly card: Card; readonly index: number }[] {
  return update.returned === undefined ? update.entered : [...update.entered, update.returned];
}

/** 掴んでいたインスタンスを、差し替え前に映していたカード（CardLane.setCellsが別扱いする）。 */
function releasedCardOf(
  before: readonly PlacedCard<Card>[],
  released: MotionContext['released'],
): ReleasedCard | undefined {
  if (released === undefined) return undefined;

  const card = before.find(({ ids }) => ids.includes(released.grabbed))?.card;
  return card === undefined ? undefined : { card, id: released.grabbed };
}

/** 手から放したインスタンス全部を、計画のreleased（離した場所から動き出すもの）に直す。 */
function releasedIdsOf(
  released: MotionContext['released'],
): { readonly ids: readonly number[]; readonly rect: Rect } | undefined {
  return released === undefined
    ? undefined
    : { ids: [released.grabbed, ...released.followers], rect: released.rect };
}

function idsOf(card: Card): readonly number[] {
  return card.content.identity ?? [];
}
