import { describe, expect, it } from 'vitest';
import type { EscapeNeed, EscapeReach, NeedInput } from '../../src/analysis/escapeReach';
import {
  ESCAPE_GOAL_TAG_NAMES,
  escapeReachSourcesOf,
  escapeReachOf,
  islandEscapeReachOf,
} from '../../src/analysis/escapeReach';
import type { IslandMap } from '../../src/domain/generation/IslandMap';
import { generateIsland } from '../../src/domain/generation/TerrainGenerator';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * **島の産物だけで島を出るものが作れる**ことの検査（`src/analysis/escapeReach.ts`）。
 *
 * 航海の側（`tests/world-codex/voyageYaml.test.ts`）は筏が組み上がって帆も持っている場面から
 * 始まるので、そこへ至る鎖は誰も通していない。ここが最後の段の入口を見る。
 *
 * 前提は同梱の定義だけで、島の生成は通さない——その土地が生成された島に在るかは別の問いで、
 * `islandEscapeReachOf`が島ごとに数える（`stats/island_escape_reach.yaml`）。
 */
describe('島を出るのに要るもの（同梱の定義）', () => {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  const reach = escapeReachOf(escapeReachSourcesOf(codex));

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

/**
 * **出発集合を生成された島に差し替えても、同じ数え方のままである**ことの検査。
 *
 * 島ごとに鎖が閉じるかは赤/緑で判定しない——落ちる島の割合を数えるのは
 * `stats/island_escape_reach.yaml` で、どこまでを許すかはその数字を見てから決める。ここが見るのは
 * 出発集合の差し替えそのもの。
 */
describe('島を出るのに要るもの（生成された島）', () => {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  const sources = escapeReachSourcesOf(codex);
  const defined = escapeReachOf(sources);

  const islands = [...Array(20).keys()].map((seed) => generateIsland(codex.generation, 'island', seed));
  const complete = islands.find(
    (map) => locationNamesOf(codex, map).size === defined.departureObjectNames.length,
  );
  const partial = islands.find(
    (map) => locationNamesOf(codex, map).size < defined.departureObjectNames.length,
  );

  it('出発集合が、その島に在る土地と一致する', () => {
    for (const map of islands)
      expect(new Set(islandEscapeReachOf(sources, map).departureObjectNames), `seed ${map.seed}`).toEqual(
        locationNamesOf(codex, map),
      );
  });

  it('土地を1つも欠かない島は、定義から数えたのと同じになる', () => {
    // 出発集合が同じなら結果も同じ。ここが崩れると、差し替えが数え方まで変えていることになる。
    expect(complete, '土地を全部持つ島が20シードの中に無い').toBeDefined();
    expect(hopsOf(islandEscapeReachOf(sources, complete!))).toEqual(hopsOf(defined));
  });

  it('土地を欠く島では、定義から数えたときより工程が短くならない', () => {
    // 出発集合が狭くなって近道が生まれることはない。生まれるなら、島に無い土地から数えている。
    // 比べるのは両方の一覧に載る型だけ——要るものの一覧は通った道で決まるので、島が別の材料を
    // 通れば定義側に並ばない型が出る。届かない型はMAX_SAFE_INTEGERとして比べ、必ず落とす。
    expect(partial, '土地を欠く島が20シードの中に無い').toBeDefined();
    const definedHops = hopsOf(defined);
    for (const [objectName, hops] of hopsOf(islandEscapeReachOf(sources, partial!)))
      if (hops !== undefined && definedHops.has(objectName))
        expect(definedHops.get(objectName) ?? Number.MAX_SAFE_INTEGER, objectName).toBeLessThanOrEqual(hops);
  });
});

/** その島が持っている土地の型の名前。 */
function locationNamesOf(codex: WorldCodex, map: IslandMap): ReadonlySet<string> {
  return new Set(map.sites.map((site) => codex.objects.get(site.type!.objectDefGlobalId).name));
}

/** 要るもの → 工程数。届かないものはundefined。 */
function hopsOf(reach: EscapeReach): ReadonlyMap<string, number | undefined> {
  return new Map(reach.needs.map((need) => [need.objectName, need.reach?.hops]));
}

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
