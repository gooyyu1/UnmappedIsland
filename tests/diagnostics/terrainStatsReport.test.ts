import { join } from 'node:path';
import { activityHoursOf } from '../../src/analysis/activityHours';
import type { BaseDailyPhases, LocationTypeDay } from '../../src/analysis/dailyPhases';
import {
  dailyPhasesOf,
  locationTypeDaysOf,
  OUTDOOR_WINDOW_MINUTES,
  SURVIVAL_GATHERING_MINUTES,
  WORK_SHARES,
} from '../../src/analysis/dailyPhases';
import { SEASON_CLIMATE } from '../../src/analysis/seasonalRain';
import type { GenerationScopeDef } from '../../src/domain/generation/GenerationScopeDef';
import type { IslandMap } from '../../src/domain/generation/IslandMap';
import { generateIsland } from '../../src/domain/generation/TerrainGenerator';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import type { YamlRecord, YamlReportSection } from '../support/generatedReport';
import {
  describeDocumentedSections,
  describeReportFreshness,
  describeYamlReportRegeneration,
  formatYamlReport,
  rounded,
  shareRecord,
  statRecord,
} from '../support/generatedReport';
import { Stat } from '../support/Stat';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * パスネットワーク（TerrainGeneration.md 3.5節）の現在の実装について、土地1つあたりの道の本数
 * （連結数）などの統計を計測し、`stats/terrain.yaml`へ書き出す。
 *
 * **書き出すのは数値だけ。** 何を測ったか・引いた線・数えていないものは、手書きの
 * `docs/diagnostics/TerrainStats.md` が持つ。
 *
 * 「繋がりすぎ/繋がらなすぎ」を数値で見るためのもので、`extra_edge_detour_factor` 等を変えた後に
 * 再生成する: `npm run stats:terrain`。再生成と鮮度の形は `tests/support/generatedReport.ts` が持つ。
 * 500シードの生成は1秒で済むので、鮮度は丸ごと作り直して比べる。
 */

const SEED_COUNT = 500;

/** 次数のヒストグラムに出す本数の上限（これを超える分はまとめて `or_more`）。 */
const MAX_LISTED_DEGREE = 7;

/**
 * 拠点の選び方の呼び名のうち、他の土地への片道が平均で最も短い土地を指すもの。局面ごとの1日は
 * どの節も島ごとにこの拠点1つだけを標本にするので、そのレコードは全部これを鍵として持つ。
 */
const SHORTEST_MEAN_BASE = 'shortest_mean';

interface TerrainStats {
  /** 島1つあたり: 土地数・道の本数・平均次数・次数の標準偏差。 */
  readonly siteCount: Stat;
  readonly edgeCount: Stat;
  readonly meanDegree: Stat;
  readonly degreeStdDevPerIsland: Stat;
  /** 島1つあたりの「MSTを超える余分な道」の本数と、土地数に対する比率（%）。 */
  readonly extraEdgeCount: Stat;
  readonly extraEdgeRatio: Stat;

  /** 島1つあたりに出た土地の種類の数（同じ型がいくつあっても1と数える）。 */
  readonly typesPerIsland: Stat;
  /** 型ごと: 島1つあたりの個数（出なかった島は0として数える）。並びはYAMLの宣言順。 */
  readonly countByType: ReadonlyMap<string, Stat>;

  /** 土地1つあたり: 次数。全島の全土地をまとめた分布。 */
  readonly degree: Stat;
  /** 道1本あたり: 距離（m）・両端の高低差（m）・移動時間（分）。 */
  readonly distanceMeters: Stat;
  readonly climbMeters: Stat;
  readonly travelMinutes: Stat;

  /** 島1つあたり: 最も条件の良い拠点から見た片道（分）。 */
  readonly chosenBaseOneWayMinutes: Stat;
  /** 土地1つあたり: その土地を拠点にしたときの片道（分）。 */
  readonly anyBaseOneWayMinutes: Stat;

  /** 島1つあたり: 最も条件の良い拠点から見た、局面ごとの1日。 */
  readonly exploration: ExplorationPhaseStats;
  readonly steady: SteadyPhaseStats;
}

/** 探索の局面（島を開き切るまで）の分布。 */
interface ExplorationPhaseStats {
  /** 島の全土地を探索率100%まで開くのに要る探索時間の合計（分）。 */
  readonly explorationMinutes: Stat;
  /** 日帰りだけで開き切る行程。**成立しない島は標本に入らない**ので、nがその島数になる。 */
  readonly dayTripDays: Stat;
  readonly dayTripTravelMinutesPerDay: Stat;
  readonly dayTripExplorationMinutesPerDay: Stat;
  /** 土地ごとに安いほうを採ったときの日数と、そのうち泊まりを選んだ土地の数。 */
  readonly mixedDays: Stat;
  readonly stayOverSiteCount: Stat;
  /** 日帰りでは1分も探索が進まない土地の数。 */
  readonly dayTripImpossibleSiteCount: Stat;
}

/**
 * 定常の局面（開き切った後）の1日の分布。**定常の局面が成立しない拠点は標本に入らない**
 * （`BaseDailyPhases.steady`がundefined）ので、nがその島数になる。
 */
interface SteadyPhaseStats {
  readonly travelMinutesPerDay: Stat;
  readonly workMinutesPerDay: Stat;
  /**
   * 屋外の山1,000分あたりに要る日数。**日数を出すのはこちら**——1周回の山の量はどの島でも同じなので、
   * 島ごとの日数を平均するには、率ではなくその逆数を平均する。
   */
  readonly daysPerThousandWorkMinutes: Stat;
  /** 山の配分の呼び名 → その組の行き先。**その組の土地がある島だけ**を数えるので、nが出現数になる。 */
  readonly byShare: ReadonlyMap<string, ShareStats>;
}

/** 山の配分1つの分布。`dayShare`は、その組へ費やす日数が定常の局面に占める割合。 */
interface ShareStats {
  readonly roundTripMinutes: Stat;
  readonly workMinutesPerDay: Stat;
  readonly dayShare: Stat;
}

function addDailyPhases(stats: TerrainStats, base: BaseDailyPhases): void {
  const exploration = stats.exploration;
  exploration.explorationMinutes.add(base.exploration.explorationMinutes);
  exploration.mixedDays.add(base.exploration.mixedDays);
  exploration.stayOverSiteCount.add(base.exploration.stayOverSiteCount);
  exploration.dayTripImpossibleSiteCount.add(base.exploration.dayTripImpossibleSiteCount);
  if (base.exploration.dayTripDays !== undefined) {
    exploration.dayTripDays.add(base.exploration.dayTripDays);
    exploration.dayTripTravelMinutesPerDay.add(base.exploration.dayTripTravelMinutesPerDay!);
    exploration.dayTripExplorationMinutesPerDay.add(base.exploration.dayTripExplorationMinutesPerDay!);
  }

  if (base.steady === undefined) return;
  stats.steady.travelMinutesPerDay.add(base.steady.travelMinutesPerDay);
  stats.steady.workMinutesPerDay.add(base.steady.workMinutesPerDay);
  stats.steady.daysPerThousandWorkMinutes.add(1000 / base.steady.workMinutesPerDay);
  for (const share of base.steady.shares) {
    const stat = stats.steady.byShare.get(share.label)!;
    stat.roundTripMinutes.add(share.roundTripMinutes);
    stat.workMinutesPerDay.add(share.workMinutesPerDay);
    stat.dayShare.add(share.dayShare);
  }
}

function createStats(typeNames: readonly string[]): TerrainStats {
  return {
    siteCount: new Stat(),
    edgeCount: new Stat(),
    meanDegree: new Stat(),
    degreeStdDevPerIsland: new Stat(),
    extraEdgeCount: new Stat(),
    extraEdgeRatio: new Stat(),
    typesPerIsland: new Stat(),
    countByType: new Map(typeNames.map((name) => [name, new Stat()])),
    degree: new Stat(),
    distanceMeters: new Stat(),
    climbMeters: new Stat(),
    travelMinutes: new Stat(),
    chosenBaseOneWayMinutes: new Stat(),
    anyBaseOneWayMinutes: new Stat(),
    exploration: {
      explorationMinutes: new Stat(),
      dayTripDays: new Stat(),
      dayTripTravelMinutesPerDay: new Stat(),
      dayTripExplorationMinutesPerDay: new Stat(),
      mixedDays: new Stat(),
      stayOverSiteCount: new Stat(),
      dayTripImpossibleSiteCount: new Stat(),
    },
    steady: {
      travelMinutesPerDay: new Stat(),
      workMinutesPerDay: new Stat(),
      daysPerThousandWorkMinutes: new Stat(),
      byShare: new Map(
        WORK_SHARES.map((share) => [
          share.label,
          { roundTripMinutes: new Stat(), workMinutesPerDay: new Stat(), dayShare: new Stat() },
        ]),
      ),
    },
  };
}

function collect(
  stats: TerrainStats,
  map: IslandMap,
  scope: GenerationScopeDef,
  elevationSpan: number,
  locationDays: ReadonlyMap<number, LocationTypeDay>,
): void {
  const metersPerElevationUnit = scope.metersPerElevationUnit(elevationSpan);
  const elevationOf = (site: number): number => map.sites[site].axisValues.get(scope.elevationAxis)!;

  const n = map.sites.length;
  const degrees = new Array<number>(n).fill(0);
  for (const edge of map.edges) {
    degrees[edge.a]++;
    degrees[edge.b]++;
    stats.distanceMeters.add(edge.distanceMeters);
    stats.climbMeters.add(Math.abs(elevationOf(edge.a) - elevationOf(edge.b)) * metersPerElevationUnit);
    stats.travelMinutes.add(edge.travelMinutes);
  }

  const perIsland = new Stat();
  for (const degree of degrees) {
    stats.degree.add(degree);
    perIsland.add(degree);
  }

  stats.siteCount.add(n);
  stats.edgeCount.add(map.edges.length);
  stats.meanDegree.add(perIsland.mean);
  stats.degreeStdDevPerIsland.add(perIsland.stdDev);
  // 全土地を繋ぐのに最低限必要な道はn-1本（MST）。それを超えた分が近道・分岐として復活した辺。
  stats.extraEdgeCount.add(map.edges.length - (n - 1));
  stats.extraEdgeRatio.add(((map.edges.length - (n - 1)) / n) * 100);

  const counts = new Map<string, number>();
  for (const site of map.sites) counts.set(site.type!.name, (counts.get(site.type!.name) ?? 0) + 1);
  stats.typesPerIsland.add(counts.size);
  for (const [name, stat] of stats.countByType) stat.add(counts.get(name) ?? 0);

  const phases = dailyPhasesOf(map, locationDays);
  stats.chosenBaseOneWayMinutes.add(phases.bestBase.oneWayMinutes);
  for (const base of phases.bases) stats.anyBaseOneWayMinutes.add(base.oneWayMinutes);
  addDailyPhases(stats, phases.bestBase);
}

/** 測った項目1つぶんの、名前と単位と分布。 */
type Metric = readonly [metric: string, unit: string, stat: Stat];

/** `keys`は、測った項目より前に置く鍵（どの拠点の値か、など）。 */
function metricRecords(metrics: readonly Metric[], keys: YamlRecord = {}): YamlRecord[] {
  return metrics.map(([metric, unit, stat]) => statRecord({ ...keys, metric, unit }, stat, 'p5'));
}

function degreeHistogramRecords(degree: Stat): YamlRecord[] {
  const records: YamlRecord[] = [];
  let listed = 0;
  for (let value = 1; value <= MAX_LISTED_DEGREE; value++) {
    const share = degree.shareOf(value);
    listed += share;
    records.push(shareRecord({ degree: value, or_more: false }, share));
  }
  records.push(shareRecord({ degree: MAX_LISTED_DEGREE + 1, or_more: true }, 1 - listed));
  return records;
}

function buildSections(stats: TerrainStats): readonly YamlReportSection[] {
  return [
    { key: 'meta', records: [{ seeds: SEED_COUNT }] },
    {
      key: 'island',
      records: metricRecords([
        ['site_count', 'sites', stats.siteCount],
        ['edge_count', 'edges', stats.edgeCount],
        ['mean_degree', 'edges', stats.meanDegree],
        ['degree_sd', 'edges', stats.degreeStdDevPerIsland],
        ['extra_edge_count', 'edges', stats.extraEdgeCount],
        ['extra_edge_ratio', 'percent', stats.extraEdgeRatio],
        ['location_types', 'types', stats.typesPerIsland],
      ]),
    },
    {
      key: 'location_type_counts',
      records: [...stats.countByType].map(([location, stat]) => {
        const present = 1 - stat.shareOf(0);
        return {
          location,
          present_percent: rounded(present * 100, 1),
          mean_per_island: rounded(stat.mean, 2),
          mean_when_present: rounded(present === 0 ? 0 : stat.mean / present, 2),
          max_per_island: rounded(stat.max, 0),
        };
      }),
    },
    { key: 'site_degree', records: [statRecord({ unit: 'edges' }, stats.degree, 'p5')] },
    { key: 'site_degree_histogram', records: degreeHistogramRecords(stats.degree) },
    {
      key: 'edge',
      records: metricRecords([
        ['distance', 'meters', stats.distanceMeters],
        ['climb', 'meters', stats.climbMeters],
        ['travel', 'minutes', stats.travelMinutes],
      ]),
    },
    {
      key: 'base_one_way',
      records: [
        statRecord({ base: SHORTEST_MEAN_BASE, unit: 'minutes' }, stats.chosenBaseOneWayMinutes, 'p5'),
        statRecord({ base: 'any', unit: 'minutes' }, stats.anyBaseOneWayMinutes, 'p5'),
      ],
    },
    {
      key: 'daily_budget',
      records: [
        {
          unit: 'minutes',
          outdoor_window: OUTDOOR_WINDOW_MINUTES,
          survival_gathering: SURVIVAL_GATHERING_MINUTES,
        },
      ],
    },
    {
      key: 'exploration_phase',
      records: metricRecords(
        [
          ['exploration_minutes', 'minutes', stats.exploration.explorationMinutes],
          ['day_trip_days', 'days', stats.exploration.dayTripDays],
          ['day_trip_travel_per_day', 'minutes', stats.exploration.dayTripTravelMinutesPerDay],
          ['day_trip_exploration_per_day', 'minutes', stats.exploration.dayTripExplorationMinutesPerDay],
          ['mixed_days', 'days', stats.exploration.mixedDays],
          ['stay_over_sites', 'sites', stats.exploration.stayOverSiteCount],
          ['day_trip_impossible_sites', 'sites', stats.exploration.dayTripImpossibleSiteCount],
        ],
        { base: SHORTEST_MEAN_BASE },
      ),
    },
    {
      key: 'exploration_day_trip_islands',
      records: [
        {
          base: SHORTEST_MEAN_BASE,
          unit: 'percent',
          share: rounded((stats.exploration.dayTripDays.count / SEED_COUNT) * 100, 1),
          islands: stats.exploration.dayTripDays.count,
          seeds: SEED_COUNT,
        },
      ],
    },
    {
      key: 'steady_phase',
      records: metricRecords(
        [
          ['travel_per_day', 'minutes', stats.steady.travelMinutesPerDay],
          ['work_per_day', 'minutes', stats.steady.workMinutesPerDay],
          ['days_per_1000_work_minutes', 'days', stats.steady.daysPerThousandWorkMinutes],
        ],
        { base: SHORTEST_MEAN_BASE },
      ),
    },
    {
      key: 'steady_phase_islands',
      records: [
        {
          base: SHORTEST_MEAN_BASE,
          unit: 'percent',
          share: rounded((stats.steady.workMinutesPerDay.count / SEED_COUNT) * 100, 1),
          islands: stats.steady.workMinutesPerDay.count,
          seeds: SEED_COUNT,
        },
      ],
    },
    {
      key: 'steady_phase_by_work_share',
      records: WORK_SHARES.map((share) => {
        const stat = stats.steady.byShare.get(share.label)!;
        return {
          base: SHORTEST_MEAN_BASE,
          share: share.label,
          work_percent: rounded(share.share * 100, 0),
          round_trip_minutes: rounded(stat.roundTripMinutes.mean, 2),
          work_minutes_per_day: rounded(stat.workMinutesPerDay.mean, 2),
          day_percent: rounded(stat.dayShare.mean * 100, 1),
          islands_percent: rounded((stat.dayShare.count / SEED_COUNT) * 100, 1),
        };
      }),
    },
  ];
}

const REPORT_PATH = join('stats', 'terrain.yaml');
const DOC_PATH = join('docs', 'diagnostics', 'TerrainStats.md');

/** 定義から島を生成して測り、レポートの中身を作る。再生成と鮮度の確認が同じものを見るための1箇所。 */
function buildReportFromDefinitions(): string {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();

  const scope = codex.generation!.scopes.get('island')!;
  const elevationRange = codex.generation!.axes.get(scope.elevationAxis)!.range;
  const elevationSpan = elevationRange.max - elevationRange.min;

  const locationDays = locationTypeDaysOf(
    codex,
    activityHoursOf(
      codex,
      SEASON_CLIMATE.map((season) => ({
        seasonName: season.name,
        durationDays: season.durationDays,
        hoursByWeather: new Map(Object.entries(season.hoursByWeather)),
      })),
    ),
  );

  const stats = createStats(codex.generation!.locationTypes.map((type) => type.name));
  for (let seed = 0; seed < SEED_COUNT; seed++) {
    collect(stats, generateIsland(codex.generation, 'island', seed), scope, elevationSpan, locationDays);
  }

  return formatYamlReport(
    [
      '地形生成の実測。定義（src/assets/world-codex/*.yaml）から生成した島だけから計算した。',
      '生成物。手で書き換えず、npm run stats:terrain で作り直す。',
      '何を測ったか・引いた線・数えていないものは docs/diagnostics/TerrainStats.md。',
    ],
    buildSections(stats),
  );
}

const DOCUMENTED_SECTIONS = describeDocumentedSections(DOC_PATH, REPORT_PATH);

describeYamlReportRegeneration(
  REPORT_PATH,
  'RUN_TERRAIN_STATS',
  buildReportFromDefinitions,
  DOCUMENTED_SECTIONS.required,
);

describeReportFreshness(REPORT_PATH, 'npm run stats:terrain', buildReportFromDefinitions);
