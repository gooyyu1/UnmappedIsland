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
    /// 気候システム（ClimateSystem.md）の現在の実装について、季節の持続日数・気温・天気ごとの発生時間・
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
        private int sunnyId, clearId, cloudyId, lightRainId, heavyRainId, stormId, scorchingId;
        private int seasonId, weatherId, temperatureId, moistureId;
        private int[] seasonKinds;
        private int[] weatherKinds;

        // 季節ごとの持続日数
        private readonly Dictionary<int, Stat> seasonDuration = new Dictionary<int, Stat>();
        // 気温: 季節ごと(全体) / 季節+序盤中盤終盤ごと
        private readonly Dictionary<int, Stat> temperatureOverall = new Dictionary<int, Stat>();
        private readonly Dictionary<(int season, int third), Stat> temperatureThird = new Dictionary<(int, int), Stat>();
        // 天気ごとの発生時間（その期間の間にその天気であった合計時間。標本単位は季節インスタンス/その3等分区間で、
        // 一度も発生しなかった期間は0時間の標本として計上する）: (天気, 季節)ごと / (天気, 季節, 序盤中盤終盤)ごと
        private readonly Dictionary<(int weather, int season), Stat> weatherTimeOverall = new Dictionary<(int, int), Stat>();
        private readonly Dictionary<(int weather, int season, int third), Stat> weatherTimeThird = new Dictionary<(int, int, int), Stat>();
        // 連続降雨/連続未降雨時間: 季節ごと(全体) / 季節+序盤中盤終盤ごと
        private readonly Dictionary<int, Stat> rainStreak = new Dictionary<int, Stat>();
        private readonly Dictionary<(int season, int third), Stat> rainStreakThird = new Dictionary<(int, int), Stat>();
        private readonly Dictionary<int, Stat> nonRainStreak = new Dictionary<int, Stat>();
        private readonly Dictionary<(int season, int third), Stat> nonRainStreakThird = new Dictionary<(int, int), Stat>();
        // 試験条件（core.yamlの値そのものだが、手打ちの転記で乖離しないよう実測して求める）:
        // 季節ごとの大気水分量レート（非雨天tickでの1tickあたりの変化量）と、雨系天気ごとの自己減算量
        // （その天気のtickでの正味変化量から、その季節のレート分を差し引いたもの）。
        private readonly Dictionary<int, Stat> seasonMoistureRate = new Dictionary<int, Stat>();
        private readonly Dictionary<(int weather, int season), Stat> rainWeatherNetMoistureDelta = new Dictionary<(int, int), Stat>();

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
            clearId = codex.SymbolNames.Intern("clear");
            cloudyId = codex.SymbolNames.Intern("cloudy");
            scorchingId = codex.SymbolNames.Intern("scorching");
            lightRainId = codex.SymbolNames.Intern("light_rain");
            heavyRainId = codex.SymbolNames.Intern("heavy_rain");
            stormId = codex.SymbolNames.Intern("storm");
            seasonId = codex.PropertyNames.GetId("season");
            weatherId = codex.PropertyNames.GetId("weather");
            temperatureId = codex.PropertyNames.GetId("ambient_temperature");
            moistureId = codex.PropertyNames.GetId("atmospheric_moisture");
            seasonKinds = new[] { calmId, wetId, dryId };
            weatherKinds = new[] { scorchingId, sunnyId, clearId, cloudyId, lightRainId, heavyRainId, stormId };

            foreach (int s in seasonKinds)
            {
                seasonDuration[s] = new Stat();
                temperatureOverall[s] = new Stat();
                rainStreak[s] = new Stat();
                nonRainStreak[s] = new Stat();
                seasonMoistureRate[s] = new Stat();
                for (int third = 0; third < 3; third++)
                {
                    temperatureThird[(s, third)] = new Stat();
                    rainStreakThird[(s, third)] = new Stat();
                    nonRainStreakThird[(s, third)] = new Stat();
                }
                foreach (int w in weatherKinds)
                {
                    weatherTimeOverall[(w, s)] = new Stat();
                    for (int third = 0; third < 3; third++)
                        weatherTimeThird[(w, s, third)] = new Stat();
                }
            }
            foreach (int w in new[] { lightRainId, heavyRainId, stormId })
                foreach (int s in seasonKinds)
                    rainWeatherNetMoistureDelta[(w, s)] = new Stat();

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
                var segMoistures = new List<int>();

                void FlushSegment(bool isFirst)
                {
                    if (!isFirst) ProcessCompletedSegment(segSeason, segTemps, segWeathers, segMoistures);
                    segTemps.Clear();
                    segWeathers.Clear();
                    segMoistures.Clear();
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
                    segMoistures.Add(worldInstance.GetNumber(moistureId));
                }
                // 末尾の未完了セグメントは破棄（FlushSegmentを呼ばない）
            }

            string report = BuildReport();
            string outPath = IOPath.Combine(FindRepoRoot(coreYamlPath), "Documents", "Diagnostics", "ClimateSystemStats.md");
            File.WriteAllText(outPath, report);
            TestContext.Out.WriteLine($"Report written to: {outPath}");

            Assert.Pass($"統計レポートを {outPath} に書き出しました。");
        }

        private void ProcessCompletedSegment(int seasonSymbolId, List<double> temps, List<int> weathers, List<int> moistures)
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

            // 天気ごとの発生時間: この季節インスタンス（と、その3等分区間）の間に各天気であった合計時間。
            // 「その天気になった1回ごとの連続時間」ではない点に注意（そちらの考え方は連続降雨/未降雨時間だけが使う）。
            // 一度も発生しなかった天気も0時間の標本として必ず計上するため、nは全天気で共通
            // （=季節インスタンス数/区間数）になる。
            var occupiedTicks = new Dictionary<int, int>();
            var occupiedTicksByThird = new Dictionary<(int, int), int>();
            foreach (int w in weatherKinds)
            {
                occupiedTicks[w] = 0;
                for (int third = 0; third < 3; third++) occupiedTicksByThird[(w, third)] = 0;
            }
            for (int i = 0; i < len; i++)
            {
                int third = Math.Min(2, i * 3 / len);
                occupiedTicks[weathers[i]]++;
                occupiedTicksByThird[(weathers[i], third)]++;
            }
            foreach (int w in weatherKinds)
            {
                weatherTimeOverall[(w, seasonSymbolId)].Add(occupiedTicks[w] * 0.25);
                for (int third = 0; third < 3; third++)
                    weatherTimeThird[(w, seasonSymbolId, third)].Add(occupiedTicksByThird[(w, third)] * 0.25);
            }

            // 連続降雨/連続未降雨の時間（日単位）
            int runStart = 0;
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

            // 大気水分量レート・自己減算の実測: tickごとの変化量を、直前tickの天気（そのtickの間
            // ずっと効いていた天気）で仕分ける。境界でのクランプ（0/10000への張り付き）は変化量を
            // 真の値より小さく見せてしまうため、前後どちらかがクランプ値に達しているtickは除外する。
            for (int i = 1; i < len; i++)
            {
                int prev = moistures[i - 1];
                int curr = moistures[i];
                if (prev <= 0 || prev >= 10000 || curr <= 0 || curr >= 10000) continue;

                int delta = curr - prev;
                int governingWeather = weathers[i - 1];
                if (IsRain(governingWeather))
                    rainWeatherNetMoistureDelta[(governingWeather, seasonSymbolId)].Add(delta);
                else
                    seasonMoistureRate[seasonSymbolId].Add(delta);
            }
        }

        /// <summary>天気wの自己減算を、複数季節での(正味変化量-季節レート)をその季節での標本数で重み付け
        /// 平均して推定する。天気自身の自己減算は季節に依らない単一の値のはずなので、どの季節から
        /// 推定しても本来は同じ値になる。</summary>
        private double DeriveWeatherMoistureDecrement(int weather)
        {
            double weightedSum = 0;
            long totalCount = 0;
            foreach (int s in seasonKinds)
            {
                var net = rainWeatherNetMoistureDelta[(weather, s)];
                var rate = seasonMoistureRate[s];
                if (net.Count == 0 || rate.Count == 0) continue;
                weightedSum += (net.Mean - rate.Mean) * net.Count;
                totalCount += net.Count;
            }
            return totalCount > 0 ? weightedSum / totalCount : double.NaN;
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
            sb.AppendLine("- 天気ごとの発生時間は「その期間の間にその天気であった合計時間」。標本単位は季節インスタンス");
            sb.AppendLine("  （序盤/中盤/終盤はその3等分区間）で、一度も発生しなかった期間は**0時間の標本として計上**する。");
            sb.AppendLine("  そのためnは全天気で共通（=完了した季節インスタンス数）になる。");
            sb.AppendLine("- 連続降雨/未降雨時間は「同じ状態が連続した1回ごとの長さ」を標本とする（発生時間とは考え方が異なる）。");
            sb.AppendLine("  連続区間は、その**開始tick**が属する序盤/中盤/終盤に割り当てる（季節の境界をまたぐ区間は");
            sb.AppendLine("  境界で打ち切り、両側で計上しない）。");
            sb.AppendLine("- 標準偏差は標本標準偏差（n-1）。");
            sb.AppendLine();

            string SeasonName(int id) => codex.SymbolNames.GetName(id);
            string WeatherName(int id) => codex.SymbolNames.GetName(id);

            sb.AppendLine("## 試験条件: 大気水分量のレート・自己減算");
            sb.AppendLine();
            sb.AppendLine("以下の統計を解釈する際の前提条件。`core.yaml`の値を手で転記するのではなく、本レポートと");
            sb.AppendLine("同じシミュレーションのtickごとの変化量から実測して求めている（バランス調整のたびに");
            sb.AppendLine("転記し直す手間と、転記漏れによる`core.yaml`との乖離を避けるため）。前後どちらかのtickで");
            sb.AppendLine("大気水分量が範囲端（0/10,000）に達しているサンプルはクランプにより真の値より小さく");
            sb.AppendLine("見えるため除外している。");
            sb.AppendLine();
            sb.AppendLine("### 季節ごとの大気水分量レート（1tickあたり、非雨天時）");
            sb.AppendLine();
            foreach (int s in seasonKinds)
                sb.AppendLine($"- **{SeasonName(s)}**: {seasonMoistureRate[s].Format("")}");
            sb.AppendLine();
            sb.AppendLine("`dry`だけ標準偏差が0にならないのは測定の誤りではなく、最初の`dry`季節の10日目前後に");
            sb.AppendLine("難易度の初期補正（`ClimateSystem.md` 5.2節、+200/tickを1日間上乗せ）が重なるため");
            sb.AppendLine("（最初の`calm`季節にも同種の補正=5.1節があるが、そちらは各シードの最初のセグメントとして");
            sb.AppendLine("統計から除外されるサンプルに含まれるため表に出ない）。");
            sb.AppendLine();
            sb.AppendLine("### 天気ごとの自己減算（1tickあたり、降雨中のみ）");
            sb.AppendLine();
            sb.AppendLine("推定自己減算は、その天気の間の正味変化量（季節レート＋自己減算）から、その季節のレートを");
            sb.AppendLine("差し引いた値。天気ごとの自己減算はどの季節でも同じ値のはずなので、複数季節で推定できる");
            sb.AppendLine("場合は季節をまたいで一致することも確認できる。");
            sb.AppendLine();
            foreach (int w in new[] { lightRainId, heavyRainId, stormId })
            {
                sb.AppendLine($"#### {WeatherName(w)}");
                sb.AppendLine();
                sb.AppendLine($"- 推定自己減算: {DeriveWeatherMoistureDecrement(w):F1}");
                foreach (int s in seasonKinds)
                {
                    var net = rainWeatherNetMoistureDelta[(w, s)];
                    if (net.Count > 0)
                        sb.AppendLine($"  - {SeasonName(s)}中の正味変化量: {net.Format("")}");
                }
                sb.AppendLine();
            }

            sb.AppendLine("## 季節の持続日数");
            sb.AppendLine();
            foreach (int s in seasonKinds)
                sb.AppendLine($"- **{SeasonName(s)}**: {seasonDuration[s].Format("日")}");
            sb.AppendLine();

            var weatherOrder = weatherKinds;

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

                sb.AppendLine("### 天気ごとの発生時間（時間/期間）");
                sb.AppendLine();
                foreach (int w in weatherOrder)
                {
                    // 見出しとリストの間に空行を挟まないとPandoc等のMarkdown変換で箇条書きとして
                    // 解釈されないため、天気名は太字の段落ではなく見出しにする
                    sb.AppendLine($"#### {WeatherName(w)}");
                    sb.AppendLine();
                    sb.AppendLine($"- 全体: {weatherTimeOverall[(w, s)].Format("h")}");
                    sb.AppendLine($"- 序盤: {weatherTimeThird[(w, s, 0)].Format("h")}");
                    sb.AppendLine($"- 中盤: {weatherTimeThird[(w, s, 1)].Format("h")}");
                    sb.AppendLine($"- 終盤: {weatherTimeThird[(w, s, 2)].Format("h")}");
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
