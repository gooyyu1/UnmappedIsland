import type Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import type { CardContent } from './Card';
import { Card, cardFace } from './Card';
import type { CardLane, LaneUpdate } from './CardLane';

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
   * 居るため、そこから動き出す。元と同じカードへ戻る場合（重ねてもカード自身は動かないcombination）も
   * 同じ扱いで、道具は使い終わってから手元へ戻る。
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

  /**
   * 動いているカードは常に最前面へ出す。探索の子ウィンドウを開いたまま探索したときに、見つけたものが
   * ウィンドウの覆いに隠れてしまわないようにするため（他はすべて既定のdepth 0で描画順に従う）。
   */
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics) {
    this.scene = scene;
    this.metrics = metrics;
    this.layer = scene.add.container(0, 0).setDepth(1);
  }

  /** 各レーンの内容を差し替え、出入りするカードを動かす。lanesとcontentsは同じ順に対応する。 */
  update(
    lanes: readonly CardLane[],
    contents: readonly (readonly (CardContent | undefined)[])[],
    context: MotionContext = {},
  ): void {
    const before = ownersOf(lanes);
    const updates = lanes.map((lane, index) => lane.setCards(contents[index]));
    const after = ownersOf(lanes);

    // 現れた側が飛ぶIDは、居なくなった側では改めて動かさない（同じ移動を二重に見せないため）。
    const entering = new Set(updates.flatMap((update) => update.entered).flatMap(({ card }) => idsOf(card)));

    updates.forEach((update, index) => {
      for (const { card, index: slot } of update.entered) {
        const from = releasedRect(idsOf(card), context) ?? rectOf(before, idsOf(card)) ?? context.origin;
        this.fly(card, from, lanes[index].slotRect(slot));
      }
    });

    this.moveInstances(lanes, updates, before, context);

    for (const { left } of updates) {
      for (const card of left) {
        const ids = idsOf(card);
        if (ids.some((id) => entering.has(id))) {
          card.destroy();
          continue;
        }
        this.dismiss(card, rectOf(before, ids), rectOf(after, ids));
      }
    }
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
    const entered = new Set(updates.flatMap((update) => update.entered).map(({ card }) => card));
    const left = new Set(updates.flatMap((update) => update.left));

    for (const lane of lanes) {
      lane.cardObjects.forEach((card, slot) => {
        if (card === undefined || entered.has(card)) return;

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
    if (from === undefined) {
      card.destroy();
      return;
    }

    // 行き先が無い＝そのインスタンスが世界から消えた。カードもその場で消す（薄れさせると、掴んで
    // 離したカードが即座に消えるのと食い違って見える）。
    if (to === undefined) {
      card.destroy();
      return;
    }
    this.stackOnto(card, from, to);
  }

  /** カードをfromからtoへ飛ばして重ねる。着いた時点で捨てる——下には合流先のカードが既に居るため。 */
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

/** そのカードが、掴んで離したインスタンスを映しているなら、手を離した位置。 */
function releasedRect(ids: readonly number[], context: MotionContext): Rect | undefined {
  const { released } = context;
  return released !== undefined && ids.includes(released.id) ? released.rect : undefined;
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
