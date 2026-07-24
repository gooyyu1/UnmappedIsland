import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { World } from '../../src/domain/runtime/views/World';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { SeededRng } from '../support/SeededRng';
import { loadYamlFile, worldCodexPath } from '../support/worldCodexFiles';

/**
 * 気候システム（ClimateSystem.md）の現在の実装について、季節の持続日数・気温・天気ごとの発生時間・
 * 連続未降雨/降雨時間の統計（平均/最小/5%ile/95%ile/最大/標準偏差）を計測し、
 * `Documents/Diagnostics/ClimateSystemStats.md`へ書き出す。
 *
 * 通常のテストスイート（`npm test`）には含めない: 20シード×3600日のシミュレーションに数分かかり、
 * かつ合否判定を目的とした回帰テストではなく統計の再計測が目的のため、`RUN_CLIMATE_STATS`環境変数が
 * 立っているときだけ実行されるようにしている。バランス調整で数値を変えた後、明示的に再実行してレポートを
 * 更新したい場合に使う: `npm run stats:climate`
 */

const SEED_COUNT = 20;
const SIM_DAYS = 3600; // 約40周分/シード

/**
 * 統計サンプルの集計器。標本値は全て離散的（気温は整数、水分量の変化量は定数の組み合わせ、持続時間は
 * tick数の倍数）で相異なる値の数が高々数千に収まるため、全標本を保持する代わりに値→出現回数の
 * ヒストグラムで持つ（標本数は季節あたり数百万件に達するため）。
 */
class Stat {
  private _count = 0;
  private _sum = 0;
  private _sumSq = 0;
  private _min = Number.POSITIVE_INFINITY;
  private _max = Number.NEGATIVE_INFINITY;
  private readonly histogram = new Map<number, number>();

  add(v: number): void {
    this._count++;
    this._sum += v;
    this._sumSq += v * v;
    if (v < this._min) this._min = v;
    if (v > this._max) this._max = v;
    this.histogram.set(v, (this.histogram.get(v) ?? 0) + 1);
  }

  get count(): number {
    return this._count;
  }

  get mean(): number {
    return this._count > 0 ? this._sum / this._count : NaN;
  }

  get min(): number {
    return this._count > 0 ? this._min : NaN;
  }

  get max(): number {
    return this._count > 0 ? this._max : NaN;
  }

  get stdDev(): number {
    if (this._count < 2) return NaN;
    const variance = (this._sumSq - (this._sum * this._sum) / this._count) / (this._count - 1);
    return Math.sqrt(Math.max(0, variance));
  }

  /** 最近隣法（nearest-rank）のpパーセンタイル: 昇順に並べたときceil(p×n)番目の標本値。 */
  percentile(p: number): number {
    if (this._count === 0) return NaN;
    const rank = Math.max(1, Math.ceil(p * this._count));
    let cumulative = 0;
    for (const key of [...this.histogram.keys()].sort((a, b) => a - b)) {
      cumulative += this.histogram.get(key) ?? 0;
      if (cumulative >= rank) return key;
    }
    return this._max;
  }

  tableRow(label: string, unit: string): string {
    if (this._count === 0) return `| ${label} | - | - | - | - | - | - | 0 |`;
    return (
      `| ${label} | ${this.mean.toFixed(2)}${unit} | ${this.min.toFixed(2)}${unit} | ` +
      `${this.percentile(0.05).toFixed(2)}${unit} | ${this.percentile(0.95).toFixed(2)}${unit} | ` +
      `${this.max.toFixed(2)}${unit} | ${this.stdDev.toFixed(2)} | ${this._count} |`
    );
  }
}

/**
 * 集計中の全統計。季節ごと(全体)/季節+序盤中盤終盤ごと、(天気, 季節)ごと/(天気, 季節, 序盤中盤終盤)ごと、
 * (天気, 季節)ごとの各Mapは複合キーを`${a},${b}`形式の文字列で表す。すべてのキーは
 * {@link createClimateStats} で事前に埋める（未初期化キーへのアクセスは {@link getStat} が例外にする）。
 */
interface ClimateStats {
  readonly seasonDuration: Map<number, Stat>;
  readonly temperatureOverall: Map<number, Stat>;
  readonly temperatureThird: Map<string, Stat>;
  readonly weatherTimeOverall: Map<string, Stat>;
  readonly weatherTimeThird: Map<string, Stat>;
  readonly rainStreak: Map<number, Stat>;
  readonly rainStreakThird: Map<string, Stat>;
  readonly nonRainStreak: Map<number, Stat>;
  readonly nonRainStreakThird: Map<string, Stat>;
  readonly seasonMoistureRate: Map<number, Stat>;
  readonly rainWeatherNetMoistureDelta: Map<string, Stat>;
}

function getStat<K>(map: Map<K, Stat>, key: K): Stat {
  const stat = map.get(key);
  if (stat === undefined) throw new Error(`統計キー '${String(key)}' が初期化されていません。`);
  return stat;
}

function createClimateStats(
  seasonKinds: readonly number[],
  weatherKinds: readonly number[],
  rainWeatherKinds: readonly number[],
): ClimateStats {
  const stats: ClimateStats = {
    seasonDuration: new Map(),
    temperatureOverall: new Map(),
    temperatureThird: new Map(),
    weatherTimeOverall: new Map(),
    weatherTimeThird: new Map(),
    rainStreak: new Map(),
    rainStreakThird: new Map(),
    nonRainStreak: new Map(),
    nonRainStreakThird: new Map(),
    seasonMoistureRate: new Map(),
    rainWeatherNetMoistureDelta: new Map(),
  };

  for (const s of seasonKinds) {
    stats.seasonDuration.set(s, new Stat());
    stats.temperatureOverall.set(s, new Stat());
    stats.rainStreak.set(s, new Stat());
    stats.nonRainStreak.set(s, new Stat());
    stats.seasonMoistureRate.set(s, new Stat());
    for (let third = 0; third < 3; third++) {
      stats.temperatureThird.set(`${s},${third}`, new Stat());
      stats.rainStreakThird.set(`${s},${third}`, new Stat());
      stats.nonRainStreakThird.set(`${s},${third}`, new Stat());
    }
    for (const w of weatherKinds) {
      stats.weatherTimeOverall.set(`${w},${s}`, new Stat());
      for (let third = 0; third < 3; third++) {
        stats.weatherTimeThird.set(`${w},${s},${third}`, new Stat());
      }
    }
  }
  for (const w of rainWeatherKinds) {
    for (const s of seasonKinds) {
      stats.rainWeatherNetMoistureDelta.set(`${w},${s}`, new Stat());
    }
  }

  return stats;
}

/** 1つの季節インスタンス分のtick列（segTemps/segWeathers/segMoistures）を集計へ反映する。 */
function processCompletedSegment(
  stats: ClimateStats,
  weatherKinds: readonly number[],
  isRain: (w: number) => boolean,
  seasonSymbolId: number,
  temps: readonly number[],
  weathers: readonly number[],
  moistures: readonly number[],
): void {
  const len = temps.length;
  if (len === 0) return;

  getStat(stats.seasonDuration, seasonSymbolId).add(len / 96);

  for (let i = 0; i < len; i++) {
    const third = Math.min(2, Math.trunc((i * 3) / len));
    getStat(stats.temperatureOverall, seasonSymbolId).add(temps[i]);
    getStat(stats.temperatureThird, `${seasonSymbolId},${third}`).add(temps[i]);
  }

  // 天気ごとの発生時間: この季節インスタンス（と、その3等分区間）の間に各天気であった合計時間。
  // 「その天気になった1回ごとの連続時間」ではない点に注意（そちらの考え方は連続降雨/未降雨時間だけが使う）。
  // 一度も発生しなかった天気も0時間の標本として必ず計上するため、nは全天気で共通
  // （=季節インスタンス数/区間数）になる。
  const occupiedTicks = new Map<number, number>();
  const occupiedTicksByThird = new Map<string, number>();
  for (const w of weatherKinds) {
    occupiedTicks.set(w, 0);
    for (let third = 0; third < 3; third++) occupiedTicksByThird.set(`${w},${third}`, 0);
  }
  for (let i = 0; i < len; i++) {
    const third = Math.min(2, Math.trunc((i * 3) / len));
    occupiedTicks.set(weathers[i], (occupiedTicks.get(weathers[i]) ?? 0) + 1);
    const key = `${weathers[i]},${third}`;
    occupiedTicksByThird.set(key, (occupiedTicksByThird.get(key) ?? 0) + 1);
  }
  for (const w of weatherKinds) {
    getStat(stats.weatherTimeOverall, `${w},${seasonSymbolId}`).add((occupiedTicks.get(w) ?? 0) * 0.25);
    for (let third = 0; third < 3; third++) {
      const occupied = occupiedTicksByThird.get(`${w},${third}`) ?? 0;
      getStat(stats.weatherTimeThird, `${w},${seasonSymbolId},${third}`).add(occupied * 0.25);
    }
  }

  // 連続降雨/連続未降雨の時間（日単位）
  let runStart = 0;
  for (let i = 1; i <= len; i++) {
    if (i < len && isRain(weathers[i]) === isRain(weathers[runStart])) continue;
    const runLen = i - runStart;
    const third = Math.min(2, Math.trunc((runStart * 3) / len));
    const days = runLen / 96;
    if (isRain(weathers[runStart])) {
      getStat(stats.rainStreak, seasonSymbolId).add(days);
      getStat(stats.rainStreakThird, `${seasonSymbolId},${third}`).add(days);
    } else {
      getStat(stats.nonRainStreak, seasonSymbolId).add(days);
      getStat(stats.nonRainStreakThird, `${seasonSymbolId},${third}`).add(days);
    }
    runStart = i;
  }

  // 大気水分量レート・自己減算の実測: tickごとの変化量を、直前tickの天気（そのtickの間ずっと効いていた天気）で
  // 仕分ける。境界でのクランプ（0/10000への張り付き）は変化量を真の値より小さく見せてしまうため、前後どちらかが
  // クランプ値に達しているtickは除外する。
  for (let i = 1; i < len; i++) {
    const prev = moistures[i - 1];
    const curr = moistures[i];
    if (prev <= 0 || prev >= 10000 || curr <= 0 || curr >= 10000) continue;

    const delta = curr - prev;
    const governingWeather = weathers[i - 1];
    if (isRain(governingWeather)) {
      getStat(stats.rainWeatherNetMoistureDelta, `${governingWeather},${seasonSymbolId}`).add(delta);
    } else {
      getStat(stats.seasonMoistureRate, seasonSymbolId).add(delta);
    }
  }
}

/**
 * 天気weatherの自己減算を、複数季節での(正味変化量-季節レート)をその季節での標本数で重み付け平均して
 * 推定する。天気自身の自己減算は季節に依らない単一の値のはずなので、どの季節から推定しても本来は
 * 同じ値になる。
 */
function deriveWeatherMoistureDecrement(
  stats: ClimateStats,
  seasonKinds: readonly number[],
  weather: number,
): number {
  let weightedSum = 0;
  let totalCount = 0;
  for (const s of seasonKinds) {
    const net = getStat(stats.rainWeatherNetMoistureDelta, `${weather},${s}`);
    const rate = getStat(stats.seasonMoistureRate, s);
    if (net.count === 0 || rate.count === 0) continue;
    weightedSum += (net.mean - rate.mean) * net.count;
    totalCount += net.count;
  }
  return totalCount > 0 ? weightedSum / totalCount : NaN;
}

function buildReport(
  codex: WorldCodex,
  seasonKinds: readonly number[],
  weatherKinds: readonly number[],
  rainWeatherKinds: readonly number[],
  stats: ClimateStats,
): string {
  const lines: string[] = [];
  const append = (line = ''): void => {
    lines.push(line);
  };

  append('# 気候システム統計レポート');
  append();
  append('`tests/diagnostics/climateStatsReport.test.ts` によるシミュレーション実測値のスナップショット');
  append(`（シード数 ${SEED_COUNT}、各 ${SIM_DAYS} 日）。\`core.yaml\` を変更したら以下で再生成する。`);
  append();
  append('```');
  append('npm run stats:climate');
  append('```');
  append();
  append('## 計測方法');
  append();
  append('- 序盤/中盤/終盤 = 各季節インスタンスの実持続期間の3等分区間。');
  append('- 天気ごとの発生時間 = 期間内の合計時間。発生しなかった期間も0時間の標本として計上（nは全天気共通）。');
  append('- 連続降雨/未降雨時間 = 同じ状態が連続した1回ごとの長さ。開始tickの区間に割り当て、季節境界で打ち切り。');
  append('- 標準偏差は標本標準偏差（n-1）、5%ile/95%ileは最近隣法（nearest-rank）。');
  append();

  const seasonName = (id: number): string => codex.symbolNames.getName(id);
  const weatherName = (id: number): string => codex.symbolNames.getName(id);

  const appendStatTable = (
    firstColumn: string,
    unit: string,
    rows: readonly (readonly [string, Stat])[],
  ): void => {
    append(`| ${firstColumn} | 平均 | 最小 | 5%ile | 95%ile | 最大 | 標準偏差 | n |`);
    append('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const [label, stat] of rows) append(stat.tableRow(label, unit));
    append();
  };

  const thirdRows = (overall: Stat, byThird: (third: number) => Stat): (readonly [string, Stat])[] => [
    ['全体', overall],
    ['序盤', byThird(0)],
    ['中盤', byThird(1)],
    ['終盤', byThird(2)],
  ];

  append('## 試験条件: 大気水分量のレート・自己減算');
  append();
  append('`core.yaml`の設定値の実測値（範囲端0/10,000に達したtickは除外）。');
  append();
  append('### 季節ごとの大気水分量レート（1tickあたり、非雨天時）');
  append();
  appendStatTable(
    '季節',
    '',
    seasonKinds.map((s) => [seasonName(s), getStat(stats.seasonMoistureRate, s)] as const),
  );
  append('（`dry`の標準偏差が0でないのは、最初の`dry`季節に難易度の初期補正=`ClimateSystem.md` 5.2節が重なるため。）');
  append();
  append('### 天気ごとの自己減算（1tickあたり、降雨中のみ）');
  append();
  append('推定自己減算 = その天気の間の正味変化量 − その季節のレート。');
  append();
  for (const w of rainWeatherKinds) {
    append(`#### ${weatherName(w)}`);
    append();
    const decrement = deriveWeatherMoistureDecrement(stats, seasonKinds, w);
    append(`推定自己減算: **${decrement.toFixed(1)}**。季節ごとの正味変化量:`);
    append();
    appendStatTable(
      '季節',
      '',
      seasonKinds
        .filter((s) => getStat(stats.rainWeatherNetMoistureDelta, `${w},${s}`).count > 0)
        .map((s) => [seasonName(s), getStat(stats.rainWeatherNetMoistureDelta, `${w},${s}`)] as const),
    );
  }

  append('## 季節の持続日数');
  append();
  appendStatTable(
    '季節',
    '日',
    seasonKinds.map((s) => [seasonName(s), getStat(stats.seasonDuration, s)] as const),
  );

  for (const s of seasonKinds) {
    append(`## ${seasonName(s)}`);
    append();

    append('### 気温（内部値）');
    append();
    appendStatTable(
      '区間',
      '',
      thirdRows(getStat(stats.temperatureOverall, s), (third) => getStat(stats.temperatureThird, `${s},${third}`)),
    );

    append('### 天気ごとの発生時間（時間/期間）');
    append();
    for (const w of weatherKinds) {
      // 見出しと表の間に空行を挟まないとMarkdown変換で表として解釈されないため、天気名は見出しにする
      append(`#### ${weatherName(w)}`);
      append();
      appendStatTable(
        '区間',
        'h',
        thirdRows(getStat(stats.weatherTimeOverall, `${w},${s}`), (third) =>
          getStat(stats.weatherTimeThird, `${w},${s},${third}`),
        ),
      );
    }

    append('### 連続未降雨時間（日）');
    append();
    appendStatTable(
      '区間',
      '日',
      thirdRows(getStat(stats.nonRainStreak, s), (third) => getStat(stats.nonRainStreakThird, `${s},${third}`)),
    );

    append('### 連続降雨時間（日）');
    append();
    appendStatTable(
      '区間',
      '日',
      thirdRows(getStat(stats.rainStreak, s), (third) => getStat(stats.rainStreakThird, `${s},${third}`)),
    );
  }

  return lines.join('\n') + '\n';
}

describe.runIf(process.env.RUN_CLIMATE_STATS === '1')('気候システム統計レポート', () => {
  it(
    '20シード×3600日をシミュレートしてClimateSystemStats.mdを再生成する',
    () => {
      const codex = loadYamlFile(new WorldCodexYamlLoader(), worldCodexPath('core.yaml')).build();

      const calmId = codex.symbolNames.intern('calm');
      const wetId = codex.symbolNames.intern('wet');
      const dryId = codex.symbolNames.intern('dry');
      const sunnyId = codex.symbolNames.intern('sunny');
      const clearId = codex.symbolNames.intern('clear');
      const cloudyId = codex.symbolNames.intern('cloudy');
      const scorchingId = codex.symbolNames.intern('scorching');
      const lightRainId = codex.symbolNames.intern('light_rain');
      const heavyRainId = codex.symbolNames.intern('heavy_rain');
      const stormId = codex.symbolNames.intern('storm');
      const seasonId = codex.propertyNames.getId('season');
      const weatherId = codex.propertyNames.getId('weather');
      const temperatureId = codex.propertyNames.getId('ambient_temperature');
      const moistureId = codex.propertyNames.getId('atmospheric_moisture');

      const seasonKinds = [calmId, wetId, dryId];
      const weatherKinds = [scorchingId, sunnyId, clearId, cloudyId, lightRainId, heavyRainId, stormId];
      const rainWeatherKinds = [lightRainId, heavyRainId, stormId];
      const isRain = (w: number): boolean => w === lightRainId || w === heavyRainId || w === stormId;

      const stats = createClimateStats(seasonKinds, weatherKinds, rainWeatherKinds);

      const worldDef = codex.objects.get(codex.objectNames.getId('world'));
      const totalTicks = SIM_DAYS * 96;

      for (let seed = 1; seed <= SEED_COUNT; seed++) {
        const worldInstance = new WorldObject(1, worldDef, new WorldSession(codex));
        const worldView = new World(worldInstance, codex.propertyNames);
        const session = new WorldSession(codex, worldView, new SeededRng(seed));

        // 現在進行中のセグメント（季節が変わるまでの一区間）のバッファ
        let segSeason = worldInstance.getNumber(seasonId);
        let segTemps: number[] = [];
        let segWeathers: number[] = [];
        let segMoistures: number[] = [];
        let isFirstSegment = true;

        const flushSegment = (): void => {
          if (!isFirstSegment) {
            processCompletedSegment(stats, weatherKinds, isRain, segSeason, segTemps, segWeathers, segMoistures);
          }
          segTemps = [];
          segWeathers = [];
          segMoistures = [];
        };

        for (let t = 0; t < totalTicks; t++) {
          session.advanceWorldTime(15); // minutes_per_tick分。ちょうど1tick進める

          const currentSeason = worldInstance.getNumber(seasonId);
          if (currentSeason !== segSeason) {
            flushSegment();
            isFirstSegment = false;
            segSeason = currentSeason;
          }

          segTemps.push(worldInstance.getEffectiveValue(temperatureId));
          segWeathers.push(worldInstance.getNumber(weatherId));
          segMoistures.push(worldInstance.getNumber(moistureId));
        }
        // 末尾の未完了セグメントは破棄（flushSegmentを呼ばない）
      }

      const report = buildReport(codex, seasonKinds, weatherKinds, rainWeatherKinds, stats);
      const outPath = join('Documents', 'Diagnostics', 'ClimateSystemStats.md');
      writeFileSync(outPath, report, 'utf8');
      console.log(`Report written to: ${outPath}`);

      expect(report).toContain('# 気候システム統計レポート');
    },
    600_000,
  );
});
