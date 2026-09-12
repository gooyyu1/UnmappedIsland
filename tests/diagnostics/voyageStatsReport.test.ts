import { join } from 'node:path';
import { buildBalanceTables, MINUTES_PER_TICK } from '../../src/analysis/balanceTables';
import type { CourseTotal, VoyageCourse, VoyageLegs } from '../../src/analysis/voyageLegs';
import { voyageLegsOf } from '../../src/analysis/voyageLegs';
import type { YamlRecord, YamlReportSection } from '../support/generatedReport';
import {
  describeDocumentedSections,
  describeReportFreshness,
  describeYamlReportRegeneration,
  formatYamlReport,
  rounded,
} from '../support/generatedReport';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';

/**
 * 航海を区間に割って測ったもの（`src/analysis/voyageLegs.ts`）を`stats/voyage.yaml`へ書き出す。
 *
 * **書き出すのは数値だけ。** 何を測ったか・引いた線・数えていないものは、手書きの
 * `docs/diagnostics/VoyageStats.md` が持つ。
 *
 * 海区の網・見張りの回数・横断時間・風の受け方・季節が配る風の重みを触ったときに再生成する:
 * `npm run stats:voyage`。定義から解くだけなので、鮮度は丸ごと作り直して比べる。
 */

/** 分の桁。宣言が整数でも、季節の期待値は重みの割り算で端数を持つ。 */
const MINUTE_DECIMALS = 1;

/** 割合・日数・期待個数の桁。 */
const RATIO_DECIMALS = 2;

function courseKeys(course: VoyageCourse): YamlRecord {
  return {
    coast: course.coastName,
    zone: course.startZoneName,
    course: course.detour ? 'detour' : 'shortest',
  };
}

function totalRecord(keys: YamlRecord, total: CourseTotal): YamlRecord {
  return {
    ...keys,
    total_minutes: rounded(total.totalMinutes, MINUTE_DECIMALS),
    days: rounded(total.days, RATIO_DECIMALS),
  };
}

function buildSections(legs: VoyageLegs): readonly YamlReportSection[] {
  return [
    {
      key: 'meta',
      records: [
        {
          zones: legs.zones.length,
          courses: legs.courses.length,
          daily_free_minutes: rounded(legs.dailyFreeMinutes, MINUTE_DECIMALS),
        },
      ],
    },
    {
      key: 'zones',
      records: legs.zones.map((zone) => ({
        zone: zone.name,
        to_mainland: zone.zonesToMainland,
        lookouts: zone.lookouts,
        lookout_minutes: rounded(zone.lookoutMinutes, MINUTE_DECIMALS),
        crossing_minutes: rounded(zone.crossingMinutes, MINUTE_DECIMALS),
        storm_drift_minutes: rounded(zone.stormDriftTicks * MINUTES_PER_TICK, MINUTE_DECIMALS),
        legs: zone.legs.map((leg) => leg.destinationName),
      })),
    },
    {
      key: 'zone_yields',
      records: legs.zones.map((zone) => ({
        zone: zone.name,
        unit: 'percent',
        barren: rounded(zone.barrenShare * 100, RATIO_DECIMALS),
        foraged: rounded(zone.foragedShare * 100, RATIO_DECIMALS),
        spawned: rounded(zone.spawnedShare * 100, RATIO_DECIMALS),
        spawned_by_sighting: rounded(zone.spawnedBySighting * 100, RATIO_DECIMALS),
      })),
    },
    {
      key: 'zone_finds',
      records: legs.zones.flatMap((zone) =>
        zone.finds.map((find) => ({
          zone: zone.name,
          object: find.objectName,
          stands_in_zone: find.spawnsIntoZone,
          unit: 'items_per_lookout',
          expected: rounded(find.expectedPerLookout, RATIO_DECIMALS),
        })),
      ),
    },
    {
      key: 'courses',
      records: legs.courses.map((course) => ({
        ...courseKeys(course),
        legs: course.legs,
        lookouts: course.lookouts,
        lookout_minutes: rounded(course.lookoutMinutes, MINUTE_DECIMALS),
        crossing_minutes: rounded(course.crossingMinutes, MINUTE_DECIMALS),
        total_minutes: rounded(course.total.totalMinutes, MINUTE_DECIMALS),
        days: rounded(course.total.days, RATIO_DECIMALS),
      })),
    },
    {
      key: 'wind_legs',
      records: legs.windLegs.map((leg) => ({
        wind: leg.wind,
        direction: leg.direction,
        unit: 'minutes',
        minutes: rounded(leg.minutes, MINUTE_DECIMALS),
      })),
    },
    {
      key: 'course_wind',
      records: legs.courses.flatMap((course) =>
        [...course.byWind].map(([wind, total]) => totalRecord({ ...courseKeys(course), wind }, total)),
      ),
    },
    {
      key: 'course_season',
      records: legs.courses.flatMap((course) =>
        [...course.bySeason].map(([season, total]) => totalRecord({ ...courseKeys(course), season }, total)),
      ),
    },
  ];
}

const REPORT_PATH = join('stats', 'voyage.yaml');
const DOC_PATH = join('docs', 'diagnostics', 'VoyageStats.md');

/** 定義から測って、レポートの中身を作る。再生成と鮮度の確認が同じものを見るための1箇所。 */
function buildReportFromDefinitions(): string {
  const codex = bundledCodex();
  return formatYamlReport(
    [
      '航海を区間に割って測ったもの。定義（src/assets/world-codex/*.yaml）だけから計算した。実行は通していない。',
      '生成物。手で書き換えず、npm run stats:voyage で作り直す。',
      '何を測ったか・引いた線・数えていないものは docs/diagnostics/VoyageStats.md。',
    ],
    buildSections(voyageLegsOf(codex, buildBalanceTables(codex, SAMPLE_CHARACTER))),
  );
}

const DOCUMENTED_SECTIONS = describeDocumentedSections(DOC_PATH, REPORT_PATH);

describeYamlReportRegeneration(
  REPORT_PATH,
  'RUN_VOYAGE_STATS',
  buildReportFromDefinitions,
  DOCUMENTED_SECTIONS.required,
);

describeReportFreshness(REPORT_PATH, 'npm run stats:voyage', buildReportFromDefinitions);
