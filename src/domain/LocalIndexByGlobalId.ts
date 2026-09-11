/**
 * 特定の ObjectDef に閉じたローカル配列（PropertyDef[] / SlotDef[] など）と、
 * ゲーム全体で共有されるグローバルID空間とを対応付ける表。ObjectDef側は自分が実際に持つ
 * ものだけを詰めた密なローカル配列を持ち（グローバルID直インデックスでは疎になるため）、
 * この表がその変換を担う。
 *
 * 型引数は引く側のグローバルIDの種類（{@link GlobalId}）。**名前空間ごとに別の表**なので、
 * プロパティの表へスロットのIDを渡すと型で止まる——通してしまうと、別の名前空間で同じ番号を
 * 持つ何かのローカル位置が返り、持っていないはずのものが引ける。`in out`（不変）の理由は
 * {@link NameRegistry} と同じで、外すと種類の付いた表を素の `number` の表として扱えてしまう。
 */
export class LocalIndexByGlobalId<in out Id extends number = number> {
  static readonly missing = -1;

  private readonly globalToLocal: number[];

  /**
   * @param globalCount 現時点のグローバルID空間の大きさ（NameRegistry.count）。
   * @param globalIdsOrderedByLocalIndex ローカル配列の並び順そのままに並べたグローバルID列。
   */
  constructor(globalCount: number, globalIdsOrderedByLocalIndex: readonly Id[]) {
    this.globalToLocal = new Array(globalCount).fill(LocalIndexByGlobalId.missing);

    for (let local = 0; local < globalIdsOrderedByLocalIndex.length; local++) {
      const global = globalIdsOrderedByLocalIndex[local];
      this.globalToLocal[global] = local;
    }
  }

  toLocal(globalId: Id): number {
    if (globalId < 0 || globalId >= this.globalToLocal.length) return LocalIndexByGlobalId.missing;
    return this.globalToLocal[globalId];
  }
}
