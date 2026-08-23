import type { ActiveEffect } from './ActiveEffect';
import type { InteractionTriggerReading } from './InteractionDef';
import { InteractionDef } from './InteractionDef';
import type { WeightSpec } from './WeightSpec';
import type { Requirements } from './Requirement';

/**
 * 相手を伴わない操作のきっかけ（GameElementDefinition.md 11.1節）。**画面のボタンに出るのは
 * `menu` だけ**で、出すかどうかはきっかけから決まる。
 *
 * `tick`は時間が起こす操作（動物の1手、docs/engine/HuntingSystem.md 5節）。プレイヤーが押す機会は
 * 無く、名前で指して実行される点だけが`menu`と同じ。
 */
export type ActionTrigger = 'menu' | 'tick';

/**
 * 相手を伴わない宣言的操作（GameElementDefinition.md 11節）。1枚のカード（self）だけで完結し、
 * 名前で指して実行される。actorは常に暗黙的に参加する。
 */
export class ActionDef extends InteractionDef {
  readonly trigger: ActionTrigger;

  constructor(
    name: string,
    trigger: ActionTrigger,
    requirements: Requirements | undefined,
    effect: ActiveEffect,
    duration?: WeightSpec,
  ) {
    super(name, requirements, effect, duration);
    this.trigger = trigger;
  }

  get triggerReading(): InteractionTriggerReading {
    return { kind: this.trigger };
  }
}
