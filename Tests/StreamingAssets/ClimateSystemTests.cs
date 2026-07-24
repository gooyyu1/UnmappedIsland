using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.StreamingAssets
{
    /// <summary>
    /// 季節・天気システム（ClimateSystem.md）が要件を満たすことを、実際のcore.yamlに対して検証する
    /// 自動テスト。天気の遷移は乱数（pickの重み付き抽選）に依存するため、複数の乱数シードで
    /// シミュレーションを行い、95%以上のシードで要件を満たせば合格とする（決定的な構造要件
    /// （季節の巡回順・初回サイクル30日固定など）は全シードで成立を要求する）。
    ///
    /// シミュレーションはworld.Instance.Tick()を直接呼ぶ（1tick=15分、1日=96tick）。minute/hourは
    /// tick駆動ではない（WorldSessionの担当）ため進まないが、気候システムはhourに依存しないため
    /// 検証には影響しない（sunlightが夜間相当で固定される分は気温比較の両辺に等しく効く）。
    /// </summary>
    [TestFixture]
    public class ClimateSystemTests
    {
        private const int TicksPerDay = 96;
        private const int SimDays = 170;   // 初回サイクル90日 + 2周目の季節2つが最長(36日×2)でも完了する長さ
        private const int SimTicks = SimDays * TicksPerDay;
        private const int SeedCount = 30;
        private const double RequiredSuccessRate = 0.95;

        private WorldCodex codex;
        private int calmId, wetId, dryId;
        private int sunnyId, cloudyId, clearId, lightRainId, heavyRainId, stormId, scorchingId;

        /// <summary>シードごとの全tickの記録。配列のインデックスiは「i+1回目のTick直後」の観測値。</summary>
        private sealed class Trace
        {
            public int Seed;
            public int[] Weather;
            public int[] Season;
            public int[] SeasonCycle;
            public int[] EffectiveTemperature;
        }

        private List<Trace> traces;

        [OneTimeSetUp]
        public void SimulateAllSeeds()
        {
            string path = FindRepoFile("Assets/StreamingAssets/WorldCodex/core.yaml");
            codex = new WorldCodexYamlLoader().LoadFromFile(path).Build();

            calmId = codex.SymbolNames.Intern("calm");
            wetId = codex.SymbolNames.Intern("wet");
            dryId = codex.SymbolNames.Intern("dry");
            sunnyId = codex.SymbolNames.Intern("sunny");
            cloudyId = codex.SymbolNames.Intern("cloudy");
            clearId = codex.SymbolNames.Intern("clear");
            scorchingId = codex.SymbolNames.Intern("scorching");
            lightRainId = codex.SymbolNames.Intern("light_rain");
            heavyRainId = codex.SymbolNames.Intern("heavy_rain");
            stormId = codex.SymbolNames.Intern("storm");

            int weatherId = codex.PropertyNames.GetId("weather");
            int seasonId = codex.PropertyNames.GetId("season");
            int seasonCycleId = codex.PropertyNames.GetId("season_cycle");
            int temperatureId = codex.PropertyNames.GetId("ambient_temperature");
            ObjectDef worldDef = codex.Objects.Get(codex.ObjectNames.GetId("world"));

            traces = new List<Trace>();
            for (int seed = 1; seed <= SeedCount; seed++)
            {
                var session = new WorldSession(codex, new Random(seed));
                var world = new WorldObject(1, worldDef, session);
                var trace = new Trace
                {
                    Seed = seed,
                    Weather = new int[SimTicks],
                    Season = new int[SimTicks],
                    SeasonCycle = new int[SimTicks],
                    EffectiveTemperature = new int[SimTicks],
                };

                for (int t = 0; t < SimTicks; t++)
                {
                    world.Tick(session);
                    trace.Weather[t] = world.GetNumber(weatherId);
                    trace.Season[t] = world.GetNumber(seasonId);
                    trace.SeasonCycle[t] = world.GetNumber(seasonCycleId);
                    trace.EffectiveTemperature[t] = world.GetEffectiveValue(temperatureId);
                }

                traces.Add(trace);
            }
        }

        private static string FindRepoFile(string relativePath)
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                string candidate = System.IO.Path.Combine(dir.FullName, relativePath);
                if (File.Exists(candidate)) return candidate;
                dir = dir.Parent;
            }
            throw new FileNotFoundException($"'{relativePath}' が祖先ディレクトリの中に見つかりませんでした。");
        }

        private bool IsRain(int weather) => weather == lightRainId || weather == heavyRainId || weather == stormId;

        /// <summary>季節の遷移点から(季節, 継続tick数)の列を組み立てる。末尾の未完了セグメントは含めない。</summary>
        private static List<(int Season, int Ticks)> CompletedSeasonSegments(int[] seasonTrace)
        {
            var segments = new List<(int, int)>();
            int start = 0;
            for (int i = 1; i < seasonTrace.Length; i++)
            {
                if (seasonTrace[i] == seasonTrace[i - 1]) continue;
                segments.Add((seasonTrace[i - 1], i - start));
                start = i;
            }
            return segments;
        }

        /// <summary>1始まりの日番号dの範囲 [firstDay, lastDay] に対応するtickインデックス範囲（両端含む）。</summary>
        private static (int First, int Last) DayRange(int firstDay, int lastDay) =>
            ((firstDay - 1) * TicksPerDay, lastDay * TicksPerDay - 1);

        /// <summary>確率的な要件をシードごとに判定し、成功率が閾値以上であることを検証する。</summary>
        private void AssertSuccessRate(string requirement, Func<Trace, string> failureReasonOrNull)
        {
            var failures = new List<string>();
            foreach (Trace trace in traces)
            {
                string reason = failureReasonOrNull(trace);
                if (reason != null) failures.Add($"seed {trace.Seed}: {reason}");
            }

            int required = (int)Math.Ceiling(SeedCount * RequiredSuccessRate);
            int successes = SeedCount - failures.Count;
            Assert.That(successes, Is.GreaterThanOrEqualTo(required),
                $"{requirement}: {SeedCount}シード中{successes}シードのみ成功（必要: {required}）。失敗内訳:\n" +
                string.Join("\n", failures));
        }

        [Test]
        public void Seasons_CycleInFixedOrder_AndFirstCycleIsFixed30Days()
        {
            // 巡回順・初回サイクルの日数は乱数に依存しない構造要件のため、全シードで成立を要求する
            foreach (Trace trace in traces)
            {
                var segments = CompletedSeasonSegments(trace.Season);
                Assert.That(segments.Count, Is.GreaterThanOrEqualTo(4), $"seed {trace.Seed}: 2周目に入るまでシミュレーションできていること");

                Assert.That(segments[0].Season, Is.EqualTo(calmId), $"seed {trace.Seed}: 開始はcalm");
                Assert.That(segments[1].Season, Is.EqualTo(wetId), $"seed {trace.Seed}: calmの次はwet");
                Assert.That(segments[2].Season, Is.EqualTo(dryId), $"seed {trace.Seed}: wetの次はdry");
                Assert.That(segments[3].Season, Is.EqualTo(calmId), $"seed {trace.Seed}: dryの次はcalmへ戻る");

                // 遷移は30日目最後のtickの中で起こるため、tick直後のサンプル上は最初のセグメントだけ
                // 1tick短く観測される（以降のセグメントは遷移tick同士の差分なのでちょうど30日になる）
                Assert.That(segments[0].Ticks, Is.EqualTo(30 * TicksPerDay - 1), $"seed {trace.Seed}: 初回calmは30日固定");
                Assert.That(segments[1].Ticks, Is.EqualTo(30 * TicksPerDay), $"seed {trace.Seed}: 初回wetは30日固定");
                Assert.That(segments[2].Ticks, Is.EqualTo(30 * TicksPerDay), $"seed {trace.Seed}: 初回dryは30日固定");

                // dry→calm遷移（1周完了、90日目最後のtick）でseason_cycleが+1される
                int firstCycleEndIndex = 90 * TicksPerDay - 1;
                Assert.That(trace.SeasonCycle[firstCycleEndIndex - 1], Is.EqualTo(0), $"seed {trace.Seed}: 1周目の間はcycle=0");
                Assert.That(trace.SeasonCycle[firstCycleEndIndex], Is.EqualTo(1), $"seed {trace.Seed}: dry→calm遷移でcycle=1");
            }
        }

        [Test]
        public void Seasons_SecondCycleDurations_AreRandomizedAmongCandidates()
        {
            var observedDurations = new HashSet<int>();
            var candidates = new[] { 24 * TicksPerDay, 30 * TicksPerDay, 36 * TicksPerDay };

            foreach (Trace trace in traces)
            {
                var segments = CompletedSeasonSegments(trace.Season);
                // 2周目以降の完了済みセグメント（初回サイクルの3つを除く）
                foreach (var (season, ticks) in segments.Skip(3))
                {
                    Assert.That(candidates, Does.Contain(ticks),
                        $"seed {trace.Seed}: 2周目の季節の長さ({ticks}tick)は候補(24/30/36日)のいずれかであること");
                    observedDurations.Add(ticks);
                }
            }

            Assert.That(observedDurations.Count, Is.GreaterThanOrEqualTo(2),
                "全シードを通して、2周目以降の季節の長さに複数の候補が実際に現れること（ランダム性の確認）");
        }

        [Test]
        public void CalmSeason_RainsRoughlyEveryFewDays_AndNeverStorms()
        {
            // 「穏やかな季節は数日間隔で雨が降る」（概ね3日に1回、大雨にはならない）。
            // 序盤補正（2日目）の影響が抜けた4日目以降の初回calm（4-30日目）で判定する。
            var (first, last) = DayRange(4, 30);

            AssertSuccessRate("calmは数日間隔で雨が降り、嵐・大雨にならない", trace =>
            {
                var rainStartTicks = new List<int>();
                for (int t = first; t <= last; t++)
                {
                    if (IsRain(trace.Weather[t]) && (t == first || !IsRain(trace.Weather[t - 1])))
                        rainStartTicks.Add(t);
                    if (trace.Weather[t] == heavyRainId || trace.Weather[t] == stormId)
                        return $"{(t / TicksPerDay) + 1}日目に大雨/嵐が発生した";
                }

                if (rainStartTicks.Count < 3 || rainStartTicks.Count > 15)
                    return $"雨イベント数が{rainStartTicks.Count}回（期待: 3〜15回、27日間で概ね3日に1回）";

                int maxGap = 0;
                int previous = first;
                foreach (int t in rainStartTicks.Append(last))
                {
                    maxGap = Math.Max(maxGap, t - previous);
                    previous = t;
                }
                if (maxGap > 8 * TicksPerDay)
                    return $"雨の間隔が最大{maxGap / (double)TicksPerDay:F1}日空いた（期待: 8日以内）";

                return null;
            });
        }

        [Test]
        public void WetSeason_MostlyRains_ButRarelyClearsUp()
        {
            // 「雨季はほとんど雨だが、稀に晴れる」。初回wet（31-60日目）で判定する。
            var (first, last) = DayRange(31, 60);
            int total = last - first + 1;

            AssertSuccessRate("wetはほとんど雨だが、稀に雨が止む", trace =>
            {
                int rainTicks = 0, nonRainTicks = 0;
                for (int t = first; t <= last; t++)
                {
                    if (IsRain(trace.Weather[t])) rainTicks++;
                    else nonRainTicks++;
                }

                double rainRatio = (double)rainTicks / total;
                if (rainRatio < 0.6)
                    return $"雨のtick比率が{rainRatio:P0}（期待: 60%以上）";
                if (nonRainTicks < 16)
                    return $"雨が止んだtickが{nonRainTicks}のみ（期待: 少なくとも1天気周期=16tick以上）";

                return null;
            });
        }

        [Test]
        public void DrySeason_MostlyClear_ButRarelyRains()
        {
            // 「乾季はほとんど晴れだが、稀に降る」。初回dry（61-90日目）で判定する。
            // 61-62日目は雨季の名残（高い水分量が抜けきるまで）の雨、71日目前後は序盤補正の雨を含むが、
            // いずれも「稀に降る」の範囲として合算で評価する。
            var (first, last) = DayRange(61, 90);
            int total = last - first + 1;

            AssertSuccessRate("dryはほとんど晴れだが、稀に雨が降る", trace =>
            {
                int rainTicks = 0, fairTicks = 0;
                for (int t = first; t <= last; t++)
                {
                    if (IsRain(trace.Weather[t])) rainTicks++;
                    else if (trace.Weather[t] == sunnyId || trace.Weather[t] == cloudyId || trace.Weather[t] == clearId
                             || trace.Weather[t] == scorchingId) fairTicks++;
                }

                double rainRatio = (double)rainTicks / total;
                if (rainRatio > 0.2)
                    return $"雨のtick比率が{rainRatio:P0}（期待: 20%以下）";
                if ((double)fairTicks / total < 0.7)
                    return $"晴れ・曇りのtick比率が{(double)fairTicks / total:P0}（期待: 70%以上）";
                if (rainTicks == 0)
                    return "乾季に一度も雨が降らなかった（期待: 稀には降る）";

                return null;
            });
        }

        [Test]
        public void SecondDay_RainsWithHighProbability()
        {
            // 序盤補正1（ClimateSystem.md 5.1節）: ゲーム開始2日目の大気水分量の底上げにより、
            // 2日目（遅くとも3日目まで）に十分高確率で雨が降る。天気は固定ではないため、確率で検証する。
            var (first, last) = DayRange(2, 3);

            AssertSuccessRate("ゲーム開始2日目（遅くとも3日目）に雨が降る", trace =>
            {
                for (int t = first; t <= last; t++)
                    if (IsRain(trace.Weather[t])) return null;
                return "2〜3日目に雨が降らなかった";
            });
        }

        [Test]
        public void FirstDrySeason_RainsAroundTenthDay()
        {
            // 序盤補正2（ClimateSystem.md 5.2節): 最初の乾季の10日目前後（絶対71日目、遅くとも73日目まで）に
            // 大気水分量の底上げにより十分高確率で雨が降る。
            var (first, last) = DayRange(71, 73);

            AssertSuccessRate("最初の乾季の10日目前後（71〜73日目）に雨が降る", trace =>
            {
                for (int t = first; t <= last; t++)
                    if (IsRain(trace.Weather[t])) return null;
                return "71〜73日目に雨が降らなかった";
            });
        }

        [Test]
        public void DrySeasonEnd_IsHotterThanWetSeasonEnd()
        {
            // 蓄熱量（thermal_level）の貯水池により、乾季は後半ほど暑く、雨季の終わりは涼しい
            // （ClimateSystem.md 3節）。季節レートは乱数に依存しないため全シードで成立を要求する。
            var (wetFirst, wetLast) = DayRange(58, 60);
            var (dryFirst, dryLast) = DayRange(88, 90);

            foreach (Trace trace in traces)
            {
                double wetEndAvg = Enumerable.Range(wetFirst, wetLast - wetFirst + 1).Average(t => trace.EffectiveTemperature[t]);
                double dryEndAvg = Enumerable.Range(dryFirst, dryLast - dryFirst + 1).Average(t => trace.EffectiveTemperature[t]);

                Assert.That(dryEndAvg, Is.GreaterThanOrEqualTo(wetEndAvg + 8),
                    $"seed {trace.Seed}: 乾季の終わり({dryEndAvg:F1})は雨季の終わり({wetEndAvg:F1})より十分暑いこと");
            }
        }

        [Test]
        public void ClearWeather_IsTheMostCommonFairWeather()
        {
            // clearは「穏やかで過ごしやすい普通の晴れ」であり、この島の標準的な天気として高頻度で
            // 出現する（ClimateSystem.md 4.3節: 晴れ系の中でclearの重みが最も大きい）。
            // 初回calm（4-30日目）と初回dry（61-90日目）で、clearが十分な割合を占めることを確認する。
            var (calmFirst, calmLast) = DayRange(4, 30);
            var (dryFirst, dryLast) = DayRange(61, 90);

            AssertSuccessRate("clearが穏やかな季節・乾季で最も多い晴れ系の天気になる", trace =>
            {
                double ClearRatio(int first, int last)
                {
                    int clearTicks = 0;
                    for (int t = first; t <= last; t++)
                        if (trace.Weather[t] == clearId) clearTicks++;
                    return (double)clearTicks / (last - first + 1);
                }

                double calmRatio = ClearRatio(calmFirst, calmLast);
                double dryRatio = ClearRatio(dryFirst, dryLast);
                if (calmRatio < 0.15)
                    return $"calm(4-30日目)のclear比率が{calmRatio:P0}（期待: 15%以上）";
                if (dryRatio < 0.15)
                    return $"dry(61-90日目)のclear比率が{dryRatio:P0}（期待: 15%以上）";

                return null;
            });
        }

        [Test]
        public void ScorchingWeather_AppearsInLateDrySeason_AndNeverInWet()
        {
            // scorching（炎天）は蓄熱量（thermal_level）がhot帯に達した乾季後半にだけ抽選へ加わる
            // （雨季後半のstormと対称の扱い、ClimateSystem.md 4.3節）。初回サイクルでは、thermal_levelが
            // hot閾値(1920)へ達するのはdry開始から20日後=絶対81日目。
            var (lateFirst, lateLast) = DayRange(81, 90);

            AssertSuccessRate("scorchingが乾季後半（81-90日目）に発生する", trace =>
            {
                for (int t = lateFirst; t <= lateLast; t++)
                    if (trace.Weather[t] == scorchingId) return null;
                return "81〜90日目にscorchingが一度も発生しなかった";
            });

            // 蓄熱量が乾季後半とその名残の期間以外で hot に達することはないため、
            // 初回calm（初期値1000=mild以下）と初回wet（0=cool）でのscorchingは構造的に不可能。
            // これは乱数に依存しないため全シードで成立を要求する。
            var (calmFirst, calmLast) = DayRange(1, 30);
            var (wetFirst, wetLast) = DayRange(31, 60);
            foreach (Trace trace in traces)
            {
                for (int t = calmFirst; t <= wetLast; t++)
                    Assert.That(trace.Weather[t], Is.Not.EqualTo(scorchingId),
                        $"seed {trace.Seed}: {t / TicksPerDay + 1}日目（初回calm/wet）にscorchingは発生し得ないはず");
            }
        }
    }
}
