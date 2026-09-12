import { join } from 'node:path';
import type { DiscoverySources } from '../../src/analysis/discoveryCoverage';
import { discoverySourcesOf, islandDiscoveryCoverageOf } from '../../src/analysis/discoveryCoverage';
import { generateIsland } from '../../src/domain/generation/TerrainGenerator';
import type { YamlRecord, YamlReportSection } from '../support/generatedReport';
import {
  describeDocumentedSections,
  describeReportFreshness,
  describeYamlReportRegeneration,
  formatYamlReport,
  shareRecord,
} from '../support/generatedReport';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * 探索で見つかる物が生成された島にどれだけ行き渡るか（`src/analysis/discoveryCoverage.ts`）を
 * 多数の種で測り、`stats/discovery_coverage.yaml`へ書き出す。
 *
 * **書き出すのは数値だけ。** 何を測ったか・引いた線・数えていないものは、手書きの
 * `docs/diagnostics/DiscoveryCoverageStats.md` が持つ。
 *
 * 発見物の配りと土地の生成を触ったときに取りこぼしがどう動いたかを差分で読むためのもので、触った後に
 * 再生成する: `npm run stats:discovery`。再生成と鮮度の形は `tests/support/generatedReport.ts` が持つ。
 */

/**
 * 回す種の数。**他の島ごとのレポートと揃える**——同じ生成器を同じ種で回すので、土地の型の
 * 取りこぼし（`stats/island_escape_reach.yaml` の `island_missing_location`）と行が突き合わせられる。
 */
const SEED_COUNT = 2000;

interface DiscoveryCoverageStats {
  /** その型を出す土地が1つも無かった島の数（並びはsources.objectsと同じ）。 */
  readonly missingObjectCounts: number[];

  /** その札を持つ型を出す土地が1つも無かった島の数（並びはsources.tagsと同じ）。 */
  readonly missingTagCounts: number[];

  /** 型を名指しで契機に据えたとき、契機が1つでも消えた島の数。 */
  islandsMissingAnyObject: number;

  /** 札で束ねて契機に据えたとき、契機が1つでも消えた島の数。 */
  islandsMissingAnyTag: number;

  islandCount: number;
}

function createStats(sources: DiscoverySources): DiscoveryCoverageStats {
  return {
    missingObjectCounts: sources.objects.map(() => 0),
    missingTagCounts: sources.tags.map(() => 0),
    islandsMissingAnyObject: 0,
    islandsMissingAnyTag: 0,
    islandCount: 0,
  };
}

function collect(
  stats: DiscoveryCoverageStats,
  coverage: ReturnType<typeof islandDiscoveryCoverageOf>,
): void {
  stats.islandCount++;
  for (const index of coverage.missingObjectIndices) stats.missingObjectCounts[index]++;
  for (const index of coverage.missingTagIndices) stats.missingTagCounts[index]++;
  if (coverage.missingObjectIndices.length > 0) stats.islandsMissingAnyObject++;
  if (coverage.missingTagIndices.length > 0) stats.islandsMissingAnyTag++;
}

function buildSections(
  sources: DiscoverySources,
  stats: DiscoveryCoverageStats,
): readonly YamlReportSection[] {
  const shareRecords = <T extends YamlRecord>(keys: readonly T[], counts: readonly number[]): YamlRecord[] =>
    keys.map((key, index) => shareRecord(key, counts[index] / stats.islandCount));

  return [
    {
      key: 'meta',
      records: [
        {
          seeds: SEED_COUNT,
          islands: stats.islandCount,
          objects: sources.objects.length,
          tags: sources.tags.length,
        },
      ],
    },
    {
      key: 'object_sources',
      records: sources.objects.map((object) => ({
        object: object.name,
        tags: object.tagNames,
        locations: object.locationDefNames,
      })),
    },
    {
      key: 'tag_sources',
      records: sources.tags.map((tag) => ({ tag: tag.name, objects: tag.objectNames })),
    },
    {
      key: 'island_missing_object',
      records: shareRecords(
        sources.objects.map((object) => ({ object: object.name })),
        stats.missingObjectCounts,
      ),
    },
    {
      key: 'island_missing_tag',
      records: shareRecords(
        sources.tags.map((tag) => ({ tag: tag.name })),
        stats.missingTagCounts,
      ),
    },
    {
      key: 'island_missing_any',
      records: [
        shareRecord({ written_as: 'object' }, stats.islandsMissingAnyObject / stats.islandCount),
        shareRecord({ written_as: 'tag' }, stats.islandsMissingAnyTag / stats.islandCount),
      ],
    },
  ];
}

const REPORT_PATH = join('stats', 'discovery_coverage.yaml');
const DOC_PATH = join('docs', 'diagnostics', 'DiscoveryCoverageStats.md');

/** 定義から島を生成して測り、レポートの中身を作る。再生成と鮮度の確認が同じものを見るための1箇所。 */
function buildReportFromDefinitions(): string {
  const codex = bundledCodex();
  const sources = discoverySourcesOf(codex);

  const stats = createStats(sources);
  for (let seed = 0; seed < SEED_COUNT; seed++)
    collect(stats, islandDiscoveryCoverageOf(sources, generateIsland(codex.generation, 'island', seed)));

  return formatYamlReport(
    [
      '探索で見つかる物が、生成された島にどれだけ行き渡るか。',
      '定義（src/assets/world-codex/*.yaml）と生成された島だけから計算した。',
      '生成物。手で書き換えず、npm run stats:discovery で作り直す。',
      '何を測ったか・引いた線・数えていないものは docs/diagnostics/DiscoveryCoverageStats.md。',
    ],
    buildSections(sources, stats),
  );
}

const DOCUMENTED_SECTIONS = describeDocumentedSections(DOC_PATH, REPORT_PATH);

describeYamlReportRegeneration(
  REPORT_PATH,
  'RUN_DISCOVERY_COVERAGE_STATS',
  buildReportFromDefinitions,
  DOCUMENTED_SECTIONS.required,
);

describeReportFreshness(REPORT_PATH, 'npm run stats:discovery', buildReportFromDefinitions);
