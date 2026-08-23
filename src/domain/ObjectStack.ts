import type { StackOrderDef } from './StackOrderDef';
import type { WorldObject } from './WorldObject';

/**
 * Slot内で「見た目上1つのまとまり」として積み重なる、同じ種類のWorldObjectの集まり
 * （GameElementDefinition.md 7.6節）。同じObjectDefのインスタンス同士だけがまとまる。
 */
export class ObjectStack {
  /**
   * このスタックのアイデンティティ（生成時点のseedのObjectDef）。生成後は書き換えない。メンバーの型が
   * 変わって（become、9.9節）合致しなくなった場合に動くのは、そのメンバーの所属スタックであってこの値ではない。
   */
  private readonly objectDefGlobalId: number;

  private readonly _members: WorldObject[];
  get members(): readonly WorldObject[] {
    return this._members;
  }

  constructor(seed: WorldObject) {
    this.objectDefGlobalId = seed.def.globalId;
    this._members = [seed];
  }

  /** candidateがこのObjectStackへ合流できるか（ObjectDefが一致するか）。 */
  canMerge(candidate: WorldObject): boolean {
    return candidate.def.globalId === this.objectDefGlobalId;
  }

  /**
   * canMergeを満たす場合のみ、ObjectDef.stackOrderに従ったmembers内の位置へ挿入してtrueを返す（並び順が
   * 未定義なら末尾＝挿入順）。満たさない場合は何もせずfalse——「同種のみが積み重なる」不変条件を、呼び出し側の
   * 事前確認に依存せずこのメソッド自身が保証する。
   */
  tryInsert(obj: WorldObject): boolean {
    if (!this.canMerge(obj)) return false;
    this._members.splice(this.computeInsertionIndex(obj), 0, obj);
    return true;
  }

  remove(obj: WorldObject): void {
    const index = this._members.indexOf(obj);
    if (index >= 0) this._members.splice(index, 1);
  }

  private computeInsertionIndex(obj: WorldObject): number {
    // 並び順が未定義なら末尾（挿入順）。定義があればStackOrderDefに委ねる。
    const order: StackOrderDef | undefined = obj.def.stackOrder;
    return order === undefined ? this._members.length : order.insertionIndexOf(obj, this._members);
  }
}
