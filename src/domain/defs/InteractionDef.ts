import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import type { ActiveEffect } from './ActiveEffect';
import type { ConditionNode } from './ConditionNode';
import type { WeightSpec } from './PickEffect';
import { resolveReferenceRoot } from './ReferenceRoot';
import { spendDuration } from './actionTime';

/**
 * プレイヤーが起こせる操作1つ（ActionSystem.md 1節）。具象は入口が違うだけの2種——名前で指す
 * メニュー型（ActionDef）と、withタグで相手と噛み合うドラッグ型（CombinationDef）。
 *
 * 選ばれた後の実行手順（2節）は共通なのでここが持つ。draggedはドラッグ型だけが持つ相手で、
 * メニュー型ではundefined。条件の起点も効果の対象も所要時間の参照も、そのまま流せば同じ経路を通る。
 */
export abstract class InteractionDef {
  readonly name: string;

  /** undefinedなら常に真（conditions省略）。 */
  private readonly conditions: ConditionNode | undefined;

  /** 条件成立時に適用する効果。undefinedなら何も起きない。 */
  private readonly effect: ActiveEffect | undefined;

  /**
   * 実行にかかるゲーム内時間（分）。リテラルか{object, prop}参照（weightの10.2節と同じ二択）。
   * undefinedなら時間を消費しない。時間進行（advanceWorldTime）までがこのクラスの責務で、
   * 呼び出し側が実行後に別途時間を進める必要はない。
   */
  private readonly duration: WeightSpec | undefined;

  protected constructor(
    name: string,
    conditions: ConditionNode | undefined,
    effect: ActiveEffect | undefined,
    duration: WeightSpec | undefined,
  ) {
    this.name = name;
    this.conditions = conditions;
    this.effect = effect;
    this.duration = duration;
  }

  /**
   * この操作にかかるゲーム内時間（分）。durationを省いていれば0。
   *
   * 「今のself（とdragged）の状態から見て、どれだけかかるか」なので、時間を進める前に解決する
   * （切れ味の悪い刃物ほど時間がかかる、が書けるように）。実行前に画面へ見せる用途にも使う。
   */
  minutesFor(self: WorldObject, dragged: WorldObject | undefined, actor: WorldObject | undefined): number {
    return this.duration === undefined ? 0 : Math.trunc(this.duration.resolve(self, actor, dragged));
  }

  /**
   * conditionsを見て、時間を進め、効果を適用する（ActionSystem.md 2節）。順序に意味がある:
   * 所要時間は時間を進める前に解決し、時間は効果の適用より先に進める。経過中に関与オブジェクトが
   * 失われたら、その行動は成立しなかったものとして効果を適用しない（actionTime参照）。
   */
  protected apply(
    self: WorldObject,
    dragged: WorldObject | undefined,
    actor: WorldObject | undefined,
    session: WorldSession,
  ): boolean {
    if (
      this.conditions !== undefined &&
      !this.conditions.evaluate((root) => resolveReferenceRoot(root, self, actor, dragged))
    )
      return false;

    if (!spendDuration(this.minutesFor(self, dragged, actor), session, [self, dragged, actor])) return false;

    if (this.effect !== undefined) self.applyActiveEffect(this.effect, session, actor, dragged);
    return true;
  }
}
