import type Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import type { CardContent } from './Card';
import { Card, cardFace, EDGE_REPEAT_MIN_MS } from './Card';
import type { CardLane, LaneUpdate, ReleasedCard } from './CardLane';
import type { LaneCell } from './laneCells';

/** カードが飛ぶ時間（ミリ秒）と加速の形。並びが詰め直される滑りより少しだけ長く取る。 */
const FLY_MS = 260;
const FLY_EASE = 'Quad.easeOut';

/** 出現元が分からないカードが、その場で現れる時間（ミリ秒）。 */
const FADE_MS = 200;

/**
 * 一度に複数生まれたとき、1枚目から順に飛び立たせる間隔（ミリ秒）。端を押し続けて送り続けるときの
 * 最短間隔と揃える——どちらも「カードが1枚ずつ出てくる」速さなので、違うと別の出来事に見える。
 */
const BIRTH_GAP_MS = EDGE_REPEAT_MIN_MS;

/**
 * 差し替えのきっかけ。どちらも「そのカードがどこから動き出すか」を決めるための情報。
 */
export interface MotionContext {
  /** 差し替え前に画面に無かったカード（探索・クラフトで生まれたもの）の出発点。 */
  readonly origin?: Rect;
  /**
   * 掴んで離したインスタンスと、手を離した時点の矩形。そのカードは元の枠ではなく、指を離した場所に
   * 居るため、そこから動き出す（そこに置いたままにする間の居場所でもある。hold参照）。
   */
  readonly released?: { readonly id: number; readonly rect: Rect };
}

/**
 * レーンの内容の差し替えを、カードの動きとして見せる。
 *
 * カードの同定はCardContent.identity（映しているインスタンスのID）で行う。差し替えの前後で
 * IDが1つでも重なるカード同士を同じカードとみなすので、レーン間の移動・スタックへの合流・
 * スタックの代表の入れ替わりを、いずれも「同じカードが動いた」として扱える。差し替え後に
 * どのカードのIDでもなくなったものが破棄、差し替え前のどのIDでもないものが新しく生まれたもの。
 *
 * カードゲームらしく、スタックへの合流は薄れさせずに「上に重ねて」見せる（send）。重なった
 * カードは着いた時点で捨てるが、その下には合流先のカードが既に居るので、見た目は札束が増えたまま残る。
 *
 * **飛ばすのは常に見た目だけの分身**で、レーンに並ぶカード自身は枠に居るまま伏せて待つ（send）。
 * 分身は最前面の層に置く——レーンからはみ出したカードは隣接エリアの背景板に隠れる設計
 * （CardLane参照）のため、レーンの中に置いたままでは境界をまたげない。
 *
 * **一度に複数生まれたぶんは、1枚ずつ間を置いて飛ばす**（BIRTH_GAP_MS）。何個採れたのかを目で
 * 数えられるようにするため。束ねて1枚に見えるものも中身の数だけ飛ぶ（bear）。出どころに積まれた
 * まま順に飛び立つ姿になる。
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

    const card = ownersOf(lanes).get(released.id)?.card;
    if (card === undefined) return;

    // 置きに行くのは1つだけなので、スタックは残りがそこに居る。枠から居なくなるのは1つしか
    // 映していないカードだけ。
    if ((card.content.count ?? 1) < 2) card.setVisible(false);
    const stand = this.standAt(card.content, released.rect);
    this.layer.add(stand);
    this.held = { id: released.id, card, stand };
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

  /**
   * 置いたままにしていた分身を、そのインスタンスの新しい居場所へ運ぶ。着いた時点で分身を捨て、
   * そこに居るカード（伏せていた本体・新しく現れたカード・合流先）を表に戻す。
   * インスタンスが失われていれば（使い切った・壊れた）その場で捨てる。
   */
  private landHeld(held: NonNullable<CardMotion['held']>, after: ReadonlyMap<number, Owner>): void {
    const owner = after.get(held.id);
    if (owner === undefined) {
      held.stand.destroy();
      reveal(held.card);
      return;
    }

    this.send(held.stand, owner.rect, owner.card);
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

    // 経過し切った差し替えなら、置いたままの分身がそのインスタンスを運ぶ。運ぶぶんは他の経路では
    // 動かさない（同じ移動を二重に見せないため）ので、以降はreleasedを渡さない。
    const landing = context.released === undefined ? undefined : this.takeHeld();
    const remaining = landing === undefined ? context : { ...context, released: undefined };

    const before = ownersOf(lanes);
    const released = releasedCard(before, remaining);
    const updates = lanes.map((lane, index) => lane.setCells(cells[index], released));
    const after = ownersOf(lanes);

    // 現れた側が飛ぶIDは、居なくなった側では改めて動かさない（同じ移動を二重に見せないため）。
    const entering = new Set(updates.flatMap((update) => update.entered).flatMap(({ card }) => idsOf(card)));

    // 生まれた順に飛び立たせるための順番取り。1つのupdateの中で通し番号になる。
    let born = 0;
    const birthDelay = (): number => born++ * BIRTH_GAP_MS;

    updates.forEach((update, index) => {
      for (const { card, index: slot } of arrivals(update)) {
        // 分身が運ぶ先のカードは、着くまで伏せたまま待たせる（landHeldが表に戻す）。
        if (landing !== undefined && idsOf(card).includes(landing.id)) continue;

        // 差し替え前に画面のどこにも無かったカード＝新しく生まれたもの。出どころはorigin。
        const to = lanes[index].slotRect(slot);
        const known = releasedRect(idsOf(card), remaining) ?? rectOf(before, idsOf(card));
        if (known === undefined && context.origin !== undefined) {
          this.bear(card, context.origin, to, birthDelay);
          continue;
        }
        this.fly(card, known, to, known === undefined ? birthDelay() : 0);
      }
    });

    this.moveInstances(lanes, updates, before, remaining, birthDelay);

    for (const { left } of updates) {
      for (const card of left) {
        const ids = idsOf(card);
        // 分身が運んでいる1枚は、運ばれる姿でもう見えている。
        const carried = card === landing?.card && ids.length === 1;
        if (carried || ids.some((id) => entering.has(id))) {
          card.destroy();
          continue;
        }
        this.dismiss(card, rectOf(before, ids), rectOf(after, ids));
      }
    }

    if (landing !== undefined) this.landHeld(landing, after);
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
   * カードそのものは動かない、インスタンス1つぶんの移動を見せる。
   *
   * 1枚のカードがスタック全体を映すため、居続けるカードの間でインスタンスが移った場合、どちらの
   * カードも残ってしまい右上の数字が変わるだけになる（スタックの1つを、同じものが既に居る場所へ
   * 移したとき）。発見済みのアイテムをもう一度発見したときも同じで、こちらは出どころがoriginになる。
   * どちらも、移った1つぶんの分身を飛ばして移動先へ重ねる。
   */
  private moveInstances(
    lanes: readonly CardLane[],
    updates: readonly LaneUpdate[],
    before: ReadonlyMap<number, Owner>,
    context: MotionContext,
    birthDelay: () => number,
  ): void {
    // カードごと出入りするぶんは、そのカード自身が飛ぶ（fly・dismiss）ので数えない。
    const arriving = new Set(updates.flatMap(arrivals).map(({ card }) => card));
    const left = new Set(updates.flatMap((update) => update.left));

    for (const lane of lanes) {
      lane.cardObjects.forEach((card, slot) => {
        if (card === undefined || arriving.has(card)) return;

        const to = lane.slotRect(slot);
        for (const from of arrivalsAt(card, before, left, context)) {
          // 既に居るカードへ合流する1つでも、originから来たなら新しく生まれたもの。
          const delay = from === context.origin ? birthDelay() : 0;
          this.send(this.standAt(card.content, from), to, undefined, delay);
        }
      });
    }
  }

  /**
   * 現れたカードをfromから来たものとして見せる。fromが無ければその場で浮かび上がらせる。
   * delayだけ待ってから動き出す（一度に複数生まれたときの順番、BIRTH_GAP_MS）。
   */
  private fly(card: Card, from: Rect | undefined, to: Rect, delay = 0): void {
    if (from === undefined) {
      card.setVisible(true);
      card.setAlpha(0);
      this.scene.tweens.add({ targets: card, alpha: 1, duration: FADE_MS, delay });
      return;
    }

    // 飛んでいる間は枠のカードを伏せる（新しく現れたカードは伏せて渡ってくるが、掴んで離したまま
    // レーンに残ったカードは見えている）。着いた時点でsendが表に戻す。
    card.setVisible(false);
    this.send(this.standAt(card.content, from), to, card, delay);
  }

  /**
   * 新しく生まれたカードを、束ねているインスタンスの数だけ1枚ずつ飛ばす。
   *
   * **3個まとめて採れたヤシの実は、1枚に束ねて見せていても3枚飛ぶ。** 何個採れたのかを、飛ぶ枚数で
   * 数えられるようにするため（分身は右上の数字を持たない、cardFace参照）。束のカードを表に戻すのは
   * 最後の1枚が着いたとき。
   */
  private bear(card: Card, from: Rect, to: Rect, birthDelay: () => number): void {
    card.setVisible(false);

    const count = Math.max(1, idsOf(card).length);
    for (let index = 0; index < count; index += 1) {
      const last = index === count - 1;
      this.send(this.standAt(card.content, from), to, last ? card : undefined, birthDelay());
    }
  }

  /**
   * 居なくなったカードを片付ける。同じインスタンスがまだ他のカードに映っているなら（スタックへの
   * 合流）そこへ重ね、どこにも無いなら（破棄）その場で消す。
   */
  private dismiss(card: Card, from: Rect | undefined, to: Rect | undefined): void {
    // 行き先が無い＝そのインスタンスが世界から消えた。カードもその場で消す（薄れさせると、掴んで
    // 離したカードが即座に消えるのと食い違って見える）。
    if (from === undefined || to === undefined) {
      card.destroy();
      return;
    }

    this.send(this.standAt(card.content, from), to);
    card.destroy();
  }

  /** 見た目だけの分身を、その場所に作る。 */
  private standAt(content: CardContent, at: Rect): Card {
    return new Card(this.scene, this.metrics, at.x, at.y, cardFace(content));
  }

  /**
   * 分身をtoへ飛ばす。着いた時点で分身を捨て、coveredを渡してあればそこで表に戻す。渡さなければ
   * 捨てるだけ——下には合流先のカードが既に居るため。
   *
   * 飛ばすのは必ず分身で、レーンに並んでいるカード自身ではない。カードの居場所を決めるのはレーンの
   * 側（枠の並び）で、そこから持ち出すと、レーンが並びを詰め直したときに枠と無関係な場所へ動く。
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

/** 1つのインスタンスを、今どのカードがどこで映しているか。 */
interface Owner {
  readonly card: Card;
  readonly rect: Rect;
}

/** レーンに並ぶカードが映しているインスタンスのIDから、そのカードと置き場所を引ける表。 */
function ownersOf(lanes: readonly CardLane[]): Map<number, Owner> {
  const owners = new Map<number, Owner>();
  for (const lane of lanes) {
    lane.cardObjects.forEach((card, index) => {
      const rect = lane.slotRect(index);
      if (card !== undefined) for (const id of idsOf(card)) owners.set(id, { card, rect });
    });
  }
  return owners;
}

/**
 * このカードが新しく受け取ったインスタンスの、それぞれの出どころ。
 *
 * 元のカードごと居なくなったぶんは、そのカード自身が飛ぶ（CardMotion.dismiss）ので含めない。
 * 差し替え前に画面のどこにも無かったインスタンス（探索・クラフトで生まれたもの）はoriginから来る。
 */
function arrivalsAt(
  card: Card,
  before: ReadonlyMap<number, Owner>,
  left: ReadonlySet<Card>,
  context: MotionContext,
): readonly Rect[] {
  return idsOf(card).flatMap((id) => {
    // 掴んで離したものは、指を離した場所から動き出す。元と同じカードへ戻る場合も同じで、これは
    // 差し替えの時点＝時間のかかるcombinationなら経過し切ってからになる（使い終わってから手元へ戻る）。
    if (id === context.released?.id) return [context.released.rect];

    const previous = before.get(id);
    if (previous === undefined) return context.origin === undefined ? [] : [context.origin];
    if (previous.card === card || left.has(previous.card)) return [];
    return [previous.rect];
  });
}

/**
 * そのレーンで、枠の外から所定の位置へ動かすカード。新しく現れたカードと、掴んで離したまま同じレーンに
 * 残ったカード（CardLane.LaneUpdate）。
 */
function arrivals(update: LaneUpdate): readonly { readonly card: Card; readonly index: number }[] {
  return update.returned === undefined ? update.entered : [...update.entered, update.returned];
}

/** 掴んで離したインスタンスを、差し替え前に映していたカード。 */
function releasedCard(before: ReadonlyMap<number, Owner>, context: MotionContext): ReleasedCard | undefined {
  const { released } = context;
  if (released === undefined) return undefined;

  const card = before.get(released.id)?.card;
  return card === undefined ? undefined : { card, id: released.id };
}

/** そのカードが、掴んで離したインスタンスを映しているなら、手を離した位置。 */
function releasedRect(ids: readonly number[], context: MotionContext): Rect | undefined {
  const { released } = context;
  return released !== undefined && ids.includes(released.id) ? released.rect : undefined;
}

/** 伏せていたカードを表に戻す（画面を作り直していれば既に破棄されている＝sceneがundefined）。 */
function reveal(card: Card): void {
  if (card.scene !== undefined) card.setVisible(true);
}

function idsOf(card: Card): readonly number[] {
  return card.content.identity ?? [];
}

function rectOf(owners: ReadonlyMap<number, Owner>, ids: readonly number[]): Rect | undefined {
  for (const id of ids) {
    const owner = owners.get(id);
    if (owner !== undefined) return owner.rect;
  }
  return undefined;
}
