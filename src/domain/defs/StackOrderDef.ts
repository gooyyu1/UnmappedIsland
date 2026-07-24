import type { WorldObject } from '../runtime/WorldObject';

/**
 * 同種オブジェクトがスタックとして並ぶ際の、型ごとの並び順（表示専用）。
 *
 * ascendingは「プロパティ値が増えるほどリスト内で後ろ（末尾側）に並ぶか」。「手前に重ねたいものほど
 * リストの末尾に置く」という規約（Slot参照）のもと、寿命・残量など「小さいほど手前」にしたい値は
 * ascending=false を指定する。
 *
 * 新規インスタンスがスタックへ加わる際の並び位置決定にのみ使い、値の変化に追従した再ソートは行わない
 * （8.4節のaccumulateのような一定速度の変化を想定し、同種は同じ速度で変化する前提のため、
 * 挿入時点の相対順序が保たれる）。
 */
export class StackOrderDef {
  private readonly propertyGlobalId: number;
  private readonly ascending: boolean;

  constructor(propertyGlobalId: number, ascending: boolean) {
    this.propertyGlobalId = propertyGlobalId;
    this.ascending = ascending;
  }

  /**
   * この並び順に従って、objをmembers内のどの位置へ挿入すべきかを返す。同値は既存メンバーの後ろへ
   * （＝挿入順を保つ）。membersはこの並び順で既に整列済みである前提。
   */
  insertionIndexOf(obj: WorldObject, members: readonly WorldObject[]): number {
    const value = obj.getNumber(this.propertyGlobalId);
    let i = 0;
    while (i < members.length) {
      const otherValue = members[i].getNumber(this.propertyGlobalId);
      const staysBefore = this.ascending ? otherValue <= value : otherValue >= value;
      if (!staysBefore) break;
      i++;
    }
    return i;
  }
}
