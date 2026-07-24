import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import type { ActiveEffect } from './ActiveEffect';
import type { ConditionNode } from './ConditionNode';
import type { WeightSpec } from './PickEffect';
import { resolveReferenceRoot } from './ReferenceRoot';

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

  tryExecute(self: WorldObject, actor: WorldObject | undefined, session: WorldSession): boolean {
    if (
      this.conditions !== undefined &&
      !this.conditions.evaluate((root) => resolveReferenceRoot(root, self, actor, undefined))
    )
      return false;

    // 時間進行はeffect適用の後（先に進めるとtick中のdestroy等がselfを破棄してから効果を適用する事故になる）。
    // ただし参照durationは適用前のselfから読む必要があるため、解決だけは適用前に行う。
    const minutes =
      this.duration !== undefined ? Math.trunc(this.duration.resolve(self, actor, undefined)) : 0;

    if (this.effect !== undefined) self.applyActiveEffect(this.effect, session, actor, undefined);

    // Worldを持たないセッション（単体テスト等、時間の概念が無い文脈）では時間進行をスキップする。
    if (minutes > 0 && session.world !== undefined) session.advanceWorldTime(minutes);
    return true;
  }
}
