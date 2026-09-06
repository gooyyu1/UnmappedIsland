import type { PropertyDef } from './PropertyDef';
import type { WorldObject } from './WorldObject';

/**
 * 操作そのものが直に増やした値1件（`WorldSession.observeGains`）。
 *
 * **拾うのは効果が実体値へ書いた先だけ**——`add`の対象、`transfer`の`to_prop`、`linked_add`の対象。
 * `modify`・`base`で押し上げられた実効値は含まない。満腹度は誰も書かず、胃と腸の段が押し上げて
 * いるだけなので現れず、食べた操作が増やしたものとして現れるのは胃と栄養になる。
 *
 * **毎tickの積分（passivesの`add`）のうち、入るのはその操作自身が宣言した分だけ**
 * （`interactions`の`passives`、11.7節。`WorldSession.recordPassiveGain`）。物が自分で宣言した増減は、
 * 誰かの操作が増やしたものではないので入らない——時間の経過の中での実体値への書き込みは、端の
 * クランプも輸送もまとめて数えない（`WorldSession.insideTick`）。
 */
export interface PropertyGain {
  /** 値が増えたオブジェクト。 */
  readonly object: WorldObject;

  readonly property: PropertyDef;

  /** 正味の増加量。同じ値への複数回の書き込みは足し合わせたうえで、増えたものだけを流す。 */
  readonly amount: number;
}

/** 操作1回が増やした値と、その出どころ。 */
export interface InteractionGains {
  /**
   * 操作を宣言していた札（WorldChange.subjectと同じく**演出で動かす札**）と、それを抱えていた親を
   * 外側へ向かって並べたもの。先頭が発生源で、画面に自分の札が無ければ次を見る——見えないスロットの
   * 中身には札が無いため。
   *
   * **効果を適用する前に控える。** 飲み干した水のように、適用し終えた時点では世界から出ていて
   * 親を辿れない物がある。
   */
  readonly sourceAndAncestors: readonly WorldObject[];

  readonly gains: readonly PropertyGain[];
}
