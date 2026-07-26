import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import { ActiveEffect } from './ActiveEffect';
import type { ReferenceRoot } from './ReferenceRoot';

/**
 * move の移動先の指し方。
 *
 * - `self`: move を宣言したオブジェクト自身（YAMLの `to: self`）。行き先が定義時点で決まっている場合
 *   （かごの中へ入れる等）に使う。
 * - `instance_id_prop`: self のそのプロパティが保持する WorldObject.instanceId のオブジェクト
 *   （YAMLの `to_prop`）。行き先が定義時点で決まらず生成時に確定する場合（道が指す特定の土地）に使う。
 */
export type MoveDestination =
  { readonly kind: 'self' } | { readonly kind: 'instance_id_prop'; readonly propertyGlobalId: number };

/**
 * move の1命令。既に世界に存在するオブジェクトを、移動先（MoveDestination）の中へ移動する。
 *
 * YAML: `move: {object: actor, to_prop: destination_id}` / `move: {object: dragged, to: self}`
 * （transfer と同じフラットフィールド規約）。解決できない・どのスロットも受け入れない場合は何もしない
 * （「解決できない適用は無視」の既存規約）。配置は moveIntoFirstAcceptingSlot（spawn の into と同じ
 * 宣言順走査、force なし）。
 */
export class MoveEffect extends ActiveEffect {
  /** 移動するオブジェクト。actorかdraggedのみ（ローダーが強制する）。 */
  private readonly target: ReferenceRoot;

  private readonly destination: MoveDestination;

  constructor(target: ReferenceRoot, destination: MoveDestination) {
    super();
    this.target = target;
    this.destination = destination;
  }

  apply(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): void {
    const mover = owner.resolveEffectTarget(this.target, actor, dragged);
    if (mover === undefined) return;

    const destination = this.resolveDestination(owner);
    if (destination === undefined) return;

    mover.moveIntoFirstAcceptingSlot(destination, session.codex.wellKnown);
  }

  private resolveDestination(owner: WorldObject): WorldObject | undefined {
    if (this.destination.kind === 'self') return owner;

    const instanceId = owner.tryGetProperty(this.destination.propertyGlobalId);
    if (instanceId === undefined) return undefined;
    // 移動先の解決は「ツリーの根から InstanceId で子孫を探す」。
    return owner.findRoot().findDescendantByInstanceId(instanceId.getEffectiveValue());
  }
}
