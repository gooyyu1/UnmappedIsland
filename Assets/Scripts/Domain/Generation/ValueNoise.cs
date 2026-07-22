using System;

namespace UnmappedIsland.Domain.Generation
{
    /// <summary>
    /// 軸のlayered_noiseジェネレータが使う、シード付きの格子値ノイズ（value noise）。
    /// 整数格子点に整数ハッシュで[0,1)の値を置き、その間を滑らかに補間する。状態を持たない純関数で、
    /// 同じ(シード, 座標, パラメータ)は常に同じ値を返す（シード再現性の土台）。外部ライブラリに
    /// 依存しない自前実装（Unity非依存のDomain層で完結させるため）。
    /// </summary>
    public static class ValueNoise
    {
        /// <summary>
        /// [0, 1) のノイズ値。座標はSitePlacer.IslandRadiusで正規化してから周波数を掛ける
        /// （frequency=島の直径あたりの起伏の数の目安）。octavesは周波数2倍・振幅1/2で重ねる。
        /// </summary>
        public static double Sample(int seed, double x, double y, int octaves, int frequency)
        {
            double total = 0;
            double amplitude = 1;
            double amplitudeSum = 0;
            double freq = frequency;

            for (int octave = 0; octave < octaves; octave++)
            {
                total += amplitude * SampleSingle(seed + octave * 101, x / SitePlacer.IslandRadius * freq, y / SitePlacer.IslandRadius * freq);
                amplitudeSum += amplitude;
                amplitude *= 0.5;
                freq *= 2;
            }

            return total / amplitudeSum;
        }

        private static double SampleSingle(int seed, double u, double v)
        {
            int u0 = (int)Math.Floor(u);
            int v0 = (int)Math.Floor(v);
            double fu = SmoothStep(u - u0);
            double fv = SmoothStep(v - v0);

            double a = LatticeValue(seed, u0, v0);
            double b = LatticeValue(seed, u0 + 1, v0);
            double c = LatticeValue(seed, u0, v0 + 1);
            double d = LatticeValue(seed, u0 + 1, v0 + 1);

            double top = a + (b - a) * fu;
            double bottom = c + (d - c) * fu;
            return top + (bottom - top) * fv;
        }

        private static double SmoothStep(double t) => t * t * (3 - 2 * t);

        /// <summary>整数格子点(xi, yi)の[0,1)の値。乗算と xorshift による決定的な整数ハッシュ。</summary>
        private static double LatticeValue(int seed, int xi, int yi)
        {
            uint h = (uint)seed * 374761393u;
            h += (uint)xi * 668265263u;
            h += (uint)yi * 2246822519u;
            h ^= h >> 13;
            h *= 1274126177u;
            h ^= h >> 16;
            return h / 4294967296.0;
        }
    }
}
