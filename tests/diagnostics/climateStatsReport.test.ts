import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { SeasonWeatherHours } from '../../src/analysis/activityHours';
import { activityHoursOf } from '../../src/analysis/activityHours';
import { islandLocationsOf } from '../../src/analysis/islandLocations';
import { SEASON_CLIMATE } from '../../src/analysis/seasonalRain';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { World } from '../../src/domain/wrappers/World';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import type { YamlRecord, YamlReportSection } from '../support/generatedReport';
import {
  describeDocumentedSections,
  describeYamlReportRegeneration,
  formatYamlReport,
  RoundedNumber,
  yieldToEventLoop,
} from '../support/generatedReport';
import { Stat } from '../support/Stat';
import { loadYamlDirectory, WORLD_CODEX_DIR, worldCodexPath } from '../support/worldCodexFiles';
import { seededRng } from '../../src/domain/Rng';

/**
 * 気候システム（ClimateSystem.md）の現在の実装について、季節の持続日数・気温・天気ごとの発生時間・
 * 連続未降雨/降雨時間の統計を計測し、`stats/climate.yaml`へ書き出す。
 *
 * **書き出すのは数値だけ。** 何を測ったか・引いた線・数えていないものは、手書きの
 * `docs/diagnostics/ClimateSystemStats.md` が持つ。
 *
 * 気候の定数を変えた後に再生成する: `npm run stats:climate`。再生成の形は
 * `tests/support/generatedReport.ts` が持つ。
 *
 * **代わりに、生成物が今の入力より古くなっていないかは常に見る**（末尾のdescribe）。20シード×3600日の
 * シミュレーションは分単位でかかるので、他のレポートと違って丸ごと作り直しては比べられない。再生成する
 * 運用は1度すり抜けており（issue #775）、そのとき古い表と手書きの定数が互いにだけ一致していた。
 */

const SEED_COUNT = 20;
const SIM_DAYS = 3600; // 約40周分/シード

const REPORT_PATH = join('stats', 'climate.yaml');
const DOC_PATH = join('docs', 'diagnostics', 'ClimateSystemStats.md');

/**
 * 指紋が見る入力。**シミュレーションが読むのはworldの定義だけで、それは`core.yaml`にしかない**
 * （このテストがディレクトリ全体を読むのは、活動時間の表に土地の一覧が要るため）。
 *
 * 土地の側の変更まで指紋に含めると、食べ物を1つ足すたびに数分の再生成を要求することになる。
 * 活動時間の表が土地から読む値は、指紋ではなく**再計算そのもの**で突き合わせる（下のdescribe）。
 */
const FINGERPRINT_SOURCES = ['core.yaml'];

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

/**
 * 丸めた数。**標本が足りずNaNになる値はnullで書く**——`NaN`と書くと、読む側では数ではなく文字列に
 * なって型が行ごとに変わる。
 */
function rounded(value: number, decimals = 2): RoundedNumber | null {
  return Number.isNaN(value) ? null : new RoundedNumber(value, decimals);
}

/** 分布1つのレコード。`keys`はそれが何の分布かを指す鍵（季節・天気・区間）。 */
function statRecord(keys: YamlRecord, stat: Stat): YamlRecord {
  return {
    ...keys,
    mean: rounded(stat.mean),
    min: rounded(stat.min),
    p5: rounded(stat.percentile(0.05)),
    p95: rounded(stat.percentile(0.95)),
    max: rounded(stat.max),
    sd: rounded(stat.stdDev),
    n: stat.count,
  };
}

/** 各季節インスタンスの実持続期間の3等分区間。全体を先頭に置く。 */
const SEGMENTS = ['early', 'middle', 'late'] as const;

/** 全体＋3等分区間の4レコード。 */
function segmentRecords(keys: YamlRecord, overall: Stat, byThird: (third: number) => Stat): YamlRecord[] {
  return [
    statRecord({ ...keys, segment: 'overall' }, overall),
    ...SEGMENTS.map((segment, third) => statRecord({ ...keys, segment }, byThird(third))),
  ];
}

function buildSections(
  codex: WorldCodex,
  seasonKinds: readonly number[],
  weatherKinds: readonly number[],
  rainWeatherKinds: readonly number[],
  stats: ClimateStats,
): readonly YamlReportSection[] {
  const nameOf = (id: number): string => codex.symbolNames.getName(id);

  const seasonWeatherHours: SeasonWeatherHours[] = seasonKinds.map((s) => ({
    seasonName: nameOf(s),
    durationDays: getStat(stats.seasonDuration, s).mean,
    hoursByWeather: new Map(
      weatherKinds.map((w) => [nameOf(w), getStat(stats.weatherTimeOverall, `${w},${s}`).mean] as const),
    ),
  }));

  return [
    { key: 'meta', records: [{ seeds: SEED_COUNT, days: SIM_DAYS }] },
    {
      key: 'input_fingerprint',
      records: [{ sources: FINGERPRINT_SOURCES, sha256_prefix: inputFingerprint() }],
    },
    {
      key: 'season_moisture_rate',
      records: seasonKinds.map((s) =>
        statRecord({ season: nameOf(s), unit: 'per_tick' }, getStat(stats.seasonMoistureRate, s)),
      ),
    },
    {
      key: 'rain_weather_moisture_decrement',
      records: rainWeatherKinds.map((w) => ({
        weather: nameOf(w),
        unit: 'per_tick',
        estimated: rounded(deriveWeatherMoistureDecrement(stats, seasonKinds, w), 1),
      })),
    },
    {
      key: 'rain_weather_net_moisture_delta',
      records: rainWeatherKinds.flatMap((w) =>
        seasonKinds
          .filter((s) => getStat(stats.rainWeatherNetMoistureDelta, `${w},${s}`).count > 0)
          .map((s) =>
            statRecord(
              { weather: nameOf(w), season: nameOf(s), unit: 'per_tick' },
              getStat(stats.rainWeatherNetMoistureDelta, `${w},${s}`),
            ),
          ),
      ),
    },
    {
      key: 'season_duration',
      records: seasonKinds.map((s) =>
        statRecord({ season: nameOf(s), unit: 'days' }, getStat(stats.seasonDuration, s)),
      ),
    },
    {
      key: 'activity_hours',
      records: activityHoursOf(codex, seasonWeatherHours).map((row) => ({
        location: row.locationName,
        season: row.seasonName,
        unit: 'hours',
        travel: rounded(row.travelHoursPerDay, 1),
        gathering: rounded(row.gatheringHoursPerDay, 1),
        handwork: rounded(row.handworkHoursPerDay, 1),
      })),
    },
    // 活動時間表が数えなかった土地と、外した根拠のタグ（`islandLocations`）。
    {
      key: 'excluded_locations',
      records: islandLocationsOf(codex).excludedSea.map(({ def, tag }) => ({ location: def.name, tag })),
    },
    {
      key: 'temperature',
      records: seasonKinds.flatMap((s) =>
        segmentRecords(
          { season: nameOf(s), unit: 'internal' },
          getStat(stats.temperatureOverall, s),
          (third) => getStat(stats.temperatureThird, `${s},${third}`),
        ),
      ),
    },
    {
      key: 'weather_hours',
      records: seasonKinds.flatMap((s) =>
        weatherKinds.flatMap((w) =>
          segmentRecords(
            { season: nameOf(s), weather: nameOf(w), unit: 'hours' },
            getStat(stats.weatherTimeOverall, `${w},${s}`),
            (third) => getStat(stats.weatherTimeThird, `${w},${s},${third}`),
          ),
        ),
      ),
    },
    {
      key: 'non_rain_streak',
      records: seasonKinds.flatMap((s) =>
        segmentRecords({ season: nameOf(s), unit: 'days' }, getStat(stats.nonRainStreak, s), (third) =>
          getStat(stats.nonRainStreakThird, `${s},${third}`),
        ),
      ),
    },
    {
      key: 'rain_streak',
      records: seasonKinds.flatMap((s) =>
        segmentRecords({ season: nameOf(s), unit: 'days' }, getStat(stats.rainStreak, s), (third) =>
          getStat(stats.rainStreakThird, `${s},${third}`),
        ),
      ),
    },
  ];
}

/**
 * 定義から気候をシミュレートして測り、レポートの中身を作る。
 *
 * **シードとシードの間でイベントループへ返す**（{@link yieldToEventLoop}）。1シードで1分を超えることは
 * 無いので、これで足りる。
 */
async function buildReportFromDefinitions(): Promise<string> {
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
    await yieldToEventLoop();

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

  return formatYamlReport(
    [
      '気候システムのシミュレーション実測。',
      '生成物。手で書き換えず、npm run stats:climate で作り直す。',
      '何を測ったか・引いた線・数えていないものは docs/diagnostics/ClimateSystemStats.md。',
    ],
    buildSections(codex, seasonKinds, weatherKinds, rainWeatherKinds, stats),
  );
}

const DOCUMENTED_SECTIONS = describeDocumentedSections(DOC_PATH, REPORT_PATH);

describeYamlReportRegeneration(
  REPORT_PATH,
  'RUN_CLIMATE_STATS',
  buildReportFromDefinitions,
  DOCUMENTED_SECTIONS.required,
);

/** 節がずれていたときに出す直し方。 */
const REGENERATE_HINT = "'npm run stats:climate'で再生成する";

/**
 * 生成済みの`stats/climate.yaml`が、今の定義より古くなっていないか。
 *
 * 再生成に分単位でかかるので、`npm test`では作り直さずに**入力が変わったことだけを軽く見る**。
 * シミュレーションの入力（`core.yaml`）は指紋で、定義から静的に解ける節（活動時間・外した土地）は
 * 再計算で。
 *
 * **行は両向きで突き合わせる。** 今の定義から出る行を書き出し済みの表へ探しに行くだけでは、
 * **定義から出なくなった行が表に残っても気づけない**——土地を島から外す変更は、行が増える形ではなく
 * 減る形でしか現れない。
 *
 * **見るのは古さだけで、値の妥当性は見ない。** 値は各解析の単体試験（`tests/analysis/`）と、
 * 再生成したレポートの差分が持つ。
 */
describe('climate.yamlの鮮度', () => {
  const storedReport = (): Record<string, YamlRecord[]> =>
    parse(readFileSync(REPORT_PATH, 'utf8')) as Record<string, YamlRecord[]>;

  const loadCodex = (): WorldCodex =>
    loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();

  it('レポートの指紋が、今の入力と一致する', () => {
    const recorded = storedReport().input_fingerprint[0].sha256_prefix;

    expect(recorded, `${FINGERPRINT_SOURCES.join('・')}が変わっている。${REGENERATE_HINT}`).toBe(
      inputFingerprint(),
    );
  });

  it('活動時間の節の行が、今の定義から出る行と過不足なく一致する', () => {
    const seasons: SeasonWeatherHours[] = SEASON_CLIMATE.map((season) => ({
      seasonName: season.name,
      durationDays: season.durationDays,
      hoursByWeather: new Map(Object.entries(season.hoursByWeather)),
    }));
    const rows = activityHoursOf(loadCodex(), seasons);
    const stored = storedReport().activity_hours;
    const keyOf = (location: unknown, season: unknown): string => `${String(location)} / ${String(season)}`;

    expect(
      stored.map((record) => keyOf(record.location, record.season)).sort(),
      `活動時間の行が今の定義と食い違う。${REGENERATE_HINT}`,
    ).toEqual(rows.map((row) => keyOf(row.locationName, row.seasonName)).sort());

    // 天候の出現時間はSEASON_CLIMATE（レポートから書き写した値）を使うので、丸めのぶんだけずれる。
    // 突き合わせたいのは「土地の明るさが動いたのに節が古いまま」なので、その桁での一致で足りる。
    const recordOf = new Map(stored.map((record) => [keyOf(record.location, record.season), record]));
    for (const row of rows) {
      const label = keyOf(row.locationName, row.seasonName);
      const record = recordOf.get(label)!;
      expect(row.travelHoursPerDay, `${label} の移動できる時間`).toBeCloseTo(Number(record.travel), 1);
      expect(row.gatheringHoursPerDay, `${label} の採れる時間`).toBeCloseTo(Number(record.gathering), 1);
      expect(row.handworkHoursPerDay, `${label} の手元の作業ができる時間`).toBeCloseTo(
        Number(record.handwork),
        1,
      );
    }
  });

  it('外した土地の節が、今の定義で外れるものと過不足なく一致する', () => {
    const excluded = islandLocationsOf(loadCodex()).excludedSea;

    expect(
      storedReport()
        .excluded_locations.map((record) => `${String(record.location)} / ${String(record.tag)}`)
        .sort(),
      `外した土地が今の定義と食い違う。${REGENERATE_HINT}`,
    ).toEqual(excluded.map(({ def, tag }) => `${def.name} / ${tag}`).sort());
  });
});
