import { join } from 'node:path';
import type { IslandReach, NeedReach, StartupNeedSources } from '../../src/analysis/startupReach';
import { islandReachOf, startupNeedSourcesOf } from '../../src/analysis/startupReach';
import { STARTUP_NEEDS } from '../../src/domain/generation/StartSiteSelection';
import { generateIsland } from '../../src/domain/generation/TerrainGenerator';
import type { YamlRecord, YamlReportSection } from '../support/generatedReport';
import {
  describeDocumentedSections,
  describeReportFreshness,
  describeYamlReportRegeneration,
  formatYamlReport,
  rounded,
  shareRecord,
  statRecordWith,
} from '../support/generatedReport';
import { Stat } from '../support/Stat';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * 開始地点ごとの「立ち上がりやすさ」（`src/analysis/startupReach.ts`）を多数の種で測り、
 * `stats/startup_reach.yaml`へ書き出す。
 *
 * **書き出すのは数値だけ。** 何を測ったか・引いた線・数えていないものは、手書きの
 * `docs/diagnostics/StartupReachStats.md` が持つ。この試験は文章を1行も持たない——生成物に散文を
 * 混ぜると、読み方を直すたびに再生成が要る。
 *
 * 生成と発見物の配りを触ったときに散らばりがどう動いたかを差分で読むためのもので、触った後に
 * 再生成する: `npm run stats:startup`。再生成と鮮度の形は `tests/support/generatedReport.ts` が持つ。
 * 2,000シードの計測は数秒で済むので、鮮度は丸ごと作り直して比べる。
 */

/**
 * 回す種の数。**平均ではなく散らばりの端が落ち着く数で取る**——2026-09-13に測ったところ、開始地点の
 * 歩数の最大は500個で4・1,000個で5・2,000個で6・5,000個でも6、道を見つける探索時間の最大も
 * 2,000個以降は動かなかった。平均だけなら500個で足りるが、この表が見たいのは端の方
 * （ContentSkeleton.md 2.3.3節）。
 */
const SEED_COUNT = 2000;

/** 歩数のヒストグラムに出す上限（これを超える分はまとめて `or_more`）。 */
const MAX_LISTED_HOPS = 5;

/** このレポートの分布レコード。**真ん中の位置を見る**表なので、真ん中の列は`median`。 */
const statRecord = statRecordWith('median');

/** 要るもの1つに対する、サイトをまたいだ集計。 */
interface NeedStats {
  readonly hops: Stat;
  readonly travelMinutes: Stat;
  readonly pathDiscoveryMinutes: Stat;

  /** そのサイト数のうち、島のどこをたどっても届かなかったサイト数。 */
  unreachableSiteCount: number;
}

interface StartupReachStats {
  /** 全島の全サイト: 要るものごと（並びはSTARTUP_NEEDSと同じ）。 */
  readonly perNeed: readonly NeedStats[];

  /** 全島の全サイト: 最も遠い要るもの（＝全部が揃うまで）。 */
  readonly farthest: NeedStats;

  /** 全島の全サイト: 最も遠かった要るものの回数（並びはSTARTUP_NEEDSと同じ）。 */
  readonly farthestNeedCounts: number[];

  /** 土地の型ごと: そこから始めた場合の、全部が揃うまでの歩数。並びは出現順。 */
  readonly farthestHopsByLocation: Map<string, Stat>;

  /** 島ごと: 選抜が選んだ開始地点の、全部が揃うまで。 */
  readonly start: NeedStats;

  /** 島ごと: 選抜が選んだ開始地点の、要るものごと（並びはSTARTUP_NEEDSと同じ）。 */
  readonly startPerNeed: readonly NeedStats[];

  /** 島ごと: 選抜が選んだ開始地点の土地の型の回数。 */
  readonly startLocationCounts: Map<string, number>;

  /** 島ごと: その要るものが島のどこでも採れなかった島の数（並びはSTARTUP_NEEDSと同じ）。 */
  readonly missingIslandCounts: number[];

  /** 島ごと: 選抜が選んだ開始地点からでも届かない要るものがある島の数。 */
  islandsWithUnreachableCount: number;

  islandCount: number;
  siteCount: number;
}

function createNeedStats(): NeedStats {
  return {
    hops: new Stat(),
    travelMinutes: new Stat(),
    pathDiscoveryMinutes: new Stat(),
    unreachableSiteCount: 0,
  };
}

function createStats(): StartupReachStats {
  return {
    perNeed: STARTUP_NEEDS.map(() => createNeedStats()),
    farthest: createNeedStats(),
    farthestNeedCounts: STARTUP_NEEDS.map(() => 0),
    farthestHopsByLocation: new Map(),
    start: createNeedStats(),
    startPerNeed: STARTUP_NEEDS.map(() => createNeedStats()),
    startLocationCounts: new Map(),
    missingIslandCounts: STARTUP_NEEDS.map(() => 0),
    islandsWithUnreachableCount: 0,
    islandCount: 0,
    siteCount: 0,
  };
}

function collect(stats: StartupReachStats, reach: IslandReach): void {
  stats.islandCount++;
  for (const needIndex of reach.missingNeedIndices) stats.missingIslandCounts[needIndex]++;

  for (const site of reach.sites) {
    stats.siteCount++;
    for (const [needIndex, need] of site.needs.entries()) addReach(stats.perNeed[needIndex], need);

    const farthest = site.farthestNeed;
    if (site.unreachableNeedCount > 0 || farthest === undefined) {
      stats.farthest.unreachableSiteCount++;
      continue;
    }

    addReach(stats.farthest, farthest);
    stats.farthestNeedCounts[site.farthestNeedIndex!]++;

    const byLocation = stats.farthestHopsByLocation.get(site.locationDefName) ?? new Stat();
    byLocation.add(farthest.hops);
    stats.farthestHopsByLocation.set(site.locationDefName, byLocation);
  }

  const start = reach.startSite;
  stats.startLocationCounts.set(
    start.locationDefName,
    (stats.startLocationCounts.get(start.locationDefName) ?? 0) + 1,
  );
  for (const [needIndex, need] of start.needs.entries()) addReach(stats.startPerNeed[needIndex], need);

  if (start.unreachableNeedCount > 0 || start.farthestNeed === undefined) {
    stats.islandsWithUnreachableCount++;
    stats.start.unreachableSiteCount++;
    return;
  }
  addReach(stats.start, start.farthestNeed);
}

/** 届いていれば3つの数を、届いていなければ届かなかった回数を数える。 */
function addReach(stats: NeedStats, reach: NeedReach | undefined): void {
  if (reach === undefined) {
    stats.unreachableSiteCount++;
    return;
  }
  stats.hops.add(reach.hops);
  stats.travelMinutes.add(reach.travelMinutes);
  stats.pathDiscoveryMinutes.add(reach.pathDiscoveryMinutes);
}

/**
 * 要るもの1つに対して必ず出る3つの測り方。`measure`はレコードの中で何を測ったかを名乗る値で、
 * `unit`はその数の単位（`n`と件数は単位を持たない）。
 */
const MEASURES = [
  { measure: 'hops', unit: 'hops', statOf: (need: NeedStats): Stat => need.hops },
  { measure: 'travel', unit: 'minutes', statOf: (need: NeedStats): Stat => need.travelMinutes },
  {
    measure: 'path_discovery',
    unit: 'minutes',
    statOf: (need: NeedStats): Stat => need.pathDiscoveryMinutes,
  },
] as const;

/** 同じ鍵に対する3つの測り方のレコード。 */
function statRecords(keys: YamlRecord, stats: NeedStats): YamlRecord[] {
  return MEASURES.map(({ measure, unit, statOf }) => statRecord({ ...keys, measure, unit }, statOf(stats)));
}

function hopsHistogramRecords(stat: Stat): YamlRecord[] {
  const records: YamlRecord[] = [];
  let listed = 0;
  for (let hops = 0; hops <= MAX_LISTED_HOPS; hops++) {
    const share = stat.shareOf(hops);
    listed += share;
    records.push(shareRecord({ hops, or_more: false }, share));
  }
  records.push(shareRecord({ hops: MAX_LISTED_HOPS + 1, or_more: true }, 1 - listed));
  return records;
}

function buildSections(sources: StartupNeedSources, stats: StartupReachStats): readonly YamlReportSection[] {
  const farthestTotal = stats.farthestNeedCounts.reduce((sum, count) => sum + count, 0);
  return [
    {
      key: 'meta',
      records: [{ seeds: SEED_COUNT, islands: stats.islandCount, sites: stats.siteCount }],
    },
    {
      key: 'need_sources',
      records: sources.rows.map((row) => ({
        need: STARTUP_NEEDS[row.needIndex].label,
        object: row.objectName,
        location: row.locationDefName,
        unit: 'items_per_explore',
        expected: rounded(row.expectedPerExplore, 3),
      })),
    },
    {
      key: 'location_supplies',
      records: [...sources.byLocationDef.values()].map((supply) => ({
        location: supply.locationDefName,
        needs: [...supply.needIndices].sort((a, b) => a - b).map((i) => STARTUP_NEEDS[i].label),
        unit: 'minutes',
        path_discovery: supply.pathDiscoveryMinutes,
      })),
    },
    {
      key: 'site_reach_by_need',
      records: STARTUP_NEEDS.flatMap((need, index) =>
        statRecords({ need: need.label }, stats.perNeed[index]),
      ),
    },
    {
      key: 'site_unreachable_by_need',
      records: STARTUP_NEEDS.map((need, index) =>
        shareRecord({ need: need.label }, stats.perNeed[index].unreachableSiteCount / stats.siteCount),
      ),
    },
    { key: 'site_all_needs', records: statRecords({}, stats.farthest) },
    { key: 'site_all_needs_hops_histogram', records: hopsHistogramRecords(stats.farthest.hops) },
    {
      key: 'site_last_need',
      records: STARTUP_NEEDS.map((need, index) =>
        shareRecord({ need: need.label }, stats.farthestNeedCounts[index] / farthestTotal),
      ),
    },
    {
      key: 'site_all_needs_hops_by_start_location',
      records: [...stats.farthestHopsByLocation]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([location, stat]) => statRecord({ location, measure: 'hops', unit: 'hops' }, stat)),
    },
    { key: 'island_start_site', records: statRecords({}, stats.start) },
    { key: 'island_start_site_hops_histogram', records: hopsHistogramRecords(stats.start.hops) },
    {
      key: 'island_start_site_by_need',
      records: STARTUP_NEEDS.flatMap((need, index) =>
        statRecords({ need: need.label }, stats.startPerNeed[index]),
      ),
    },
    {
      key: 'island_missing_need',
      records: STARTUP_NEEDS.map((need, index) =>
        shareRecord({ need: need.label }, stats.missingIslandCounts[index] / stats.islandCount),
      ),
    },
    {
      key: 'island_start_site_unreachable',
      records: [shareRecord({}, stats.islandsWithUnreachableCount / stats.islandCount)],
    },
    {
      key: 'island_start_site_locations',
      records: [...stats.startLocationCounts]
        .sort((a, b) => b[1] - a[1])
        .map(([location, count]) => shareRecord({ location }, count / stats.islandCount)),
    },
  ];
}

const REPORT_PATH = join('stats', 'startup_reach.yaml');
const DOC_PATH = join('docs', 'diagnostics', 'StartupReachStats.md');

/** 定義から島を生成して測り、レポートの中身を作る。再生成と鮮度の確認が同じものを見るための1箇所。 */
function buildReportFromDefinitions(): string {
  const codex = bundledCodex();
  const sources = startupNeedSourcesOf(codex);

  const stats = createStats();
  for (let seed = 0; seed < SEED_COUNT; seed++)
    collect(stats, islandReachOf(sources, generateIsland(codex.generation, 'island', seed)));

  return formatYamlReport(
    [
      '開始地点ごとの「立ち上がりやすさ」。定義（src/assets/world-codex/*.yaml）と生成された島だけから計算した。',
      '生成物。手で書き換えず、npm run stats:startup で作り直す。',
      '何を測ったか・引いた線・数えていないものは docs/diagnostics/StartupReachStats.md。',
    ],
    buildSections(sources, stats),
  );
}

const DOCUMENTED_SECTIONS = describeDocumentedSections(DOC_PATH, REPORT_PATH);

describeYamlReportRegeneration(
  REPORT_PATH,
  'RUN_STARTUP_REACH_STATS',
  buildReportFromDefinitions,
  DOCUMENTED_SECTIONS.required,
);

describeReportFreshness(REPORT_PATH, 'npm run stats:startup', buildReportFromDefinitions);
