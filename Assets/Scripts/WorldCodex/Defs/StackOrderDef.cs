namespace UnmappedIsland.Codex.Defs
{
    /// <summary>
    /// 同種オブジェクトがスタックとして並ぶ際の、型ごとの並び順（例: 劣化アイテムは寿命が短いものほど、
    /// 液体容器は中身が少ないものほど「手前＝一番上に重なる」）。
    ///
    /// Ascendingは「プロパティ値が増えるほどリスト内で後ろ（末尾側）に並ぶか」を表す。「手前に重ねたい
    /// ものほどリストの末尾に置く」という規約（Slot参照）のもとでは、寿命・残量など「小さいほど手前」に
    /// したい値は Ascending=false（値が小さいものほど末尾）を指定する。
    ///
    /// このObjectDefの新規インスタンスがスタックへ加わる際の並び位置決定にのみ使う（表示専用の概念）。
    /// 一度並んだ後、値の変化に追従した再ソートは行わない（同種は同じ速度で変化する前提のため、
    /// 挿入時点の相対順序がその後も保たれる、8.4節のaccumulateのような一定速度の変化を想定）。
    /// </summary>
    public sealed class StackOrderDef
    {
        public int PropertyGlobalId { get; }
        public bool Ascending { get; }

        public StackOrderDef(int propertyGlobalId, bool ascending)
        {
            PropertyGlobalId = propertyGlobalId;
            Ascending = ascending;
        }
    }
}
