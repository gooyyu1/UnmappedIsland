import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import { ActiveEffect } from './ActiveEffect';
import type { ReferenceRoot } from './ReferenceRoot';

/**
 * move の1命令。対象を、self のプロパティ（to_prop）が保持する WorldObject.instanceId のオブジェクトの中へ
 * 移動する。移動先が定義時点で決まらず生成時に確定するケース（道の移動アクション等）のため、
 * object_def 参照ではなくインスタンスIDのプロパティ値で指す。
 *
 * YAML: `move: {object: actor, to_prop: destination_id}`（transfer と同じフラットフィールド規約）。
 * object は現時点で actor のみ（ロード時に検証）。移動先の解決は「ツリーの根から InstanceId で子孫を探す」。
 * 解決できない・どのスロットも受け入れない場合は何もしない（「解決できない適用は無視」の既存規約）。
 * 配置は moveIntoFirstAcceptingSlot（spawn の into と同じ宣言順走査、force なし）。
 */
export class MoveEffect extends ActiveEffect {
  /** 移動するオブジェクト。現時点で actor のみ（ローダーが強制する）。 */
  private readonly target: ReferenceRoot;

  /** self が持つ、移動先 WorldObject.instanceId を保持するプロパティ。 */
  private readonly toPropertyGlobalId: number;

  constructor(target: ReferenceRoot, toPropertyGlobalId: number) {
    super();
    this.target = target;
    this.toPropertyGlobalId = toPropertyGlobalId;
  }

  apply(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): void {
    const mover = owner.resolveEffectTarget(this.target, actor, dragged);
    if (mover === undefined) return;
    const destinationIdValue = owner.tryGetProperty(this.toPropertyGlobalId);
    if (destinationIdValue === undefined) return;

    const destination = owner.findRoot().findDescendantByInstanceId(destinationIdValue.getEffectiveValue());
    if (destination === undefined || destination === mover) return;

    mover.moveIntoFirstAcceptingSlot(destination, session.codex.wellKnown);
  }
}
