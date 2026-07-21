using System;
using System.Collections.Generic;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// 特定の ObjectDef に閉じたローカル配列（PropertyDef[] / SlotDef[] など）と、
    /// ゲーム全体で共有されるグローバルID空間とを対応付ける表。
    ///
    /// ObjectDefごとに「持っているプロパティ／スロット」は異なるため、グローバルID空間全体を
    /// そのままインデックスに使うと大半が未使用の疎な配列になってしまう。そこで ObjectDef 側は
    /// 自分が実際に持つものだけを詰めた密なローカル配列を持ち、この表がその変換を担う。
    /// </summary>
    public sealed class LocalIndexMap
    {
        public const int Missing = -1;

        private readonly int[] globalToLocal;

        /// <param name="globalCount">現時点のグローバルID空間の大きさ（NameRegistry.Count）。</param>
        /// <param name="globalIdsOrderedByLocalIndex">ローカル配列の並び順そのままに並べたグローバルID列。</param>
        public LocalIndexMap(int globalCount, IReadOnlyList<int> globalIdsOrderedByLocalIndex)
        {
            globalToLocal = new int[globalCount];
            Array.Fill(globalToLocal, Missing);

            for (int local = 0; local < globalIdsOrderedByLocalIndex.Count; local++)
            {
                int global = globalIdsOrderedByLocalIndex[local];
                globalToLocal[global] = local;
            }
        }

        public int ToLocal(int globalId)
        {
            if ((uint)globalId >= (uint)globalToLocal.Length)
                return Missing;
            return globalToLocal[globalId];
        }

        internal static readonly LocalIndexMap Empty = new LocalIndexMap(0, Array.Empty<int>());
    }
}
