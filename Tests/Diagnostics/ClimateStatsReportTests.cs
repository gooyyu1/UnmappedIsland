using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;
using UnmappedIsland.Domain.Runtime.Views;
using IOPath = System.IO.Path;

namespace UnmappedIsland.Diagnostics
{
    /// <summary>
    /// 気候システム（ClimateSystem.md）の現在の実装について、季節の持続日数・気温・天気ごとの持続時間・
    /// 連続未降雨/降雨時間の統計（平均/最小/最大/標準偏差）を計測し、`Documents/Diagnostics/ClimateSystemStats.md`
    /// へ書き出す。診断用レポートのテストは`Tests/Diagnostics/`に、生成されるレポート本体は
    /// `Documents/Diagnostics/`に集約する（設計ドキュメントの各領域フォルダとは別枠。README参照）。
    ///
    /// 通常のテストスイート（CIの`dotnet test`）には含めない: 20シード×3600日のシミュレーションに約1分半
    /// かかり、かつ合否判定を目的とした回帰テストではなく統計の再計測が目的のため、[Explicit]を付けて
    /// フィルタ指定時のみ実行されるようにしている。バランス調整で数値を変えた後、明示的に再実行してレポートを
    /// 更新したい場合に使う:
    ///
    ///   dotnet test Tests/Tests.csproj --filter FullyQualifiedName~ClimateStatsReportTests
    /// </summary>
    [TestFixture]
    [Explicit("統計レポートの再生成用。通常のテスト実行には含めない（約1分半かかる計測ツール）。")]
    public class ClimateStatsReportTests
    {
        private const int SeedCount = 20;
        private const int SimDays = 3600; // 約40周分/シード

        private sealed class Stat
        {
            private long count;
            private double sum;
            private double sumSq;
            private double min = double.PositiveInfinity;
            private double max = double.NegativeInfinity;

            public void Add(double v)
            {
                count++;
                sum += v;
                sumSq += v * v;
                if (v < min) min = v;
                if (v > max) max = v;
            }

            public long Count => count;
            public double Mean => count > 0 ? sum / count : double.NaN;
            public double Min => count > 0 ? min : double.NaN;
            public double Max => count > 0 ? max : double.NaN;

            public double StdDev
            {
                get
                {
                    if (count < 2) return double.NaN;
                    double variance = (sumSq - sum * sum / count) / (count - 1);
                    return Math.Sqrt(Math.Max(0, variance));
                }
            }

            public string Format(string unit) =>
                count == 0
                    ? "(サンプルなし)"
                    : $"平均 {Mean:F2}{unit} / 最小 {Min:F2}{unit} / 最大 {Max:F2}{unit} / 標準偏差 {StdDev:F2} (n={count})";
        }

        private WorldCodex codex;
        private int calmId, wetId, dryId;
        private int sunnyId, cloudyId, lightRainId, heavyRainId, stormId;
        private int seasonId, weatherId, temperatureId;
        private int[] seasonKinds;

        // 季節ごとの持続日数
        private readonly Dictionary<int, Stat> seasonDuration = new Dictionary<int, Stat>();
        // 気温: 季節ごと(全体) / 季節+序盤中盤終盤ごと
        private readonly Dictionary<int, Stat> temperatureOverall = new Dictionary<int, Stat>();
        private readonly Dictionary<(int season, int third), Stat> temperatureThird = new Dictionary<(int, int), Stat>();
        // 天気ごとの持続時間: (天気, 季節)ごと(全体) / (天気, 季節, 序盤中盤終盤)ごと
        private readonly Dictionary<(int weather, int season), Stat> weatherDurationOverall = new Dictionary<(int, int), Stat>();
        private readonly Dictionary<(int weather, int season, int third), Stat> weatherDurationThird = new Dictionary<(int, int, int), Stat>();
        // 連続降雨/連続未降雨時間: 季節ごと(全体) / 季節+序盤中盤終盤ごと
        private readonly Dictionary<int, Stat> rainStreak = new Dictionary<int, Stat>();
        private readonly Dictionary<(int season, int third), Stat> rainStreakThird = new Dictionary<(int, int), Stat>();
        private readonly Dictionary<int, Stat> nonRainStreak = new Dictionary<int, Stat>();
        private readonly Dictionary<(int season, int third), Stat> nonRainStreakThird = new Dictionary<(int, int), Stat>();

        private bool IsRain(int w) => w == lightRainId || w == heavyRainId || w == stormId;

        [Test]
        public void GenerateReport()
        {
            string coreYamlPath = FindRepoFile("Assets/StreamingAssets/WorldCodex/core.yaml");
            codex = new WorldCodexYamlLoader().LoadFromFile(coreYamlPath).Build();

            calmId = codex.SymbolNames.Intern("calm");
            wetId = codex.SymbolNames.Intern("wet");
            dryId = codex.SymbolNames.Intern("dry");
            sunnyId = codex.SymbolNames.Intern("sunny");
            cloudyId = codex.SymbolNames.Intern("cloudy");
            lightRainId = codex.SymbolNames.Intern("light_rain");
            heavyRainId = codex.SymbolNames.Intern("heavy_rain");
            stormId = codex.SymbolNames.Intern("storm");
            seasonId = codex.PropertyNames.GetId("season");
            weatherId = codex.PropertyNames.GetId("weather");
            temperatureId = codex.PropertyNames.GetId("ambient_temperature");
            seasonKinds = new[] { calmId, wetId, dryId };

            foreach (int s in seasonKinds)
            {
                seasonDuration[s] = new Stat();
                temperatureOverall[s] = new Stat();
                rainStreak[s] = new Stat();
                nonRainStreak[s] = new Stat();
                for (int third = 0; third < 3; third++)
                {
                    temperatureThird[(s, third)] = new Stat();
                    rainStreakThird[(s, third)] = new Stat();
                    nonRainStreakThird[(s, third)] = new Stat();
                }
                foreach (int w in new[] { sunnyId, cloudyId, lightRainId, heavyRainId, stormId })
                {
                    weatherDurationOverall[(w, s)] = new Stat();
                    for (int third = 0; third < 3; third++)
                        weatherDurationThird[(w, s, third)] = new Stat();
                }
            }

            ObjectDef worldDef = codex.Objects.Get(codex.ObjectNames.GetId("world"));
            int totalTicks = SimDays * 96;

            for (int seed = 1; seed <= SeedCount; seed++)
            {
                var worldInstance = new WorldObject(1, worldDef, new WorldSession(codex));
                var worldView = new World(worldInstance, codex.PropertyNames);
                var session = new WorldSession(codex, worldView, new Random(seed));

                // 現在進行中のセグメント（季節が変わるまでの一区間）のバッファ
                int segSeason = worldInstance.GetNumber(seasonId);
                var segTemps = new List<double>();
                var segWeathers = new List<int>();

                void FlushSegment(bool isFirst)
                {
                    if (!isFirst) ProcessCompletedSegment(segSeason, segTemps, segWeathers);
                    segTemps.Clear();
                    segWeathers.Clear();
                }

                bool isFirstSegment = true;
                for (int t = 0; t < totalTicks; t++)
                {
                    session.AdvanceWorldTime(15); // minutes_per_tick分。ちょうど1tick進める

                    int currentSeason = worldInstance.GetNumber(seasonId);
                    if (currentSeason != segSeason)
                    {
                        FlushSegment(isFirstSegment);
                        isFirstSegment = false;
                        segSeason = currentSeason;
                    }

                    segTemps.Add(worldInstance.GetEffectiveValue(temperatureId));
                    segWeathers.Add(worldInstance.GetNumber(weatherId));
                }
                // 末尾の未完了セグメントは破棄（FlushSegmentを呼ばない）
            }

            string report = BuildReport();
            string outPath = IOPath.Combine(FindRepoRoot(coreYamlPath), "Documents", "Diagnostics", "ClimateSystemStats.md");
            File.WriteAllText(outPath, report);
            TestContext.Out.WriteLine($"Report written to: {outPath}");

            Assert.Pass($"統計レポートを {outPath} に書き出しました。");
        }

        private void ProcessCompletedSegment(int seasonSymbolId, List<double> temps, List<int> weathers)
        {
            int len = temps.Count;
            if (len == 0) return;

            seasonDuration[seasonSymbolId].Add(len / 96.0);

            for (int i = 0; i < len; i++)
            {
                int third = Math.Min(2, i * 3 / len);
                temperatureOverall[seasonSymbolId].Add(temps[i]);
                temperatureThird[(seasonSymbolId, third)].Add(temps[i]);
            }

            // 天気ごとの持続時間（同じ天気値が連続する区間の長さ。時間単位=tick*0.25h）
            int runStart = 0;
            for (int i = 1; i <= len; i++)
            {
                if (i < len && weathers[i] == weathers[runStart]) continue;
                int runLen = i - runStart;
                int third = Math.Min(2, runStart * 3 / len);
                int w = weathers[runStart];
                double hours = runLen * 0.25;
                if (weatherDurationOverall.TryGetValue((w, seasonSymbolId), out Stat st))
                {
                    st.Add(hours);
                    weatherDurationThird[(w, seasonSymbolId, third)].Add(hours);
                }
                runStart = i;
            }

            // 連続降雨/連続未降雨の時間（日単位）
            runStart = 0;
            for (int i = 1; i <= len; i++)
            {
                if (i < len && IsRain(weathers[i]) == IsRain(weathers[runStart])) continue;
                int runLen = i - runStart;
                int third = Math.Min(2, runStart * 3 / len);
                double days = runLen / 96.0;
                if (IsRain(weathers[runStart]))
                {
                    rainStreak[seasonSymbolId].Add(days);
                    rainStreakThird[(seasonSymbolId, third)].Add(days);
                }
                else
                {
                    nonRainStreak[seasonSymbolId].Add(days);
                    nonRainStreakThird[(seasonSymbolId, third)].Add(days);
                }
                runStart = i;
            }
        }

        private string BuildReport()
        {
            var sb = new StringBuilder();
            sb.AppendLine("# 気候システム統計レポート");
            sb.AppendLine();
            sb.AppendLine("本ドキュメントは、現在の気候システム実装（`ClimateSystem.md`、`Assets/StreamingAssets/WorldCodex/core.yaml`）");
            sb.AppendLine("について、複数シードのシミュレーションで実測した統計値のスナップショットです。");
            sb.AppendLine("`Tests/Diagnostics/ClimateStatsReportTests.cs`（`[Explicit]`、通常のテスト実行には含まれない）を");
            sb.AppendLine("以下のコマンドで実行すると再生成されます。");
            sb.AppendLine();
            sb.AppendLine("```");
            sb.AppendLine("dotnet test Tests/Tests.csproj --filter FullyQualifiedName~ClimateStatsReportTests");
            sb.AppendLine("```");
            sb.AppendLine();
            sb.AppendLine("**このレポートはスナップショットであり、確定仕様ではありません。** レート・閾値等の");
            sb.AppendLine("バランス調整で数値は変わりうるため、`core.yaml`を変更した後は再生成してください。");
            sb.AppendLine();
            sb.AppendLine("## 計測方法");
            sb.AppendLine();
            sb.AppendLine($"- シード数: {SeedCount} / 1シードあたりの実測期間: {SimDays}日");
            sb.AppendLine("- `WorldSession.AdvanceWorldTime`経由でtickを進めており、hour/dayも実際のゲーム同様に進行する");
            sb.AppendLine("  （そのため気温には日照による日内変動も反映されている）。");
            sb.AppendLine("- 各シードの最初のセグメント（開始点が不明瞭）と末尾の未完了セグメントは統計から除外。");
            sb.AppendLine("- 「序盤/中盤/終盤」は、各季節インスタンス（毎回の実際の持続日数）を3等分した区間。");
            sb.AppendLine("  天気の持続時間・連続降雨/未降雨時間は、区間の**開始tick**が属する序盤/中盤/終盤に割り当てる");
            sb.AppendLine("  （季節の境界をまたぐ区間は境界で打ち切り、両側で計上しない）。");
            sb.AppendLine("- 標準偏差は標本標準偏差（n-1）。");
            sb.AppendLine();

            string SeasonName(int id) => codex.SymbolNames.GetName(id);
            string WeatherName(int id) => codex.SymbolNames.GetName(id);

            sb.AppendLine("## 季節の持続日数");
            sb.AppendLine();
            foreach (int s in seasonKinds)
                sb.AppendLine($"- **{SeasonName(s)}**: {seasonDuration[s].Format("日")}");
            sb.AppendLine();

            var weatherOrder = new[] { sunnyId, cloudyId, lightRainId, heavyRainId, stormId };

            foreach (int s in seasonKinds)
            {
                sb.AppendLine($"## {SeasonName(s)}");
                sb.AppendLine();

                sb.AppendLine("### 気温（内部値）");
                sb.AppendLine();
                sb.AppendLine($"- 全体: {temperatureOverall[s].Format("")}");
                sb.AppendLine($"- 序盤: {temperatureThird[(s, 0)].Format("")}");
                sb.AppendLine($"- 中盤: {temperatureThird[(s, 1)].Format("")}");
                sb.AppendLine($"- 終盤: {temperatureThird[(s, 2)].Format("")}");
                sb.AppendLine();

                sb.AppendLine("### 天気ごとの持続時間（時間）");
                sb.AppendLine();
                foreach (int w in weatherOrder)
                {
                    sb.AppendLine($"**{WeatherName(w)}**");
                    sb.AppendLine($"- 全体: {weatherDurationOverall[(w, s)].Format("h")}");
                    sb.AppendLine($"- 序盤: {weatherDurationThird[(w, s, 0)].Format("h")}");
                    sb.AppendLine($"- 中盤: {weatherDurationThird[(w, s, 1)].Format("h")}");
                    sb.AppendLine($"- 終盤: {weatherDurationThird[(w, s, 2)].Format("h")}");
                    sb.AppendLine();
                }

                sb.AppendLine("### 連続未降雨時間（日）");
                sb.AppendLine();
                sb.AppendLine($"- 全体: {nonRainStreak[s].Format("日")}");
                sb.AppendLine($"- 序盤: {nonRainStreakThird[(s, 0)].Format("日")}");
                sb.AppendLine($"- 中盤: {nonRainStreakThird[(s, 1)].Format("日")}");
                sb.AppendLine($"- 終盤: {nonRainStreakThird[(s, 2)].Format("日")}");
                sb.AppendLine();

                sb.AppendLine("### 連続降雨時間（日）");
                sb.AppendLine();
                sb.AppendLine($"- 全体: {rainStreak[s].Format("日")}");
                sb.AppendLine($"- 序盤: {rainStreakThird[(s, 0)].Format("日")}");
                sb.AppendLine($"- 中盤: {rainStreakThird[(s, 1)].Format("日")}");
                sb.AppendLine($"- 終盤: {rainStreakThird[(s, 2)].Format("日")}");
                sb.AppendLine();
            }

            return sb.ToString();
        }

        /// <summary>既知のファイル（core.yaml）から、祖先ディレクトリを遡ってリポジトリルートを特定する。</summary>
        private static string FindRepoRoot(string knownFilePath)
        {
            // core.yaml は "<root>/Assets/StreamingAssets/WorldCodex/core.yaml"
            var dir = new DirectoryInfo(knownFilePath).Parent; // WorldCodex
            return dir.Parent.Parent.Parent.FullName; // StreamingAssets -> Assets -> root
        }

        private static string FindRepoFile(string relativePath)
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                string candidate = IOPath.Combine(dir.FullName, relativePath);
                if (File.Exists(candidate)) return candidate;
                dir = dir.Parent;
            }
            throw new FileNotFoundException($"'{relativePath}' が祖先ディレクトリの中に見つかりませんでした。");
        }
    }
}
