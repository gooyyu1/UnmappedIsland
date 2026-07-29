import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import type { ActiveEffect } from './ActiveEffect';
import type { ConditionNode } from './ConditionNode';
import type { WeightSpec } from './PickEffect';
import { resolveReferenceRoot } from './ReferenceRoot';
import { spendDuration } from './actionTime';

/** showMenuの値（11.1節）。現時点ではalwaysのみ（ActionSystem.md 7節）。 */
export type ShowMenuMode = 'always';

/**
 * メニュー型の宣言的操作（GameElementDefinition.md 11節）。conditionsと条件成立時の効果を1つの定義として持つ。
 */
export class ActionDef {
  readonly name: string;
  readonly showMenu: ShowMenuMode;

  /** undefinedなら常に真（conditions省略）。 */
  private readonly conditions: ConditionNode | undefined;

  /** 条件成立時に適用する効果。undefinedなら何も起きない。 */
  private readonly effect: ActiveEffect | undefined;

  /**
   * 実行にかかるゲーム内時間（分）。リテラルか{object, prop}参照（weightの10.2節と同じ二択）。
   * undefinedなら時間を消費しない。時間進行（advanceWorldTime）まではこのActionDefの責務で、
   * 呼び出し側が実行後に別途時間を進める必要はない。
   */
  private readonly duration: WeightSpec | undefined;

  constructor(
    name: string,
    showMenu: ShowMenuMode,
    conditions: ConditionNode | undefined,
    effect: ActiveEffect | undefined,
    duration?: WeightSpec,
  ) {
    this.name = name;
    this.showMenu = showMenu;
    this.conditions = conditions;
    this.effect = effect;
    this.duration = duration;
  }

  /**
   * この行動にかかるゲーム内時間（分）。durationを省いていれば0。
   *
   * 「今のselfの状態から見て、どれだけかかるか」なので、時間を進める前に解決する（切れ味の悪い刃物ほど
   * 時間がかかる、が書けるように）。実行前に画面へ見せる用途にも使う。
   */
  minutesFor(self: WorldObject, actor: WorldObject | undefined): number {
    return this.duration === undefined ? 0 : Math.trunc(this.duration.resolve(self, actor, undefined));
  }

  tryExecute(self: WorldObject, actor: WorldObject | undefined, session: WorldSession): boolean {
    if (
      this.conditions !== undefined &&
      !this.conditions.evaluate((root) => resolveReferenceRoot(root, self, actor, undefined))
    )
      return false;

    // 時間はeffect適用より先に進める。経過中に関与オブジェクトが壊れたら行動は成立しない（actionTime参照）。
    if (!spendDuration(this.minutesFor(self, actor), session, [self, actor])) return false;

    if (this.effect !== undefined) self.applyActiveEffect(this.effect, session, actor, undefined);
    return true;
  }
}
