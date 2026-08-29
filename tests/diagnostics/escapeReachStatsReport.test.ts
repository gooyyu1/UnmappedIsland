import { describe, expect, it } from 'vitest';
import type { EscapeNeed, EscapeReach } from '../../src/analysis/escapeReach';
import { escapeReachOf } from '../../src/analysis/escapeReach';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import type { YamlRecord, YamlReportSection } from '../support/generatedReport';
import { formatYamlReport, missingYamlSections } from '../support/generatedReport';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 島を出るのに要るものが、島の産物から**何工程先にあるか**を並べる（`src/analysis/escapeReach.ts`）。
 *
 * **しきい値は置かない。** 鎖が閉じているかを判定するのは`tests/integration/escapeReach.test.ts`で、
 * ここが持つのは数字だけ——長すぎるかどうかを決めるのはこの数字が出てからで、レポートの側が先に
 * 決めてしまうと、決める材料がレポートの判定に汚染される。
 *
 * **書き出し先はまだ持たない。** 他の4本と同じく`stats/*.yaml`へ置くには、読み方の文書
 * （`docs/diagnostics/`）・再生成のコマンド（`package.json`）・`main`での作り直し
 * （`regenerate-stats.yml`）がいずれも要り、どれもこのissueの担当の外にある。ここでは同じ書式の
 * まま標準出力へ出す。
 */

/** 空になってはいけない節。定義から解く道具は、読み方がずれても例外を投げずに0行を返す。 */
const REQUIRED_SECTIONS = ['meta', 'departure', 'needs'];

describe('島を出るのに要るものの工程数（同梱の定義）', () => {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  const report = buildReport(escapeReachOf(codex));

  it('レポートを書き出す', () => {
    console.log(report);
    expect(missingYamlSections(report, REQUIRED_SECTIONS), 'レポートから節が消えている').toEqual([]);
  });
});

function buildReport(reach: EscapeReach): string {
  return formatYamlReport(
    [
      '島を出るのに要るものが、島の産物から何工程先にあるか。',
      '定義（src/assets/world-codex/*.yaml）だけから計算した。島の生成は通していない。',
      '何を数えて何を数えていないかは src/analysis/escapeReach.ts の冒頭。',
    ],
    buildSections(reach),
  );
}

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
