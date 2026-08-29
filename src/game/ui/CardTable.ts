import type Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import type { CardContent } from './Card';
import { Card } from './Card';
import { cardFace } from './cardFace';
import type { CardLane } from './CardLane';
import { flightProgress } from '../looks/cardFlight';
import { SCREEN_DEPTH } from '../looks/screenDepth';
import { DustPuff } from './DustPuff';
import type { PlacedCard } from '../view/cardMotionPlan';
import { planMotion } from '../view/cardMotionPlan';
import { REPEAT_MIN_MS } from '../../ui/holdRepeat';
import type { LaneCell } from './laneCells';

/**
 * 1枚ずつ間を置いて飛び立つときの間隔（ミリ秒）。
 *
 * **「カードが1枚ずつ出てくる」速さは1つだけ**にする。カードの端を押し続けて送るのも、束をまとめて
 * 運ぶときに2枚目以降がついてくるのも、ここも同じ速さ——別々に持つと、片方だけ変えたときに別の
 * 出来事に見える。押し続けの繰り返し（holdRepeat）の最短間隔に、こちらから揃えに行く。
 */
const GAP_MS = REPEAT_MIN_MS;

/**
 * 差し替えのきっかけ。どちらも「そのカードがどこから動き出すか」を決めるための情報。
 */
export interface MotionContext {
  /**
   * 差し替え前に画面に無かったインスタンスの出発点を、そのインスタンスごとに持ったもの。
   *
   * **世界に起きた変化のログから引く**（changedInstances、HuntingSystem.md 6.2節）。ログが「この個体は
   * この札から来た」と言うので、UIはその札の矩形を引くだけになり、同じ差し替えで出どころの違う物が
   * 生まれてもそれぞれの出どころから飛べる。
   *
   * 一覧から作り始めた製作中オブジェクトだけは、出どころが世界ではなく画面の事実（閉じた一覧の中で
   * 選んだ札の位置）なので、UIが直に入れる。
   */
  readonly origins?: ReadonlyMap<number, Rect>;
  /**
   * 手から放したもの——掴んでいた1つ・待ってついてきたぶん・手を離した時点の矩形。いずれの
   * インスタンスも元の枠ではなく指の下に居たので、そこから動き出す。
   */
  readonly released?: {
    readonly grabbed: number;
    readonly followers: readonly number[];
    readonly rect: Rect;
  };
  /**
   * 世界から出たインスタンスと、世界に生まれたインスタンス（changedInstances）。砂埃を立てる場所を
   * 決めるのに使う（cardMotionPlan）。**画面の出入りでは代われない**——別のレーンへ移っただけの
   * カードも、レーンから見れば消えて現れるため。
   */
  readonly vanished?: readonly number[];
  readonly born?: readonly number[];
}

/** 飛んでいる途中の便を外から止める手立て（運んでいた札を掴み直したときなど）。 */
export interface FlightHandle {
  /** 便を打ち切り、札をその場で消す。 */
  cancel(): void;
}

/** レーン1本と、そこへ並べる枠。 */
export interface LaneView {
  readonly lane: CardLane;
  readonly cells: readonly LaneCell[];
}

/** 1つの便——目標へ向かっている実体の札。 */
interface Flight {
  readonly card: Card;
  ids: readonly number[];
  to: Rect;
  into: Card | undefined;
  onArrive: (() => void) | undefined;
  /** 発進位置と経過。目標が変わったら現在位置から測り直す。 */
  fromX: number;
  fromY: number;
  elapsed: number;
  /** 飛び立つまで出発点で待つ時間（進み具合の引き方はcardFlight）。 */
  delay: number;
  raisesDust: boolean;
}

/** レーンの枠に居ない自由な札（落とした札・時間のかかる操作の間そこに置いたままの札）。 */
interface FreedCard {
  readonly card: Card;
  ids: readonly number[];
  /** 経過を見せ切るまで発たない（時間のかかる操作の間、離した場所に置いたままにする）。 */
  waiting: boolean;
  /** 打ち切ったとき（実行しないと決めた操作）に、札を返す元の枠。 */
  readonly source: Card | undefined;
}

/**
 * 場に出ているカードの実体すべて（CardInteraction.md 6節 カードの移動アニメーション）。
 *
 * どの札がどこからどこへ飛ぶのかの解釈は計画（cardMotionPlan）が行う。このクラスは実体の札を
 * 所有し、レーンの枠に置き（CardLane.reconcile）、枠の外に在る間は自前の層（SCREEN_DEPTH.flyingCard）で
 * 目標へ向かわせる。
 *
 * **飛ぶのは常に実体の札そのもの**で、運んでいるインスタンス（ID）を載せている。枠の札は自分に
 * 在るIDの集合を知っていて（Card.setPresence）、枚数はそこからの導出値。便が着くとIDセットが
 * 合流する（Card.absorbReturnedIds）——分身と枚数の台帳は持たない。
 *
 * 飛んでいる途中に世界が変わったら、便は着かされるのではなく**向き直る**（plan.landings）。
 * 差し替えと便の開始に順序の契約は無い。
 *
 * 自前の層に置くのは、レーンからはみ出したカードは隣接エリアの背景板に隠れる設計
 * （CardLane参照）のため、レーンの中に置いたままでは境界をまたげないから。
 */
export class CardTable {
  private readonly scene: Phaser.Scene;
  private readonly metrics: ScreenMetrics;
  private readonly layer: Phaser.GameObjects.Container;
  private readonly dust: DustPuff;

  private readonly flights: Flight[] = [];
  private readonly freed: FreedCard[] = [];

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics) {
    this.scene = scene;
    this.metrics = metrics;
    this.layer = scene.add.container(0, 0).setDepth(SCREEN_DEPTH.flyingCard);
    this.dust = new DustPuff(scene);
    scene.events.on('update', this.step, this);
    scene.events.once('shutdown', () => scene.events.off('update', this.step, this));
  }

  /** 枠の外に出している札をすべて片付ける。画面を作り直すときは、レーンごと捨てられる前にここを通す。 */
  destroyLooseCards(): void {
    for (const flight of this.flights) flight.card.destroy();
    this.flights.length = 0;
    for (const freed of this.freed) freed.card.destroy();
    this.freed.length = 0;
  }

  /** 各レーンの内容を差し替え、出入りするカードを動かす。 */
  update(views: readonly LaneView[], context: MotionContext = {}): void {
    const before = placedCards(views.map(({ lane }) => lane));
    // 最初の1回（作り直した直後）だけは出どころが無いので、飛ばさずその場に出す。
    const firstShow = before.length === 0;

    // 宙に在る札はどの枠にも居ない。運んでいる最中のIDを、枠の枚数から引く。
    const aloft = [
      ...this.flights.flatMap((flight) => flight.ids),
      ...this.freed.flatMap((freed) => freed.ids),
    ];

    // 引き直すのはこの時点で既に飛んでいる便だけ。この差し替え自身が立てる便は、この計画が
    // 出発点も行き先も決めたばかりで、引き直す理由が無い（landingsにも載っていない）。
    const preexisting = [...this.flights];
    const arriving: PlacedCard<Card, Rect>[] = [];
    const left: { card: Card; ids: readonly number[] }[] = [];
    for (const { lane, cells } of views) {
      const update = lane.reconcile(cells, (content) => this.makeCard(content));
      for (const entered of update.entered) {
        arriving.push({
          card: entered.card,
          ids: entered.card.identity,
          rect: lane.cellRect(entered.index),
        });
      }
      for (const card of update.left) left.push({ card, ids: card.identity });
    }
    const arrivingCards = new Set(arriving.map(({ card }) => card));
    const staying = placedCards(views.map(({ lane }) => lane)).filter(({ card }) => !arrivingCards.has(card));

    const plan = planMotion({
      before,
      arriving,
      staying,
      left,
      origins: context.origins,
      released: releasedIdsOf(context.released),
      aloft,
      vanished: context.vanished,
      born: context.born,
    });

    for (const { card, present, emptied } of plan.shown) card.setPresence(present, emptied);
    for (const rect of plan.puffs) this.dust.burst(rect);
    for (const flight of plan.flights) {
      const card = new Card(this.scene, this.metrics, flight.from.x, flight.from.y, {
        ...cardFace(flight.into.content),
        identity: [flight.id],
      });
      this.layer.add(card);
      this.flights.push({
        card,
        ids: [flight.id],
        to: flight.to,
        into: flight.into,
        onArrive: undefined,
        fromX: flight.from.x,
        fromY: flight.from.y,
        elapsed: 0,
        delay: flight.delaySteps * GAP_MS,
        raisesDust: flight.raisesDust,
      });
    }
    for (const card of plan.fadeIns) card.appear(firstShow);
    for (const { card } of left) card.destroy();

    // 飛んでいる途中の便と置いてある札は、行き先を引き直す（世界が変わって帰り先も変わりうる）。
    this.retarget(preexisting, plan.landings, context);
  }

  /** 差し替えの結果に合わせて、宙に在る札の行き先を引き直す。 */
  private retarget(
    flights: readonly Flight[],
    landings: ReadonlyMap<number, { readonly to: Rect; readonly into: Card }>,
    context: MotionContext,
  ): void {
    for (const flight of flights) {
      if (!this.flights.includes(flight)) continue;
      // インスタンスを載せていない便（見た目だけの飛び）は、行き先が世界の並びと関わらない。
      if (flight.ids.length === 0) continue;

      const landing = landings.get(flight.ids[0]);
      if (landing === undefined) {
        // もう帰る枠が無い（世界から出たか、画面に出ない場所へ入った）。その場で消える。
        if (flight.ids.some((id) => context.vanished?.includes(id) === true)) {
          this.dust.burst(flight.card.rect);
        }
        this.abortFlight(flight);
        continue;
      }
      if (landing.to.x === flight.to.x && landing.to.y === flight.to.y && landing.into === flight.into) {
        continue;
      }
      // 向き直る。今の位置から新しい目標へ飛び直す（着かされはしない）。
      flight.to = landing.to;
      flight.into = landing.into;
      flight.fromX = flight.card.x;
      flight.fromY = flight.card.y;
      flight.elapsed = flight.delay;
    }

    for (const freed of [...this.freed]) {
      if (freed.waiting && context.released === undefined) continue;
      freed.waiting = false;

      const landing = freed.ids.map((id) => landings.get(id)).find((found) => found !== undefined);
      this.freed.splice(this.freed.indexOf(freed), 1);
      if (landing === undefined) {
        // 運んでいたインスタンスはもう世界に無い（使い切った・壊れた）か、画面の外へ入った。
        if (freed.ids.some((id) => context.vanished?.includes(id) === true)) {
          this.dust.burst(freed.card.rect);
        }
        freed.card.destroy();
        continue;
      }
      this.flights.push({
        card: freed.card,
        ids: freed.ids,
        to: landing.to,
        into: landing.into,
        onArrive: undefined,
        fromX: freed.card.x,
        fromY: freed.card.y,
        elapsed: 0,
        delay: 0,
        raisesDust: false,
      });
    }
  }

  /**
   * 落とした札を、経過を見せ切るまで離した場所に置いたままにする（時間のかかるcombination。
   * 使っている道具はそこに在る）。運ぶインスタンスはここで確定する（掴んだ時点の見込みと、実際に
   * 世界が動かす個体は違いうる——combinationは束の2つ目を使う）。
   */
  confirmHeldIds(released: NonNullable<MotionContext['released']>): void {
    const freed = this.freed.find((entry) => entry.waiting);
    if (freed === undefined) return;
    freed.ids = [released.grabbed, ...released.followers];
  }

  /** 置いたままの札を、飛ばさずに元の枠へ返す（実行しないと決めた操作の後始末）。 */
  settleFreed(): void {
    for (const freed of this.freed.splice(0)) {
      freed.source?.absorbReturnedIds(freed.ids);
      freed.card.destroy();
    }
  }

  /** 指が離した札を、枠の外の自由な札として引き取る（CarriedCard.release）。 */
  adoptFreed(card: Card, ids: readonly number[], source: Card | undefined): void {
    this.layer.add(card);
    this.freed.push({ card, ids, waiting: true, source });
  }

  /** 指が運ぶ札を作る（CardDragController）。 */
  grab(source: Card, home: () => Rect): CarriedCard {
    return new CarriedCard(this.scene, this.metrics, this, this.layer, source, home);
  }

  /**
   * 札を1枚、今いる場所から目標へ飛ばす（CarriedCard用）。**目標は毎フレーム引き直す**ので、
   * 指のように動き続ける先へも向かえる。着いたらonArriveを呼んで消える。
   *
   * **枠から枠への移動にこれを使ってはいけない。** レーンに並ぶ札の運びは、並びの差し替えが
   * そのまま見せる（update）。
   */
  flyTo(card: Card, target: () => Rect, onArrive: () => void): FlightHandle {
    this.layer.add(card);
    const flight: Flight & { tracked?: () => Rect } = {
      card,
      ids: [],
      to: target(),
      into: undefined,
      onArrive,
      fromX: card.x,
      fromY: card.y,
      elapsed: 0,
      delay: 0,
      raisesDust: false,
    };
    this.tracked.set(flight, target);
    this.flights.push(flight);
    return { cancel: () => this.abortFlight(flight) };
  }

  /** 目標が動き続ける便の、目標の引き直し先。 */
  private readonly tracked = new Map<Flight, () => Rect>();

  /** 便を打ち切って札を消す（着いた扱いにはしない）。 */
  private abortFlight(flight: Flight): void {
    const index = this.flights.indexOf(flight);
    if (index < 0) return;
    this.flights.splice(index, 1);
    this.tracked.delete(flight);
    flight.card.destroy();
  }

  /** 毎フレーム、飛んでいる札を目標へ進める。目標が動いていれば追いかける（指・スクロール中の枠）。 */
  private step(_time: number, delta: number): void {
    for (const flight of [...this.flights]) {
      const target = this.tracked.get(flight);
      if (target !== undefined) flight.to = target();

      flight.elapsed += delta;

      const progress = flightProgress(flight.elapsed, flight.delay);
      flight.card.setPosition(
        flight.fromX + (flight.to.x - flight.fromX) * progress,
        flight.fromY + (flight.to.y - flight.fromY) * progress,
      );
      if (progress >= 1) this.land(flight);
    }
  }

  /** 1つの便を終わらせる（着いた枠の札へ合流し、実体は行き先の札に引き継ぐ）。 */
  private land(flight: Flight): void {
    const index = this.flights.indexOf(flight);
    if (index < 0) return;

    this.flights.splice(index, 1);
    this.tracked.delete(flight);
    if (flight.raisesDust) this.dust.burst(flight.to);
    flight.into?.absorbReturnedIds(flight.ids);
    flight.onArrive?.();
    flight.card.destroy();
  }

  /** レーンの枠に置く札を作る（CardLane.reconcileから呼ばれる。置き場所はレーンが決める）。 */
  private makeCard(content: CardContent): Card {
    const card = new Card(this.scene, this.metrics, 0, 0, content);
    card.setVisible(false);
    return card;
  }
}

/**
 * 指が運んでいる札——実体のカードそのもの（CardInteraction.md 2節）。掴んだ時点で元の束から
 * 分かれ（元の札はそのぶん減って見える）、落とせば自由な札として置かれ、離せば元の枠へ帰って合流する。
 *
 * 束の2枚目以降は、元の枠から指へ飛んできて合流する（バッジの数字が増える）。重ねて見せる
 * ファン表示は持たない——何枚運んでいるかは数字が伝える。
 */
export class CarriedCard {
  private readonly scene: Phaser.Scene;
  private readonly metrics: ScreenMetrics;
  private readonly table: CardTable;
  private readonly source: Card;
  private readonly home: () => Rect;
  private readonly card: Card;

  /** 運んでいる個体（見込み。実際に世界が動かす個体はhold（落とした後）で確定する）。 */
  private ids: number[];
  /** 元の枠に残っている個体。 */
  private remainingIds: number[];
  /** まだ指へ向かって飛んでいる札の便。 */
  private readonly inbound: FlightHandle[] = [];
  private state: 'carrying' | 'released' | 'gone' = 'carrying';

  constructor(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    table: CardTable,
    layer: Phaser.GameObjects.Container,
    source: Card,
    home: () => Rect,
  ) {
    this.scene = scene;
    this.metrics = metrics;
    this.table = table;
    this.source = source;
    this.home = home;

    const present = source.presentIds;
    this.ids = present.slice(0, 1);
    this.remainingIds = present.slice(1);
    const at = home();
    this.card = new Card(scene, metrics, at.x, at.y, {
      ...cardFace(source.content),
      identity: this.ids,
      count: 1,
    });
    layer.add(this.card);
    // 手に取った1枚は、もう元の枠には居ない。全部持ち出しても、そこは帰ってくる枠なので印が残る。
    source.setPresence(this.remainingIds, true);
  }

  /** 運んでいる枚数（そのままCardDrop.countになる）。 */
  get count(): number {
    return this.ids.length;
  }

  /** 札が今いる矩形。ドロップの出発点とツールチップの位置決めに使う。 */
  get rect(): Rect {
    return this.card.rect;
  }

  /** 札をポインタの中心へ置く。 */
  follow(x: number, y: number): void {
    this.card.setPosition(x - this.card.cardWidth / 2, y - this.card.cardHeight / 2);
  }

  /** 1枚ついてくる。元の枠から指の下へ飛んできて合流する（数字が増える）。 */
  addOne(): void {
    const next = this.remainingIds.at(0);
    if (next === undefined) return;

    this.remainingIds = this.remainingIds.slice(1);
    this.ids = [...this.ids, next];
    this.source.setPresence(this.remainingIds, true);
    this.card.setContent({ ...this.card.content, identity: this.ids, count: this.ids.length });

    const from = this.home();
    const splinter = new Card(this.scene, this.metrics, from.x, from.y, {
      ...cardFace(this.source.content),
      count: 1,
    });
    const handle = this.table.flyTo(
      splinter,
      () => this.rect,
      () => {
        const at = this.inbound.indexOf(handle);
        if (at >= 0) this.inbound.splice(at, 1);
      },
    );
    this.inbound.push(handle);
  }

  /**
   * 運ぶ枚数をその数まで減らす（足りていれば何もしない）。あふれた札は元の枠へ飛んで帰る。
   * 戻り値は枚数が変わったかどうか。
   */
  keepAtMost(max: number): boolean {
    const keep = Math.max(1, max);
    if (this.ids.length <= keep) return false;

    const returned = this.ids.slice(keep);
    this.ids = this.ids.slice(0, keep);
    this.card.setContent({ ...this.card.content, identity: this.ids, count: this.ids.length });

    // あふれた分は、今いる場所から元の枠へ飛んで帰る（addOneの逆向き）。
    const at = this.rect;
    const spilled = new Card(this.scene, this.metrics, at.x, at.y, {
      ...cardFace(this.source.content),
      count: returned.length,
    });
    this.table.flyTo(spilled, this.home, () => this.source.absorbReturnedIds(returned));
    return true;
  }

  /** 落とさずに離した。札は元の枠へ飛んで帰り、着いた時点で合流して消える。 */
  flyBackToSource(): void {
    if (this.state !== 'carrying') return;
    this.state = 'gone';

    for (const handle of this.inbound.splice(0)) handle.cancel();
    const ids = this.ids;
    this.table.flyTo(
      this.card,
      () => this.home(),
      () => {
        this.source.absorbReturnedIds(ids);
        this.card.destroy();
      },
    );
  }

  /** 落とした。札は自由な札として離した場所に置かれ、行き先は世界の差し替えが決める（CardTable.freed）。 */
  release(): void {
    if (this.state !== 'carrying') return;
    this.state = 'released';

    for (const handle of this.inbound.splice(0)) handle.cancel();
    this.table.adoptFreed(this.card, this.ids, this.source);
  }

  /** その場で解散する（画面の作り直しで続けられない）。表示物を片付け、元の束の見え方を掴む前へ戻す。 */
  mergeBackImmediately(): void {
    if (this.state !== 'carrying') return;
    this.state = 'gone';

    for (const handle of this.inbound.splice(0)) handle.cancel();
    this.source.absorbReturnedIds(this.ids);
    this.card.destroy();
  }
}

/** レーンに並んでいるカードを、位置とインスタンスのID付きで挙げる（計画の入力）。 */
function placedCards(lanes: readonly CardLane[]): PlacedCard<Card, Rect>[] {
  return lanes.flatMap((lane) =>
    lane.placements.map(({ card, rect }) => ({ card, ids: card.identity, rect })),
  );
}

/** 手から放したインスタンス全部を、計画のreleased（離した場所から動き出すもの）に直す。 */
function releasedIdsOf(
  released: MotionContext['released'],
): { readonly ids: readonly number[]; readonly rect: Rect } | undefined {
  return released === undefined
    ? undefined
    : { ids: [released.grabbed, ...released.followers], rect: released.rect };
}
