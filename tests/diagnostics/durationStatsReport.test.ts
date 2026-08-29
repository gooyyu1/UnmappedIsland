import { join } from 'node:path';
import type { Duration, ToolWear } from '../../src/analysis/durations';
import { MINIMUM_DAYS, durationsOf, toolWearsOf } from '../../src/analysis/durations';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import type { YamlRecord, YamlReportSection } from '../support/generatedReport';
import {
  RoundedNumber,
  describeDocumentedSections,
  describeReportFreshness,
  describeYamlReportRegeneration,
  formatYamlReport,
} from '../support/generatedReport';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 定義全体の**日をまたぐ長さ**を、種類を問わず1本の列に並べ（`src/analysis/durations.ts`）、
 * `stats/durations.yaml`へ書き出す。
 *
 * **しきい値は置かない。** 怪我より食べ物が長いことも、重い傷より軽い傷が長引くことも、赤/緑では
 * 言わない——ここが持つのは並びだけで、逆転が許されるかを決めるのは並びを読んでからになる。
 *
 * **書き出すのは数値だけ。** 何を数えたか・引いた線・数えていないものは、手書きの
 * `docs/diagnostics/DurationStats.md` が持つ。日数を決める値（怪我のseverity・食べ物のdurability・
 * season_remaining・道具のdurability）を触った後に再生成する: `npm run stats:durations`。
 * 再生成と鮮度の形は `tests/support/generatedReport.ts` が持つ。定義から解くだけなので、鮮度は
 * 丸ごと作り直して比べる。
 */

function buildSections(
  durations: readonly Duration[],
  toolWears: readonly ToolWear[],
): readonly YamlReportSection[] {
  return [
    {
      key: 'meta',
      records: [
        {
          unit: 'days',
          minimum: MINIMUM_DAYS,
          durations: durations.length,
          longest: days(durations[0]?.days ?? 0),
          shortest: days(durations[durations.length - 1]?.days ?? 0),
          tool_wears: toolWears.length,
        },
      ],
    },
    { key: 'durations', records: durations.map(durationRecord) },
    { key: 'tool_wear', records: toolWears.map(toolWearRecord) },
  ];
}

/** 長さ1行。**この節の並びそのものが答え**なので、種類で分けずに長い順のまま書く。 */
function durationRecord(duration: Duration): YamlRecord {
  return {
    object: duration.objectName,
    property: duration.propertyName,
    unit: 'days',
    days: days(duration.days),
    shortest_days: days(duration.shortestDays),
    repeats: duration.repeats,
    destroys: duration.destroysSelf,
  };
}

/** 使うたびに減る値1行。単位が回数なので、上の節とは別に並べる（DurationStats.md参照）。 */
function toolWearRecord(wear: ToolWear): YamlRecord {
  return {
    object: wear.objectName,
    property: wear.propertyName,
    step: wear.stepName,
    owner: wear.stepOwnerName,
    unit: 'uses',
    uses: new RoundedNumber(wear.uses, 2),
    labor_minutes: wear.laborMinutes,
  };
}

/** 日数は小数第2位まで（0.01日＝約14分）。**並べ替えは丸める前の値で済んでいる**ので、同じ値に
 * 丸められた2行が並んでも順序は正しい。 */
function days(value: number): RoundedNumber {
  return new RoundedNumber(value, 2);
}

const REPORT_PATH = join('stats', 'durations.yaml');
const DOC_PATH = join('docs', 'diagnostics', 'DurationStats.md');

/** 定義から数えて、レポートの中身を作る。再生成と鮮度の確認が同じものを見るための1箇所。 */
function buildReportFromDefinitions(): string {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();

  return formatYamlReport(
    [
      '日をまたぐ長さを、種類を問わず長い順に並べたもの。',
      '定義（src/assets/world-codex/*.yaml）だけから計算した。実行は通していない。',
      '生成物。手で書き換えず、npm run stats:durations で作り直す。',
      '何を数えて何を数えていないかは docs/diagnostics/DurationStats.md。',
    ],
    buildSections(durationsOf(codex), toolWearsOf(codex)),
  );
}

const DOCUMENTED_SECTIONS = describeDocumentedSections(DOC_PATH, REPORT_PATH);

describeYamlReportRegeneration(
  REPORT_PATH,
  'RUN_DURATION_STATS',
  buildReportFromDefinitions,
  DOCUMENTED_SECTIONS.required,
);

describeReportFreshness(REPORT_PATH, 'npm run stats:durations', buildReportFromDefinitions);
