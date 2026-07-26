import type Phaser from 'phaser';
import type { Rect } from '../layout/ScreenMetrics';
import type { Card, CardContent } from './Card';
import type { CardLane } from './CardLane';

/** カードが飛ぶ時間（ミリ秒）と加速の形。並びが詰め直される滑りより少しだけ長く取る。 */
const FLY_MS = 260;
const FLY_EASE = 'Quad.easeOut';

/** 出現元が分からないカードが、その場で現れる時間（ミリ秒）。 */
const FADE_MS = 200;

/**
 * レーンの内容の差し替えを、カードの動きとして見せる。
 *
 * カードの同定はCardContent.identity（映しているインスタンスのID）で行う。差し替えの前後で
 * IDが1つでも重なるカード同士を同じカードとみなすので、レーン間の移動・スタックへの合流・
 * スタックの代表の入れ替わりを、いずれも「同じカードが動いた」として扱える。差し替え後に
 * どのカードのIDでもなくなったものが破棄、差し替え前のどのIDでもないものが新しく生まれたもの。
 *
 * 動いている間はカードを最前面の層へ預ける。レーンからはみ出したカードは隣接エリアの背景板に
 * 隠れる設計（CardLane参照）のため、レーンの中に置いたままでは境界をまたげないため。
 */
export class CardMotion {
  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Container;

  /**
   * 動いているカードは常に最前面へ出す。探索の子ウィンドウを開いたまま探索したときに、見つけたものが
   * ウィンドウの覆いに隠れてしまわないようにするため（他はすべて既定のdepth 0で描画順に従う）。
   */
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.layer = scene.add.container(0, 0).setDepth(1);
  }

  /**
   * 各レーンの内容を差し替え、出入りするカードを動かす。lanesとcontentsは同じ順に対応する。
   * originは、差し替え前に画面に無かったカード（探索・クラフトで生まれたもの）の出発点。
   */
  update(
    lanes: readonly CardLane[],
    contents: readonly (readonly (CardContent | undefined)[])[],
    origin?: Rect,
  ): void {
    const before = positionsOf(lanes);
    const updates = lanes.map((lane, index) => lane.setCards(contents[index]));
    const after = positionsOf(lanes);

    // 現れた側が飛ぶIDは、居なくなった側では改めて動かさない（同じ移動を二重に見せないため）。
    const entering = new Set(updates.flatMap((update) => update.entered).flatMap(({ card }) => idsOf(card)));

    updates.forEach((update, index) => {
      for (const { card, index: slot } of update.entered) {
        this.fly(card, rectOf(before, idsOf(card)) ?? origin, lanes[index].slotRect(slot));
      }
    });

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
   * 合流）そこへ吸い込み、どこにも無いなら（破棄）その場で消す。
   */
  private dismiss(card: Card, from: Rect | undefined, to: Rect | undefined): void {
    if (from === undefined) {
      card.destroy();
      return;
    }

    this.layer.add(card);
    card.setPosition(from.x, from.y);
    this.scene.tweens.add({
      targets: card,
      x: to?.x ?? from.x,
      y: to?.y ?? from.y,
      alpha: 0,
      duration: to === undefined ? FADE_MS : FLY_MS,
      ease: FLY_EASE,
      onComplete: () => card.destroy(),
    });
  }
}

/** レーンに並ぶカードが映しているインスタンスのIDから、その置き場所を引ける表。 */
function positionsOf(lanes: readonly CardLane[]): Map<number, Rect> {
  const positions = new Map<number, Rect>();
  for (const lane of lanes) {
    lane.cardObjects.forEach((card, index) => {
      if (card === undefined) return;
      const rect = lane.slotRect(index);
      for (const id of idsOf(card)) positions.set(id, rect);
    });
  }
  return positions;
}

function idsOf(card: Card): readonly number[] {
  return card.content.identity ?? [];
}

function rectOf(positions: Map<number, Rect>, ids: readonly number[]): Rect | undefined {
  for (const id of ids) {
    const rect = positions.get(id);
    if (rect !== undefined) return rect;
  }
  return undefined;
}
