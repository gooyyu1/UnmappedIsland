import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import type { ActiveEffect } from './ActiveEffect';
import type { ConditionNode } from './ConditionNode';
import { InteractionDef } from './InteractionDef';
import type { WeightSpec } from './PickEffect';

/** showMenuの値（11.1節）。現時点ではalwaysのみ（ActionSystem.md 7節）。 */
export type ShowMenuMode = 'always';

/**
 * メニュー型の宣言的操作（GameElementDefinition.md 11節）。1枚のカード（self）だけで完結し、
 * 名前で指して実行される。actorは常に暗黙的に参加する。
 */
export class ActionDef extends InteractionDef {
  readonly showMenu: ShowMenuMode;

  constructor(
    name: string,
    showMenu: ShowMenuMode,
    conditions: ConditionNode | undefined,
    effect: ActiveEffect | undefined,
    duration?: WeightSpec,
  ) {
    super(name, conditions, effect, duration);
    this.showMenu = showMenu;
  }

  tryExecute(self: WorldObject, actor: WorldObject | undefined, session: WorldSession): boolean {
    return this.apply(self, undefined, actor, session);
  }
}
