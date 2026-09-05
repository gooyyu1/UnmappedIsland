import { join } from 'node:path';
import type { EscapeReachSources, EscapeReach } from '../../src/analysis/escapeReach';
import { escapeReachSourcesOf, islandEscapeReachOf } from '../../src/analysis/escapeReach';
import { generateIsland } from '../../src/domain/generation/TerrainGenerator';
import type { YamlReportSection } from '../support/generatedReport';
import {
  describeDocumentedSections,
  describeReportFreshness,
  describeYamlReportRegeneration,
  formatYamlReport,
  shareRecord,
  statRecordWith,
} from '../support/generatedReport';
import { Stat } from '../support/Stat';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * 島を出るのに要るものの鎖が、**生成された島ごとに閉じているか**を多数の種で数え
 * （`src/analysis/escapeReach.ts`）、`stats/island_escape_reach.yaml`へ書き出す。
 *
 * 定義の上で鎖が閉じることは `stats/escape_reach.yaml` が見る。こちらが足すのは**島は土地の型を
 * 取りこぼす**という軸で、鎖が5種類の土地に分かれて要求される以上、閉じた鎖でも落ちる島は在りうる。
 *
 * **しきい値は置かず、数字だけを出す**（`startupReachStatsReport`と同じ）。出られない島が在ってよいか、
 * 直すなら生成の側か材料の出どころかを決めるのは、この数字が出てからで、レポートの側が先に決めて
 * しまうと、決める材料がレポートの判定に汚染される。
 *
 * **書き出すのは数値だけ。** 何を数えたか・引いた線・数えていないものは、手書きの
 * `docs/diagnostics/IslandEscapeReachStats.md` が持つ。工程・土地の発見物・生成の定義を触った後に
 * 再生成する: `npm run stats:escape-islands`。再生成と鮮度の形は `tests/support/generatedReport.ts` が
 * 持つ。2,000シードでも2秒で済むので、鮮度は丸ごと作り直して比べる。
 */

/**
 * 回す種の数。**`startup_reach.yaml`と同じ2,000**——同じ島の配りを別の軸から測る表なので、母数が
 * 違うと2つの割合を並べて読めない。出られない島の割合は1,000個で0.1ポイントまで落ち着き、
 * 10,000個まで伸ばしても動くのは小数第2位だけ。
 */
const SEED_COUNT = 2000;

/** このレポートの分布レコード。**真ん中の位置を見る**表なので、真ん中の列は`median`。 */
const statRecord = statRecordWith('median');

/** 島を出るのに要るもの1つ（目標そのもの）。 */
interface Goal {
  readonly objectName: string;
  readonly tagName: string;
}

interface IslandEscapeStats {
  islandCount: number;

  /** 島が持っていた土地の型の数。 */
  readonly departureCount: Stat;

  /** 島に無かった土地の型の回数（鍵は土地、並びは宣言順）。 */
  readonly missingLocationCounts: Map<string, number>;

  /** 要るものが1つでも届かなかった島の数。**＝島を出られない島の数**（下の`goalUnreachedCounts`参照）。 */
  unreachedIslandCount: number;

  /** 目標そのものが届かなかった島の数（鍵は目標の型）。 */
  readonly goalUnreachedCounts: Map<string, number>;

  /** 目標そのものが届いた島での工程数（鍵は目標の型）。 */
  readonly goalHops: Map<string, Stat>;

  /** 届かなかった型ごとの島の数。目標へ至る鎖のどこが切れたかを指す。 */
  readonly unreachedNeedCounts: Map<string, number>;
}

function createStats(sources: EscapeReachSources, goals: readonly Goal[]): IslandEscapeStats {
  return {
    islandCount: 0,
    departureCount: new Stat(),
    missingLocationCounts: new Map(sources.locations.island.map((def) => [def.name, 0])),
    unreachedIslandCount: 0,
    goalUnreachedCounts: new Map(goals.map((goal) => [goal.objectName, 0])),
    goalHops: new Map(goals.map((goal) => [goal.objectName, new Stat()])),
    unreachedNeedCounts: new Map(),
  };
}

function collect(stats: IslandEscapeStats, reach: EscapeReach): void {
  stats.islandCount++;
  stats.departureCount.add(reach.departureObjectNames.length);

  const present = new Set(reach.departureObjectNames);
  for (const [location, count] of stats.missingLocationCounts)
    if (!present.has(location)) stats.missingLocationCounts.set(location, count + 1);

  if (reach.unreachedNeeds.length > 0) stats.unreachedIslandCount++;
  for (const need of reach.unreachedNeeds)
    stats.unreachedNeedCounts.set(need.objectName, (stats.unreachedNeedCounts.get(need.objectName) ?? 0) + 1);

  for (const need of reach.needs) {
    if (need.goalTagName === undefined) continue;
    if (need.reach === undefined)
      stats.goalUnreachedCounts.set(
        need.objectName,
        (stats.goalUnreachedCounts.get(need.objectName) ?? 0) + 1,
      );
    else stats.goalHops.get(need.objectName)?.add(need.reach.hops);
  }
}

function buildSections(
  sources: EscapeReachSources,
  goals: readonly Goal[],
  stats: IslandEscapeStats,
): readonly YamlReportSection[] {
  const shareOfIslands = (count: number): number => count / stats.islandCount;
  return [
    {
      key: 'meta',
      records: [
        {
          seeds: SEED_COUNT,
          islands: stats.islandCount,
          defined_locations: sources.locations.island.length,
          goals: goals.length,
        },
      ],
    },
    {
      key: 'island_departure',
      records: [statRecord({ measure: 'locations', unit: 'locations' }, stats.departureCount)],
    },
    {
      key: 'island_missing_location',
      records: [...stats.missingLocationCounts].map(([location, count]) =>
        shareRecord({ location }, shareOfIslands(count)),
      ),
    },
    {
      key: 'island_unreached',
      records: [shareRecord({}, shareOfIslands(stats.unreachedIslandCount))],
    },
    {
      key: 'island_goal_unreached',
      records: goals.map((goal) =>
        shareRecord(
          { object: goal.objectName, goal_tag: goal.tagName },
          shareOfIslands(stats.goalUnreachedCounts.get(goal.objectName) ?? 0),
        ),
      ),
    },
    {
      key: 'island_goal_hops',
      records: goals.map((goal) =>
        statRecord(
          { object: goal.objectName, goal_tag: goal.tagName, measure: 'hops', unit: 'hops' },
          stats.goalHops.get(goal.objectName) ?? new Stat(),
        ),
      ),
    },
    {
      key: 'island_unreached_need',
      records: [...stats.unreachedNeedCounts]
        .sort((a, b) => (a[1] !== b[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
        .map(([object, count]) => shareRecord({ object }, shareOfIslands(count))),
    },
  ];
}

const REPORT_PATH = join('stats', 'island_escape_reach.yaml');
const DOC_PATH = join('docs', 'diagnostics', 'IslandEscapeReachStats.md');

/** 定義から島を生成して数え、レポートの中身を作る。再生成と鮮度の確認が同じものを見るための1箇所。 */
function buildReportFromDefinitions(): string {
  const codex = bundledCodex();
  const sources = escapeReachSourcesOf(codex);
  const goals: readonly Goal[] = [...sources.goals].map(([objectGlobalId, tagName]) => ({
    objectName: codex.objects.get(objectGlobalId).name,
    tagName,
  }));

  const stats = createStats(sources, goals);
  for (let seed = 0; seed < SEED_COUNT; seed++)
    collect(stats, islandEscapeReachOf(sources, generateIsland(codex.generation, 'island', seed)));

  return formatYamlReport(
    [
      '島を出るのに要るものの鎖が、生成された島ごとに閉じているか。',
      '定義（src/assets/world-codex/*.yaml）と生成された島だけから計算した。',
      '生成物。手で書き換えず、npm run stats:escape-islands で作り直す。',
      '何を数えて何を数えていないかは docs/diagnostics/IslandEscapeReachStats.md。',
    ],
    buildSections(sources, goals, stats),
  );
}

const DOCUMENTED_SECTIONS = describeDocumentedSections(DOC_PATH, REPORT_PATH);

describeYamlReportRegeneration(
  REPORT_PATH,
  'RUN_ISLAND_ESCAPE_REACH_STATS',
  buildReportFromDefinitions,
  DOCUMENTED_SECTIONS.required,
);

describeReportFreshness(REPORT_PATH, 'npm run stats:escape-islands', buildReportFromDefinitions);
