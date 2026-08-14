import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import type { ActiveEffect } from './ActiveEffect';
import type { DefNames, DescriptionWriter } from './Description';
import { text } from './Description';
import { InteractionDef } from './InteractionDef';
import type { WeightSpec } from './PickEffect';
import type { Requirement, Requirements } from './Requirement';

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
    requirements: Requirements | undefined,
    effect: ActiveEffect,
    duration?: WeightSpec,
  ) {
    super(name, requirements, effect, duration);
    this.showMenu = showMenu;
  }

  protected describeTrigger(_names: DefNames, out: DescriptionWriter): void {
    out.write(text(`show_menu: ${this.showMenu}`));
  }

  protected get craftingKind(): 'action' {
    return 'action';
  }

  tryExecute(self: WorldObject, actor: WorldObject | undefined, session: WorldSession): boolean {
    return this.apply(self, undefined, actor, session);
  }

  /** 今このアクションを実行できない理由（最初に落ちた要件）。実行できるならundefined。 */
  unmetRequirement(self: WorldObject, actor: WorldObject | undefined): Requirement | undefined {
    return this.firstUnmetRequirement(self, undefined, actor);
  }
}
