import type { PropertyValue } from './PropertyValue';
import type { WorldObject } from './WorldObject';

/**
 * conditions（GameElementDefinition.md 14節）・weight（10.2節）・passivesのゲート（8節）・active効果の
 * 対象/参照が共通で参照する起点。self.prop/parent.propのような1階層の参照のみ対応。
 * worldは起点として未対応（ロード時エラー、14.1節）。Ancestorは見つからなければworldまで遡るため、
 * 世界固有の概念の参照はAncestorで代替できる。
 */
export type ReferenceRoot =
  | 'self'
  | 'parent'
  /**
   * passiveのtarget専用（8.1節）。親が宣言した効果を、そのスロットに入った各子へブロードキャスト登録する
   * ために使う。単一の参照先へ解決されるconditions/active/weight/transferの文脈では意味を持たない
   * （それらの許可rootには含めない）。
   */
  | 'child'
  | 'actor'
  /** combinations内でのみ意味を持つ、ドラッグされてきたカード（12.2節）。 */
  | 'dragged'
  /**
   * selfの直接の親から遡り、参照先のプロパティを定義している最初の祖先（WorldObject.findAncestorWithProperty
   * 参照）。SlotPosition判定（{in_slot: ...}）では意味を持たないため未対応（ロード時エラー）。
   */
  | 'ancestor';

/**
 * 宣言に書かれたReferenceRootを実行時のオブジェクトへ解くための、**誰がself/actor/draggedか**という文脈。
 *
 * 参照を持つ側（条件・効果・重み）はこれを組み立てず、受け取ったものをそのまま下へ渡す。**組み立てるのは
 * 「誰がこの行動をしているか」を知っている一番外側だけ**で、途中の誰も3つ組をばらして持ち回らない。
 *
 * ancestorはここでは解けない——「参照先のプロパティを定義している最初の祖先」なので、探すプロパティを
 * 知っている側（PropertyPath）でしか決まらない。
 */
export class ReferenceContext {
  /** この文脈のself。効果の宣言元であり、parent・ancestorはここから辿る。 */
  readonly self: WorldObject | undefined;

  /** この操作をしている者。誰も操作していない文脈（tick・持続効果のゲート）ではundefined。 */
  readonly actor: WorldObject | undefined;

  /** 重ねられてきた相手。combinationsの中でのみ相手を持つ（12.2節）。 */
  readonly dragged: WorldObject | undefined;

  private constructor(
    self: WorldObject | undefined,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ) {
    this.self = self;
    this.actor = actor;
    this.dragged = dragged;
  }

  /**
   * selfだけが決まっている文脈。actor/draggedは解決先を持たない——誰かが操作しているとは限らない
   * 場面（持続効果のゲート、影響の一覧）で使う。
   */
  static of(self: WorldObject | undefined): ReferenceContext {
    return new ReferenceContext(self, undefined, undefined);
  }

  /** 操作の文脈（誰が・何を重ねて）。draggedはcombinationsの中でのみ相手を持つ（12.2節）。 */
  static acting(
    self: WorldObject | undefined,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): ReferenceContext {
    return new ReferenceContext(self, actor, dragged);
  }

  /** selfだけを差し替えた文脈。誰が操作しているかは変わらないまま、参照の起点が移る場面で使う。 */
  withSelf(self: WorldObject | undefined): ReferenceContext {
    return new ReferenceContext(self, this.actor, this.dragged);
  }

  /** draggedだけを差し替えた文脈。同じ操作を候補ごとに引き直す場面で使う（TransferEffect.acceptedCount）。 */
  withDragged(dragged: WorldObject | undefined): ReferenceContext {
    return new ReferenceContext(this.self, this.actor, dragged);
  }

  /**
   * rootが指すオブジェクト。解決先を持たないrootはundefined——childは相手が1つに定まらず
   * （PassiveEffect.registerChild）、ancestorは探すプロパティが要る（ownerOfProperty）。
   */
  objectAt(root: ReferenceRoot): WorldObject | undefined {
    switch (root) {
      case 'self':
        return this.self;
      case 'parent':
        return this.self?.parent;
      case 'actor':
        return this.actor;
      case 'dragged':
        return this.dragged;
      default:
        return undefined;
    }
  }

  /**
   * rootが指す、propertyGlobalIdを持つべきオブジェクト。**ancestorを解けるのはここだけ**——
   * 「そのプロパティを定義している最初の祖先」なので、探すプロパティが決まって初めて相手が決まる
   * （8.6節）。
   */
  ownerOfProperty(root: ReferenceRoot, propertyGlobalId: number): WorldObject | undefined {
    return root === 'ancestor' ? this.self?.findAncestorWithProperty(propertyGlobalId) : this.objectAt(root);
  }
}

/**
 * {subject, prop}が指す、1階層のプロパティ参照（ReferenceRoot＋プロパティのグローバルID）。
 * weightのpath参照（10.2節）・conditionsのvalueRef（14節）・activeの対象・passivesの対象が共有する。
 *
 * **どのプロパティを指すかとどう辿るかを1つにまとめて持つ**ので、解決するときにプロパティIDを
 * 渡し直す必要が無い（ancestor探索と読み出しが同じIDを使う）。
 *
 * 主語とプロパティが必ず対になるとは限らない場面ではこれを使わない——`ConditionNode` の葉は
 * `{subject, in_slot}` のようにプロパティを伴わない形も取るので、主語は主語のまま持つ。
 */
export class PropertyPath {
  readonly root: ReferenceRoot;
  readonly propertyGlobalId: number;

  constructor(root: ReferenceRoot, propertyGlobalId: number) {
    this.root = root;
    this.propertyGlobalId = propertyGlobalId;
  }

  /** この参照が指すプロパティを持つべきオブジェクト（ReferenceContext.ownerOfProperty）。 */
  owner(context: ReferenceContext): WorldObject | undefined {
    return context.ownerOfProperty(this.root, this.propertyGlobalId);
  }

  /** この参照が指すプロパティ値。解決先がそのプロパティを持たなければundefined。 */
  value(context: ReferenceContext): PropertyValue | undefined {
    return this.owner(context)?.tryGetProperty(this.propertyGlobalId);
  }

  /** この参照が指すプロパティの実効値。解決できなければundefined（0とは区別する）。 */
  number(context: ReferenceContext): number | undefined {
    return this.value(context)?.getEffectiveValue();
  }
}
