import type { PropertyDef } from '../defs/PropertyDef';
import type { WorldObject } from './WorldObject';

/**
 * 操作そのものが直に増やした値1件（`WorldSession.observeGains`）。
 *
 * **拾うのは効果が実体値へ書いた先だけ**——`add`の対象、`transfer`の`to_prop`、`linked_add`の対象。
 * `modify`・`inherit`で押し上げられた実効値は含まない。満腹度は誰も書かず、胃と腸の段が押し上げて
 * いるだけなので現れず、食べた操作が増やしたものとして現れるのは胃と栄養になる。
 *
 * **毎tickの積分（passivesの`add`）も含まない。** 時間進行はPropertyValue.tickが直に足しており、
 * ここが見ている書き込みの経路を通らない。加えて記録するのは操作の効果を適用している間だけなので
 * （`withInteractionEffect`）、経過中に回ったtickの分はそもそも窓の外にある。
 */
export interface PropertyGain {
  /** 値が増えたオブジェクト。 */
  readonly object: WorldObject;

  readonly property: PropertyDef;

  /** 正味の増加量。同じ値への複数回の書き込みは足し合わせたうえで、増えたものだけを流す。 */
  readonly amount: number;
}

/** 操作1回が増やした値と、その操作を宣言していた札（WorldChange.subjectと同じく**演出で動かす札**）。 */
export interface InteractionGains {
  readonly source: WorldObject;
  readonly gains: readonly PropertyGain[];
}
