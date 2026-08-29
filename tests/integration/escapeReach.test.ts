import { describe, expect, it } from 'vitest';
import type { EscapeNeed, NeedInput } from '../../src/analysis/escapeReach';
import { ESCAPE_GOAL_TAG_NAMES, escapeReachOf } from '../../src/analysis/escapeReach';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * **島の産物だけで島を出るものが作れる**ことの検査（`src/analysis/escapeReach.ts`）。
 *
 * 航海の側（`tests/world-codex/voyageYaml.test.ts`）は筏が組み上がって帆も持っている場面から
 * 始まるので、そこへ至る鎖は誰も通していない。ここが最後の段の入口を見る。
 *
 * 前提は同梱の定義だけで、島の生成は通さない——その土地が生成された島に在るかは別の問いで、
 * `startupReach`が島ごとに測る。
 */
describe('島を出るのに要るもの（同梱の定義）', () => {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  const reach = escapeReachOf(codex);

  it('島の産物だけで、要るものへ1つ残らず届く', () => {
    expect(reach.unreachedNeeds.map(describeBreak)).toEqual([]);
  });

  it('船と帆の両方が目標に挙がっている', () => {
    // 目標が片方でも空だと、上の検査は空集合について緑になる。
    const tags = new Set(reach.needs.map((need) => need.goalTagName).filter((tag) => tag !== undefined));
    expect([...tags].sort()).toEqual([...ESCAPE_GOAL_TAG_NAMES].sort());
  });

  it('目標は、島にそのまま在るものではない', () => {
    // 出発集合に目標が紛れ込む（船が土地を名乗るなど）と、鎖を1つも通さずに緑になる。
    for (const need of reach.needs.filter((need) => need.goalTagName !== undefined))
      expect(need.reach?.hops, need.objectName).toBeGreaterThan(0);
  });
});

/** 届かなかった要るもの1つを、どこで切れたかまで含めて1行にする。 */
function describeBreak(need: EscapeNeed): string {
  const steps = need.blockedBy.map(
    (blocked) =>
      `${blocked.step.kind}:${blocked.step.name}@${blocked.step.ownerObjectName}` +
      `（島に無い入力: ${blocked.missing.map(nameOf).join('・')}）`,
  );
  return `${need.objectName} ← ${steps.length === 0 ? 'これを生む工程が無い' : steps.join(' / ')}`;
}

function nameOf(input: NeedInput): string {
  return input.tagName ?? input.objectName ?? '?';
}
