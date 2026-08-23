/**
 * 特定の ObjectDef に閉じたローカル配列（PropertyDef[] / SlotDef[] など）と、
 * ゲーム全体で共有されるグローバルID空間とを対応付ける表。ObjectDef側は自分が実際に持つ
 * ものだけを詰めた密なローカル配列を持ち（グローバルID直インデックスでは疎になるため）、
 * この表がその変換を担う。
 */
export class LocalIndexByGlobalId {
  static readonly missing = -1;

  static readonly empty = new LocalIndexByGlobalId(0, []);

  private readonly globalToLocal: number[];

  /**
   * @param globalCount 現時点のグローバルID空間の大きさ（NameRegistry.count）。
   * @param globalIdsOrderedByLocalIndex ローカル配列の並び順そのままに並べたグローバルID列。
   */
  constructor(globalCount: number, globalIdsOrderedByLocalIndex: readonly number[]) {
    this.globalToLocal = new Array(globalCount).fill(LocalIndexByGlobalId.missing);

    for (let local = 0; local < globalIdsOrderedByLocalIndex.length; local++) {
      const global = globalIdsOrderedByLocalIndex[local];
      this.globalToLocal[global] = local;
    }
  }

  toLocal(globalId: number): number {
    if (globalId < 0 || globalId >= this.globalToLocal.length) return LocalIndexByGlobalId.missing;
    return this.globalToLocal[globalId];
  }
}
