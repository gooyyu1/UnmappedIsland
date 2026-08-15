import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import { ActiveEffect } from './ActiveEffect';
import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { propertyRef, text } from './Description';
import type { ReferenceRoot } from './ReferenceRoot';

/**
 * move の移動先の指し方。
 *
 * - `self`: move を宣言したオブジェクト自身（YAMLの `to: self`）。行き先が定義時点で決まっている場合
 *   （かごの中へ入れる等）に使う。
 * - `parent`: self の直接の親（YAMLの `to: parent`）。代表（represented_by）へリダイレクトされた
 *   中身が、自分ではなく容器を行き先にしたい場合（液体の注ぎ移し）に使う。親が無ければ何も起きない。
 * - `instance_id_prop`: self のそのプロパティが保持する WorldObject.instanceId のオブジェクト
 *   （YAMLの `to_prop`）。行き先が定義時点で決まらず生成時に確定する場合（道が指す特定の土地）に使う。
 */
export type MoveDestination =
  | { readonly kind: 'self' }
  | { readonly kind: 'parent' }
  | { readonly kind: 'instance_id_prop'; readonly propertyGlobalId: number };

/**
 * move の1命令。既に世界に存在するオブジェクトを、移動先（MoveDestination）の中へ移動する。
 *
 * YAML: `move: {subject: actor, to_prop: destination_id}` / `move: {subject: dragged, to: self}`
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

    mover.moveIntoFirstAcceptingSlot(destination, false, session);
  }

  describe(names: DefNames, out: DescriptionWriter): void {
    const destination: DescriptionToken =
      this.destination.kind === 'instance_id_prop'
        ? propertyRef(names.propertyName(this.destination.propertyGlobalId), 'self')
        : text(this.destination.kind);
    out.write(text(`move ${this.target} → `), destination);
  }

  /** オブジェクトの居場所を変えるだけで、プロパティを書き換えはしない。 */
  affects(): boolean {
    return false;
  }

  private resolveDestination(owner: WorldObject): WorldObject | undefined {
    if (this.destination.kind === 'self') return owner;
    if (this.destination.kind === 'parent') return owner.parent;

    const instanceId = owner.tryGetProperty(this.destination.propertyGlobalId);
    if (instanceId === undefined) return undefined;
    // 移動先の解決は「ツリーの根から InstanceId で子孫を探す」。
    return owner.findRoot().findDescendantByInstanceId(instanceId.getEffectiveValue());
  }
}
