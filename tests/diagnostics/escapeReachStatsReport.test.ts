import { join } from 'node:path';
import type { EscapeNeed, EscapeReach } from '../../src/analysis/escapeReach';
import { escapeReachSourcesOf, escapeReachOf } from '../../src/analysis/escapeReach';
import type { YamlRecord, YamlReportSection } from '../support/generatedReport';
import {
  describeDocumentedSections,
  describeReportFreshness,
  describeYamlReportRegeneration,
  formatYamlReport,
} from '../support/generatedReport';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * 島を出るのに要るものが、島の産物から**何工程先にあるか**を並べ（`src/analysis/escapeReach.ts`）、
 * `stats/escape_reach.yaml`へ書き出す。
 *
 * **しきい値は置かない。** 鎖が閉じているかを判定するのは`tests/integration/escapeReach.test.ts`で、
 * ここが持つのは数字だけ——長すぎるかどうかを決めるのはこの数字が出てからで、レポートの側が先に
 * 決めてしまうと、決める材料がレポートの判定に汚染される。
 *
 * **書き出すのは数値だけ。** 何を数えたか・引いた線・数えていないものは、手書きの
 * `docs/diagnostics/EscapeReachStats.md` が持つ。工程や土地の発見物を触った後に再生成する:
 * `npm run stats:escape`。再生成と鮮度の形は `tests/support/generatedReport.ts` が持つ。定義から
 * 解くだけなので、鮮度は丸ごと作り直して比べる。
 */

function buildSections(reach: EscapeReach): readonly YamlReportSection[] {
  const goals = reach.needs.filter((need) => need.goalTagName !== undefined);
  return [
    {
      key: 'meta',
      records: [
        {
          departure_locations: reach.departureObjectNames.length,
          needs: reach.needs.length,
          goals: goals.length,
          unit: 'hops',
          max_hops: Math.max(...reach.needs.map((need) => need.reach?.hops ?? 0)),
        },
      ],
    },
    { key: 'departure', records: reach.departureObjectNames.map((location) => ({ location })) },
    { key: 'needs', records: reach.needs.map(needRecord) },
    {
      key: 'unreached',
      records: reach.unreachedNeeds.flatMap((need) =>
        need.blockedBy.map((blocked) => ({
          object: need.objectName,
          step: blocked.step.name,
          owner: blocked.step.ownerObjectName,
          missing: blocked.missing.map((input) => input.tagName ?? input.objectName ?? '?'),
        })),
      ),
    },
  ];
}

/** 要るもの1行。届かないものは`hops`と工程が空になり、切れ目は`unreached`の節が持つ。 */
function needRecord(need: EscapeNeed): YamlRecord {
  const via = need.reach?.via;
  return {
    object: need.objectName,
    goal_tag: need.goalTagName ?? null,
    unit: 'hops',
    hops: need.reach?.hops ?? null,
    step_kind: via?.kind ?? null,
    step: via?.name ?? null,
    owner: via?.ownerObjectName ?? null,
    inputs: (via?.inputs ?? []).map((input) => ({
      object: input.objectName ?? null,
      tag: input.tagName ?? null,
      consumed: input.consumed,
    })),
  };
}

const REPORT_PATH = join('stats', 'escape_reach.yaml');
const DOC_PATH = join('docs', 'diagnostics', 'EscapeReachStats.md');

/** 定義から数えて、レポートの中身を作る。再生成と鮮度の確認が同じものを見るための1箇所。 */
function buildReportFromDefinitions(): string {
  const codex = bundledCodex();

  return formatYamlReport(
    [
      '島を出るのに要るものが、島の産物から何工程先にあるか。',
      '定義（src/assets/world-codex/*.yaml）だけから計算した。島の生成は通していない。',
      '生成物。手で書き換えず、npm run stats:escape で作り直す。',
      '何を数えて何を数えていないかは docs/diagnostics/EscapeReachStats.md。',
    ],
    buildSections(escapeReachOf(escapeReachSourcesOf(codex))),
  );
}

const DOCUMENTED_SECTIONS = describeDocumentedSections(DOC_PATH, REPORT_PATH);

describeYamlReportRegeneration(
  REPORT_PATH,
  'RUN_ESCAPE_REACH_STATS',
  buildReportFromDefinitions,
  DOCUMENTED_SECTIONS.required,
);

describeReportFreshness(REPORT_PATH, 'npm run stats:escape', buildReportFromDefinitions);
