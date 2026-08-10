import type Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import type { CardContent } from './Card';
import { Card, cardFace } from './Card';
import type { CardLane, LaneUpdate, ReleasedCard } from './CardLane';
import { FLY_EASE, FLY_MS } from './cardFlight';
import type { PlacedCard } from './cardMotionPlan';
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
  /** 差し替え前に画面に無かったカード（探索・クラフトで生まれたもの）の出発点。 */
  readonly origin?: Rect;
  /**
   * 掴んで離したインスタンスたち（先頭が掴んでいた1つで、続きはついてきたぶん）と、手を離した
   * 時点の矩形。いずれも元の枠ではなく指の下に居たため、そこから動き出す（先頭のインスタンスに
   * とっては、そこに置いたままにする間の居場所でもある。hold参照）。
   */
  readonly released?: { readonly ids: readonly number[]; readonly rect: Rect };
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
 * **飛ばすのは常に見た目だけの分身**で、レーンに並ぶカード自身は枠に居るまま伏せて待つ（send）。
 * 分身は最前面の層に置く——レーンからはみ出したカードは隣接エリアの背景板に隠れる設計
 * （CardLane参照）のため、レーンの中に置いたままでは境界をまたげない。
 */
export class CardMotion {
  private readonly scene: Phaser.Scene;
  private readonly metrics: ScreenMetrics;
  private readonly layer: Phaser.GameObjects.Container;

  /** 離した場所へ置いたままにしているもの（hold参照）。cardは分身の元になったレーンのカード。 */
  private held: { readonly id: number; readonly card: Card; readonly stand: Card } | undefined;

  /** 今飛んでいる分身（send参照）。着く前に次の差し替えが来たらsettleが始末する。 */
  private readonly flights: Flight[] = [];

  /**
   * 動いている分身は常に最前面へ出す。探索の子ウィンドウを開いたまま探索したときに、見つけたものが
   * ウィンドウの覆いに隠れてしまわないようにするため（他はすべて既定のdepth 0で描画順に従う）。
   */
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics) {
    this.scene = scene;
    this.metrics = metrics;
    this.layer = scene.add.container(0, 0).setDepth(1);
  }

  /**
   * 掴んで離したカードを、離した場所へ置いたままにする。時間のかかるcombinationでは経過を見せている
   * 間ずっとそこに在り、経過し切った差し替え（updateにreleasedが渡る）でそのインスタンスの居場所へ
   * 動く（ScreenLayout.md カードの移動アニメーション節）。
   */
  hold(lanes: readonly CardLane[], released: NonNullable<MotionContext['released']>): void {
    this.releaseHeld();

    // 立てる分身は1枚——掴んでいた先頭のインスタンスのもの。
    const [id] = released.ids;
    const card = placedCards(lanes).find(({ ids }) => ids.includes(id))?.card;
    if (card === undefined) return;

    // 置きに行くのは1つだけなので、スタックは残りがそこに居る。枠から居なくなるのは1つしか
    // 映していないカードだけ。
    if ((card.content.count ?? 1) < 2) card.setVisible(false);
    const stand = this.standAt(card.content, released.rect);
    this.layer.add(stand);
    this.held = { id, card, stand };
  }

  /**
   * 出している分身をすべて片付け、伏せていたカードを表に戻す。レーンを作り直すときは、本体ごと
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
    reveal(held.card);
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

    // 経過し切った差し替えなら、置いたままの分身がそのインスタンスを運ぶ。運ぶぶんは通常の便に
    // しない（同じ移動を二重に見せないため）ので、そのIDはreleasedではなくheldIdとして渡す。
    // ついてきて一緒に落とされた残りは、引き続き離した場所から動き出す。
    const landing = context.released === undefined ? undefined : this.takeHeld();
    const released = withoutId(context.released, landing?.id);

    const before = placedCards(lanes);
    // 「掴んで離したまま残ったカード」の扱いは、掴んでいた先頭のインスタンスだけのもの。
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
      origin: context.origin,
      released,
      heldId: landing?.id,
    });

    for (const card of plan.hidden) card.setVisible(false);
    for (const flight of plan.flights) {
      this.send(
        this.standAt(flight.face.content, flight.from),
        flight.to,
        flight.reveals,
        flight.delaySteps * GAP_MS,
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
    landing: { readonly to: Rect; readonly reveals: Card } | undefined,
  ): void {
    if (landing === undefined) {
      held.stand.destroy();
      reveal(held.card);
      return;
    }

    this.send(held.stand, landing.to, landing.reveals);
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
   * 分身をtoへ飛ばす。着いた時点で分身を捨て、coveredを渡してあればそこで表に戻す。渡さなければ
   * 捨てるだけ——下には合流先のカードが既に居るため。
   *
   * delayを渡すと、その間は出発点に置いたまま待つ。複数生まれたぶんは出どころに積まれて見え、
   * 順に飛び立っていく。
   */
  private send(stand: Card, to: Rect, covered?: Card, delay = 0): void {
    this.layer.add(stand);

    const flight: Flight = { stand, covered };
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

  /** 1つの飛びを終わらせる（分身を捨て、伏せて待たせていたカードを表に戻す）。 */
  private land(flight: Flight): void {
    const index = this.flights.indexOf(flight);
    if (index < 0) return;

    this.flights.splice(index, 1);
    flight.stand.destroy();
    if (flight.covered !== undefined) reveal(flight.covered);
  }

  /** 飛んでいる途中の分身を、その場で着かせる。 */
  private settle(): void {
    for (const flight of [...this.flights]) {
      this.scene.tweens.killTweensOf(flight.stand);
      this.land(flight);
    }
  }
}

/** 飛んでいる分身と、着いた時点で表に戻すカード（重ねるだけならundefined）。 */
interface Flight {
  readonly stand: Card;
  readonly covered: Card | undefined;
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

/** 掴んで離したインスタンス（先頭）を、差し替え前に映していたカード（CardLane.setCellsが別扱いする）。 */
function releasedCardOf(
  before: readonly PlacedCard<Card>[],
  released: MotionContext['released'],
): ReleasedCard | undefined {
  if (released === undefined) return undefined;

  const [id] = released.ids;
  const card = before.find(({ ids }) => ids.includes(id))?.card;
  return card === undefined ? undefined : { card, id };
}

/** releasedからそのIDを除いたもの（何も残らなければundefined）。 */
function withoutId(released: MotionContext['released'], id: number | undefined): MotionContext['released'] {
  if (released === undefined || id === undefined) return released;

  const ids = released.ids.filter((other) => other !== id);
  return ids.length === 0 ? undefined : { ids, rect: released.rect };
}

/** 伏せていたカードを表に戻す（画面を作り直していれば既に破棄されている＝sceneがundefined）。 */
function reveal(card: Card): void {
  if (card.scene !== undefined) card.setVisible(true);
}

function idsOf(card: Card): readonly number[] {
  return card.content.identity ?? [];
}
