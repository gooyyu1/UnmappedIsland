import type Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import { Card, cardFace } from './Card';
import type { CardLane, LaneUpdate, ReleasedCard } from './CardLane';
import type { LaneCell } from './laneCells';

/** カードが飛ぶ時間（ミリ秒）と加速の形。並びが詰め直される滑りより少しだけ長く取る。 */
const FLY_MS = 260;
const FLY_EASE = 'Quad.easeOut';

/** 出現元が分からないカードが、その場で現れる時間（ミリ秒）。 */
const FADE_MS = 200;

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
 * カードゲームらしく、スタックへの合流は薄れさせずに「上に重ねて」見せる（stackOnto）。重なった
 * カードは着いた時点で捨てるが、その下には合流先のカードが既に居るので、見た目は札束が増えたまま残る。
 *
 * 動いている間はカードを最前面の層へ預ける。レーンからはみ出したカードは隣接エリアの背景板に
 * 隠れる設計（CardLane参照）のため、レーンの中に置いたままでは境界をまたげないため。
 */
export class CardMotion {
  private readonly scene: Phaser.Scene;
  private readonly metrics: ScreenMetrics;
  private readonly layer: Phaser.GameObjects.Container;

  /** 離した場所へ置いたままにしているもの（hold参照）。cardは分身の元になったレーンのカード。 */
  private held: { readonly id: number; readonly card: Card; readonly stand: Card } | undefined;

  /**
   * 動いているカードは常に最前面へ出す。探索の子ウィンドウを開いたまま探索したときに、見つけたものが
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
   *
   * 置くのは分身で、本体はレーンの枠に居るまま伏せる。レーンをまたぐ位置へ本体を出すと隣接エリアの
   * 背景板に隠れてしまう（CardLane参照）ため。
   */
  hold(lanes: readonly CardLane[], released: NonNullable<MotionContext['released']>): void {
    this.release();

    const card = ownersOf(lanes).get(released.id)?.card;
    if (card === undefined) return;

    // 置きに行くのは1つだけなので、スタックは残りがそこに居る。枠から居なくなるのは1つしか
    // 映していないカードだけ。
    if ((card.content.count ?? 1) < 2) card.setVisible(false);
    const { x, y } = released.rect;
    const stand = new Card(this.scene, this.metrics, x, y, cardFace(card.content));
    this.layer.add(stand);
    this.held = { id: released.id, card, stand };
  }

  /**
   * 置いたままにしていたカードを、動かさずに本体へ返す（分身を捨て、伏せていた本体を表に戻す）。
   * レーンを作り直すときは、本体ごと捨てられる前にここで片付ける。
   */
  release(): void {
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

    this.scene.tweens.add({
      targets: held.stand,
      x: owner.rect.x,
      y: owner.rect.y,
      duration: FLY_MS,
      ease: FLY_EASE,
      onComplete: () => {
        held.stand.destroy();
        reveal(owner.card);
      },
    });
  }

  /** 各レーンの内容を差し替え、出入りするカードを動かす。lanesとcellsは同じ順に対応する。 */
  update(
    lanes: readonly CardLane[],
    cells: readonly (readonly LaneCell[])[],
    context: MotionContext = {},
  ): void {
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

    updates.forEach((update, index) => {
      for (const { card, index: slot } of arrivals(update)) {
        // 分身が運ぶ先のカードは、着くまで伏せたまま待たせる（landHeldが表に戻す）。
        if (landing !== undefined && idsOf(card).includes(landing.id)) continue;

        const from = releasedRect(idsOf(card), remaining) ?? rectOf(before, idsOf(card)) ?? context.origin;
        this.fly(card, from, lanes[index].slotRect(slot));
      }
    });

    this.moveInstances(lanes, updates, before, remaining);

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
    if (this.held !== undefined && this.held.card.scene === undefined) this.release();
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
  ): void {
    // カードごと出入りするぶんは、そのカード自身が飛ぶ（fly・dismiss）ので数えない。
    const arriving = new Set(updates.flatMap(arrivals).map(({ card }) => card));
    const left = new Set(updates.flatMap((update) => update.left));

    for (const lane of lanes) {
      lane.cardObjects.forEach((card, slot) => {
        if (card === undefined || arriving.has(card)) return;

        const to = lane.slotRect(slot);
        for (const from of arrivalsAt(card, before, left, context)) {
          this.stackOnto(
            new Card(this.scene, this.metrics, from.x, from.y, cardFace(card.content)),
            from,
            to,
          );
        }
      });
    }
  }

  /** 現れたカードをfromからtoへ飛ばす。fromが無ければtoの位置で浮かび上がらせる。 */
  private fly(card: Card, from: Rect | undefined, to: Rect): void {
    const strip = card.parentContainer;
    const home = { x: card.x, y: card.y };
    card.setVisible(true);

    if (from === undefined) {
      card.setAlpha(0);
      this.scene.tweens.add({ targets: card, alpha: 1, duration: FADE_MS });
      return;
    }

    this.layer.add(card);
    card.setPosition(from.x, from.y);
    this.scene.tweens.add({
      targets: card,
      x: to.x,
      y: to.y,
      duration: FLY_MS,
      ease: FLY_EASE,
      onComplete: () => {
        if (card.scene === undefined) return;
        strip.add(card);
        card.setPosition(home.x, home.y);
      },
    });
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

    this.stackOnto(new Card(this.scene, this.metrics, from.x, from.y, cardFace(card.content)), from, to);
    card.destroy();
  }

  /**
   * 見た目だけの分身をfromからtoへ飛ばして重ねる。着いた時点で捨てる——下には合流先のカードが
   * 既に居るため。
   *
   * 飛ばすのは必ず分身で、レーンに並んでいたカード自身ではない。カードには押している間の表示
   * （端のオーバーレイ）や端の繰り返しなど、そのレーンに居ることが前提の状態が乗っているため。
   */
  private stackOnto(card: Card, from: Rect, to: Rect): void {
    this.layer.add(card);
    card.setPosition(from.x, from.y);
    this.scene.tweens.add({
      targets: card,
      x: to.x,
      y: to.y,
      duration: FLY_MS,
      ease: FLY_EASE,
      onComplete: () => card.destroy(),
    });
  }
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
