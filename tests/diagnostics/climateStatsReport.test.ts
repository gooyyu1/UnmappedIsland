import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SeasonWeatherHours } from '../../src/analysis/activityHours';
import { activityHoursOf } from '../../src/analysis/activityHours';
import { SEASON_CLIMATE } from '../../src/analysis/seasonalRain';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { World } from '../../src/domain/wrappers/World';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { describeReportRegeneration } from '../support/generatedReport';
import { Stat } from '../support/Stat';
import { loadYamlDirectory, WORLD_CODEX_DIR, worldCodexPath } from '../support/worldCodexFiles';
import { seededRng } from '../../src/domain/Rng';

/**
 * 気候システム（ClimateSystem.md）の現在の実装について、季節の持続日数・気温・天気ごとの発生時間・
 * 連続未降雨/降雨時間の統計（平均/最小/5%ile/95%ile/最大/標準偏差）を計測し、
 * `docs/diagnostics/ClimateSystemStats.md`へ書き出す。
 *
 * 気候の定数を変えた後に再生成する: `npm run stats:climate`。再生成の形は
 * `tests/support/generatedReport.ts` が持つ。
 *
 * **代わりに、生成物が今の入力より古くなっていないかは常に見る**（末尾のdescribe）。20シード×3600日の
 * シミュレーションは数分かかるので、他のレポートと違って丸ごと作り直しては比べられない。再生成する運用は
 * 1度すり抜けており（issue #775）、そのとき古い表と手書きの定数が互いにだけ一致していた。
 */

const SEED_COUNT = 20;
const SIM_DAYS = 3600; // 約40周分/シード

const REPORT_PATH = join('docs', 'diagnostics', 'ClimateSystemStats.md');

/**
 * 指紋が見る入力。**シミュレーションが読むのはworldの定義だけで、それは`core.yaml`にしかない**
 * （このテストがディレクトリ全体を読むのは、活動時間の表に土地の一覧が要るため）。
 *
 * 土地の側の変更まで指紋に含めると、食べ物を1つ足すたびに数分の再生成を要求することになる。
 * 活動時間の表が土地から読む値は、指紋ではなく**再計算そのもの**で突き合わせる（下のdescribe）。
 */
const FINGERPRINT_SOURCES = ['core.yaml'];

const FINGERPRINT_LABEL = '入力の指紋: ';

/**
 * 指紋が見る入力ファイルの中身のハッシュ。**改行はLFへ均す**——CRLFの作業ツリーで生成した指紋が、
 * LFの作業ツリーで食い違わないようにする。
 */
function inputFingerprint(): string {
  const hash = createHash('sha256');
  for (const fileName of FINGERPRINT_SOURCES)
    hash.update(readFileSync(worldCodexPath(fileName), 'utf8').replace(/\r\n/g, '\n'));
  return hash.digest('hex').slice(0, 16);
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
  append(`${FINGERPRINT_LABEL}\`${inputFingerprint()}\`（\`${FINGERPRINT_SOURCES.join('`・`')}\`）`);
  append();
  append('`npm test` がこの指紋を今の定義と突き合わせるので、**再生成しないまま入力を変えると赤くなる**。');
  append('指紋が見るのは上のファイルだけ——シミュレーションが読むのは`world`の定義で、それはそこにしか');
  append('無い。土地の明るさを読む「土地×季節ごとの活動時間」の節は、指紋ではなく再計算で突き合わせる。');
  append();
  append('## 計測方法');
  append();
  append('- 序盤/中盤/終盤 = 各季節インスタンスの実持続期間の3等分区間。');
  append(
    '- 天気ごとの発生時間 = 期間内の合計時間。発生しなかった期間も0時間の標本として計上（nは全天気共通）。',
  );
  append(
    '- 連続降雨/未降雨時間 = 同じ状態が連続した1回ごとの長さ。開始tickの区間に割り当て、季節境界で打ち切り。',
  );
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
  append(
    '（`dry`の標準偏差が0でないのは、最初の`dry`季節に難易度の初期補正=`ClimateSystem.md` 5.2節が重なるため。）',
  );
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

  append('## 土地×季節ごとの活動時間');
  append();
  append('`src/analysis/activityHours.ts`が、`core.yaml`の`hour`・`weather`の段（太陽高度と天気の透過率が');
  append('ambient_brightnessへ与える寄与）・土地ごとのambient_brightness・上の天候の出現時間（平均）から');
  append('数える（[`IlluminationSystem.md`](../engine/IlluminationSystem.md) 5節のしきい値: 移動 −5・');
  append('屋外の採取と手元の作業はともに+5）。据え付けの光源（松明・炉）は含まない。');
  append();
  append('「屋外の採取」と「手元の作業」は1列に畳んである。しきい値はどちらも+5だが見る値が違う');
  append('（採る側はlooking_brightness、作る側はhand_brightness）——据え付けの光源が無ければ両方とも土地の');
  append('ambient_brightnessをそのまま土台にするだけなので、常に同じ値になる。');
  append();

  const seasonWeatherHours: SeasonWeatherHours[] = seasonKinds.map((s) => ({
    seasonName: seasonName(s),
    durationDays: getStat(stats.seasonDuration, s).mean,
    hoursByWeather: new Map(
      weatherKinds.map((w) => [weatherName(w), getStat(stats.weatherTimeOverall, `${w},${s}`).mean] as const),
    ),
  }));

  append('| 土地 | 季節 | 移動できる | 活動できる（屋外の採取・手元の作業） |');
  append('| --- | --- | --: | --: |');
  for (const row of activityHoursOf(codex, seasonWeatherHours)) {
    append(
      `| ${row.locationName} | ${row.seasonName} | ${row.travelHoursPerDay.toFixed(1)} | ${row.activeHoursPerDay.toFixed(1)} |`,
    );
  }
  append();

  for (const s of seasonKinds) {
    append(`## ${seasonName(s)}`);
    append();

    append('### 気温（内部値）');
    append();
    appendStatTable(
      '区間',
      '',
      thirdRows(getStat(stats.temperatureOverall, s), (third) =>
        getStat(stats.temperatureThird, `${s},${third}`),
      ),
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
      thirdRows(getStat(stats.nonRainStreak, s), (third) =>
        getStat(stats.nonRainStreakThird, `${s},${third}`),
      ),
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

/** 定義から気候をシミュレートして測り、レポートの中身を作る。 */
function buildReportFromDefinitions(): string {
  // world-codex全体を読む——土地の一覧が要る活動時間表（activityHoursOf）にはlocations.yaml等が
  // 要るため。worldの定義はcore.yamlにしか無いので、シミュレーション自体への影響は無い。
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();

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
    const session = new WorldSession(codex, undefined, seededRng(seed));
    const worldInstance = new WorldObject(1, worldDef, session);
    session.adoptWorld(new World(worldInstance, codex));

    // 現在進行中のセグメント（季節が変わるまでの一区間）のバッファ
    let segSeason = worldInstance.tryGetProperty(seasonId)?.number ?? 0;
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

      const currentSeason = worldInstance.tryGetProperty(seasonId)?.number ?? 0;
      if (currentSeason !== segSeason) {
        flushSegment();
        isFirstSegment = false;
        segSeason = currentSeason;
      }

      segTemps.push(worldInstance.tryGetProperty(temperatureId)?.getEffectiveValue() ?? 0);
      segWeathers.push(worldInstance.tryGetProperty(weatherId)?.number ?? 0);
      segMoistures.push(worldInstance.tryGetProperty(moistureId)?.number ?? 0);
    }
    // 末尾の未完了セグメントは破棄（flushSegmentを呼ばない）
  }

  return buildReport(codex, seasonKinds, weatherKinds, rainWeatherKinds, stats);
}

describeReportRegeneration(REPORT_PATH, 'RUN_CLIMATE_STATS', buildReportFromDefinitions, [
  '# 気候システム統計レポート',
]);

/**
 * 生成済みの`ClimateSystemStats.md`が、今の定義より古くなっていないか。
 *
 * 再生成に数分かかるので、`npm test`では作り直さずに**入力が変わったことだけを軽く見る**。
 * シミュレーションの入力（`core.yaml`）は指紋で、定義から静的に解ける活動時間の表は再計算で。
 *
 * **見るのは古さだけで、値の妥当性は見ない。** 値は各解析の単体試験（`tests/analysis/`）と、
 * 再生成したレポートの差分が持つ。
 */
describe('気候システム統計レポートの鮮度', () => {
  const report = readFileSync(REPORT_PATH, 'utf8').split(/\r?\n/);

  it('レポートの指紋が、今の入力と一致する', () => {
    const line = report.find((candidate) => candidate.startsWith(FINGERPRINT_LABEL));
    expect(line, `'${FINGERPRINT_LABEL}'の行が見つからない`).toBeDefined();

    const recorded = /`([0-9a-f]+)`/.exec(line!)?.[1];
    expect(
      recorded,
      `${FINGERPRINT_SOURCES.join('・')}が変わっている。'npm run stats:climate'で再生成する`,
    ).toBe(inputFingerprint());
  });

  it('活動時間の表が、今の定義から数え直したものと一致する', () => {
    const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    const seasons: SeasonWeatherHours[] = SEASON_CLIMATE.map((season) => ({
      seasonName: season.name,
      durationDays: season.durationDays,
      hoursByWeather: new Map(Object.entries(season.hoursByWeather)),
    }));

    // 天候の出現時間はSEASON_CLIMATE（レポートから書き写した値）を使うので、丸めのぶんだけずれる。
    // 突き合わせたいのは「土地の明るさが動いたのに表が古いまま」なので、その桁での一致で足りる。
    for (const row of activityHoursOf(codex, seasons)) {
      const label = `${row.locationName} / ${row.seasonName}`;
      const cells = activityRowOf(report, row.locationName, row.seasonName);
      expect(row.travelHoursPerDay, `${label} の移動できる時間`).toBeCloseTo(cells.travel, 1);
      expect(row.activeHoursPerDay, `${label} の活動できる時間`).toBeCloseTo(cells.active, 1);
    }
  });
});

/** 活動時間の表から、土地×季節の1行を読む。 */
function activityRowOf(
  lines: readonly string[],
  locationName: string,
  seasonName: string,
): { travel: number; active: number } {
  const prefix = `| ${locationName} | ${seasonName} |`;
  const row = lines.find((line) => line.startsWith(prefix));
  expect(row, `行 '${prefix}' が見つからない`).toBeDefined();

  const cells = row!.split('|');
  return { travel: Number.parseFloat(cells[3]), active: Number.parseFloat(cells[4]) };
}
