import type { NameRegistry } from './NameRegistry';

/**
 * 特定の ObjectDef に閉じたローカル配列（PropertyDef[] / SlotDef[] など）と、
 * ゲーム全体で共有されるグローバルID空間とを対応付ける表。ObjectDef側は自分が実際に持つ
 * ものだけを詰めた密なローカル配列を持ち（グローバルID直インデックスでは疎になるため）、
 * この表がその変換を担う。
 *
 * 型引数は引く側のグローバルIDの種類（{@link GlobalId}）。**名前空間ごとに別の表**なので、
 * プロパティの表へスロットのIDを渡すと型で止まる——通してしまうと、別の名前空間で同じ番号を
 * 持つ何かのローカル位置が返り、持っていないはずのものが引ける。`in out`（不変）を書く理由は
 * {@link NameRegistry} と同じ。**この表が素の `number` の表へ広げられないことを見張るのは
 * `tests/architecture/globalId.test.ts`** で、`in out` はその一手段——今は不変の
 * {@link NameRegistry} を持っていることでも同じ不変性が出るので、この2語だけを外しても広がらない。
 */
export class LocalIndexByGlobalId<in out Id extends number> {
  static readonly missing = -1;

  private readonly names: NameRegistry<Id>;
  private readonly globalToLocal: number[];

  /**
   * @param names この表が引くIDを配る名前空間。**大きさの写しではなく名前空間そのものを持つ**
   *   ——表を組むのは読み込みの途中で、名前空間はその後も伸びる。組んだ時点の大きさを持つと、
   *   後から配られたIDが全部「表の外」に落ち、**配られていない番号と見分けが付かなくなる。**
   * @param globalIdsOrderedByLocalIndex ローカル配列の並び順そのままに並べたグローバルID列。
   */
  constructor(names: NameRegistry<Id>, globalIdsOrderedByLocalIndex: readonly Id[]) {
    this.names = names;
    // 表が覆うのは自分が持つIDの範囲まで。その先は、引かれた時点で名前空間に照らして判じる。
    const size = globalIdsOrderedByLocalIndex.reduce((max, global) => Math.max(max, global + 1), 0);
    this.globalToLocal = new Array<number>(size).fill(LocalIndexByGlobalId.missing);

    for (let local = 0; local < globalIdsOrderedByLocalIndex.length; local++) {
      const global = globalIdsOrderedByLocalIndex[local];
      this.globalToLocal[global] = local;
    }
  }

  /**
   * そのグローバルIDのローカル位置。この物が宣言していなければ {@link missing}。
   *
   * **名前空間が配っていない番号は投げる。** 別の世界（別の{@link NameRegistry}）が配ったIDや、
   * 名前を経由せずに作った数は、番号としてはそのまま表を引けてしまう——**壊れたIDと「宣言されて
   * いない」は呼び手にとって別の話**で、黙って畳むと引き方の間違いが「持っていない」として通る。
   */
  toLocal(globalId: Id): number {
    if (globalId < 0 || globalId >= this.names.count)
      throw new Error(
        `グローバルID ${globalId} は、この名前空間が配った番号ではありません（配ったのは ${this.names.count} 件）。`,
      );
    return globalId < this.globalToLocal.length ? this.globalToLocal[globalId] : LocalIndexByGlobalId.missing;
  }
}
