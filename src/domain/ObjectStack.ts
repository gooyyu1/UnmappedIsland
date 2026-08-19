import type { StackOrderDef } from './StackOrderDef';
import type { WorldObject } from './WorldObject';

/**
 * Slot内で「見た目上1つのまとまり」として積み重なる、同じ種類のWorldObjectの集まり
 * （GameElementDefinition.md 7.6節）。ObjectDefと、represented_byで辿った代表ObjectDef列が一致するインスタンス
 * 同士だけがまとまる（例: 同じ液体容器でも中身のObjectDefが違えば別スタック）。
 */
export class ObjectStack {
  /**
   * このスタックのアイデンティティ（seed自身のObjectDefを先頭に、represented_byで辿った代表ObjectDef列が続く、
   * 生成時点のスナップショット）。生成後は書き換えない。メンバーの中身が変わってこの列に合致しなくなった場合に
   * 動くのは、そのメンバーの所属スタックであってこの列ではない。
   */
  private readonly representationChain: readonly number[];

  private readonly _members: WorldObject[];
  get members(): readonly WorldObject[] {
    return this._members;
  }

  constructor(seed: WorldObject) {
    this.representationChain = seed.captureRepresentationChain();
    this._members = [seed];
  }

  /** candidateがこのObjectStackへ合流できるか（代表ObjectDef列が完全一致するか）。 */
  matches(candidate: WorldObject): boolean {
    return candidate.matchesRepresentation(this.representationChain);
  }

  /**
   * matchesを満たす場合のみ、ObjectDef.stackOrderに従ったmembers内の位置へ挿入してtrueを返す（並び順が
   * 未定義なら末尾＝挿入順）。満たさない場合は何もせずfalse——「同種のみが積み重なる」不変条件を、呼び出し側の
   * 事前確認に依存せずこのメソッド自身が保証する。
   */
  tryInsert(obj: WorldObject): boolean {
    if (!this.matches(obj)) return false;
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
