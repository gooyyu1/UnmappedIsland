namespace UnmappedIsland.Domain.Generation
{
    /// <summary>
    /// 地形生成専用の決定的な擬似乱数生成器（PCG-XSH-RR 32bit）。
    ///
    /// System.Randomを使わないのは、(a)実装がランタイム/バージョンに依存し「同じシード→同じ島」の
    /// 再現保証に使えないため、(b)WorldSession.Rng（pickの抽選・初期値ロール）と乱数源を分離する
    /// ことで、他の抽選の消費順序に依らず地形レイアウトが決定的であることを保証するため。
    /// </summary>
    public sealed class Pcg32
    {
        private const ulong Multiplier = 6364136223846793005UL;
        private const ulong Increment = 1442695040888963407UL;

        private ulong state;

        public Pcg32(int seed)
        {
            state = 0UL;
            NextUInt();
            state += (uint)seed;
            NextUInt();
        }

        public uint NextUInt()
        {
            ulong old = state;
            state = old * Multiplier + Increment;
            uint xorshifted = (uint)(((old >> 18) ^ old) >> 27);
            int rot = (int)(old >> 59);
            return (xorshifted >> rot) | (xorshifted << (-rot & 31));
        }

        /// <summary>[0, 1) の一様乱数。</summary>
        public double NextDouble() => NextUInt() / 4294967296.0;

        /// <summary>[minInclusive, maxInclusive] の一様な整数。</summary>
        public int NextInt(int minInclusive, int maxInclusive)
        {
            int span = maxInclusive - minInclusive + 1;
            return minInclusive + (int)(NextDouble() * span);
        }
    }
}
