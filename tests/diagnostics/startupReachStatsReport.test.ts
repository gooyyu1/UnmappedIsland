import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import type { IslandReach, NeedReach, StartupNeedSources } from '../../src/analysis/startupReach';
import { islandReachOf, STARTUP_NEEDS, startupNeedSourcesOf } from '../../src/analysis/startupReach';
import { generateIsland } from '../../src/domain/generation/TerrainGenerator';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { Stat } from '../support/Stat';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 開始地点ごとの「立ち上がりやすさ」（`src/analysis/startupReach.ts`）を多数の種で測り、
 * `docs/diagnostics/StartupReachStats.md`へ書き出す。
 *
 * 通常のテストスイート（`npm test`）には含めない: 合否判定を目的とした回帰テストではなく、
 * 生成と発見物の配りを触ったときに散らばりがどう動いたかを差分で読むための再計測が目的のため、
 * `RUN_STARTUP_REACH_STATS`環境変数が立っているときだけ実行する: `npm run stats:startup`
 *
 * **代わりに、生成済みのレポートが古くなっていないかは常に見る**（末尾のdescribe）。2,000シードの
 * 計測は2秒で済むので、指紋のような間接の突き合わせは要らない——**丸ごと比べれば取りこぼしが無い。**
 */

/**
 * 回す種の数。**平均ではなく散らばりの端が落ち着く数で取る**——最良サイトの歩数の標準偏差は
 * 500個では0.04、2,000個で0.10、5,000個でも0.10で、移動時間・探索時間の最大も2,000個以降は
 * 動かない。平均だけなら500個で足りるが、この表が見たいのは端の方（ContentSkeleton.md 2.3.3節）。
 */
const SEED_COUNT = 2000;

/** 歩数のヒストグラムに出す上限（これを超える分はまとめて「N歩以上」）。 */
const MAX_LISTED_HOPS = 5;

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

  /** 島ごと: 最も条件の良いサイトの、全部が揃うまで。 */
  readonly best: NeedStats;

  /** 島ごと: 最も条件の良いサイトの、要るものごと（並びはSTARTUP_NEEDSと同じ）。 */
  readonly bestPerNeed: readonly NeedStats[];

  /** 島ごと: 最も条件の良いサイトの土地の型の回数。 */
  readonly bestLocationCounts: Map<string, number>;

  /** 島ごと: その要るものが島のどこでも採れなかった島の数（並びはSTARTUP_NEEDSと同じ）。 */
  readonly missingIslandCounts: number[];

  /** 島ごと: 最も条件の良いサイトからでも届かない要るものがある島の数。 */
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
    best: createNeedStats(),
    bestPerNeed: STARTUP_NEEDS.map(() => createNeedStats()),
    bestLocationCounts: new Map(),
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

  const best = reach.bestSite;
  stats.bestLocationCounts.set(
    best.locationDefName,
    (stats.bestLocationCounts.get(best.locationDefName) ?? 0) + 1,
  );
  for (const [needIndex, need] of best.needs.entries()) addReach(stats.bestPerNeed[needIndex], need);

  if (best.unreachableNeedCount > 0 || best.farthestNeed === undefined) {
    stats.islandsWithUnreachableCount++;
    stats.best.unreachableSiteCount++;
    return;
  }
  addReach(stats.best, best.farthestNeed);
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

/** Statの1行。tableRowと違い中央値を出す（散らばりの読み取りに要る）。 */
function statRow(label: string, unit: string, stat: Stat): string {
  if (stat.count === 0) return `| ${label} | - | - | - | - | - | - | 0 |`;
  const cell = (value: number): string => `${value.toFixed(2)}${unit}`;
  return (
    `| ${label} | ${cell(stat.mean)} | ${cell(stat.min)} | ${cell(stat.percentile(0.5))} | ` +
    `${cell(stat.percentile(0.95))} | ${cell(stat.max)} | ${stat.stdDev.toFixed(2)} | ${stat.count} |`
  );
}

function appendStatTable(
  append: (line?: string) => void,
  firstColumn: string,
  rows: readonly (readonly [string, string, Stat])[],
): void {
  append(`| ${firstColumn} | 平均 | 最小 | 中央 | 95%ile | 最大 | 標準偏差 | n |`);
  append('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [label, unit, stat] of rows) append(statRow(label, unit, stat));
  append();
}

function appendHopsHistogram(append: (line?: string) => void, stat: Stat): void {
  append('| 歩数 | 割合 |');
  append('| --- | --- |');
  let listed = 0;
  for (let hops = 0; hops <= MAX_LISTED_HOPS; hops++) {
    const share = stat.shareOf(hops);
    listed += share;
    append(`| ${hops}歩 | ${(share * 100).toFixed(2)}% |`);
  }
  append(`| ${MAX_LISTED_HOPS + 1}歩以上 | ${((1 - listed) * 100).toFixed(2)}% |`);
  append();
}

function appendMethod(append: (line?: string) => void): void {
  append('## 計測方法');
  append();
  append('- **測るのは「最初の段（ContentSkeleton.md 2.1節）を越えるのに要るもの6つが、その地点から');
  append('  何歩先にあるか」**。歩数は道の本数で、0歩はその土地自身で採れること。');
  append('- 経路は**歩数が最短のもの**を採り、同じ歩数なら移動時間が短い方。移動時間と探索時間は');
  append('  その経路のもので、最短の移動時間ではない。');
  append('- **道は未発見でも数える。** 判定するのは島の作りであってプレイヤーの進み具合ではない。');
  append('  道を見つけるのに要る時間は「探索時間」として別に出す——その経路で通る土地について、');
  append('  道が全部出そろうまでの探索回数（`exploration_progress`の上限−1）×1回の所要時間の和。');
  append('  **着いた先の探索は含まない**（そこで目当ての物を引くまでの回数は引きの運）。');
  append('- 出どころ（どの土地で何が採れるか）は`locations.yaml`の`explore`の実測。`pick`の重みからは');
  append('  **期待値まで読み**、どの回に何を引くかは数えない。');
  append('- **「全部が揃うまで」は、届いたものの中で最も遠い要るもの**（歩数、同歩数なら移動時間で');
  append('  比べる）1つの値で表す。列どうしを混ぜないため、3つの数は同じ1本の経路のもの。');
  append('- 中央値・95%ileは最近隣法（nearest-rank）、標準偏差は標本標準偏差（n-1）。');
  append();
  append('**この表は判定を出さない。** どの地点を開始地点の候補にするか、どの散らばりなら広すぎるかは');
  append('（ContentSkeleton.md 2.3.2節・2.3.3節）、ここの数字を見てから決める。');
  append();
}

function appendSources(append: (line?: string) => void, sources: StartupNeedSources): void {
  append('## 要るものの出どころ');
  append();
  append('`locations.yaml`の`explore`の実測。**1つの土地では揃わない**ことがこの表の要点で、');
  append('荒野は火口・錐・刃を持つが軸が無く、砂浜は軸しか持たない（ContentSkeleton.md 2.3節）。');
  append();
  append('| 要るもの | 出どころ | 採れる土地 | 1回の探索あたり |');
  append('| --- | --- | --- | --- |');
  for (const row of sources.rows)
    append(
      `| ${STARTUP_NEEDS[row.needIndex].label} | ${row.objectName} | ${row.locationDefName} |` +
        ` ${row.expectedPerExplore.toFixed(3)}個 |`,
    );
  append();

  append('### 土地の型ごと');
  append();
  append('探索時間は、その土地の道が全部出そろうまでの分数（上の「計測方法」参照）。');
  append();
  append('| 土地 | 採れる要るもの | 道が出そろうまでの探索時間 |');
  append('| --- | --- | --- |');
  for (const supply of sources.byLocationDef.values()) {
    const labels = [...supply.needIndices]
      .sort((a, b) => a - b)
      .map((needIndex) => STARTUP_NEEDS[needIndex].label);
    append(
      `| ${supply.locationDefName} | ${labels.length === 0 ? '—' : labels.join('・')} |` +
        ` ${supply.pathDiscoveryMinutes}分 |`,
    );
  }
  append();
}

function appendPerSite(append: (line?: string) => void, stats: StartupReachStats): void {
  append('## サイトごと');
  append();
  append(`全島の全サイト（${stats.siteCount}地点）をまとめた分布。**開始地点の候補になりうる地点の`);
  append('全体像**で、選抜（ContentSkeleton.md 2.3節）はこの中から取ることになる。');
  append();

  append('### 要るものごと');
  append();
  appendStatTable(
    append,
    '歩数',
    STARTUP_NEEDS.map((need, index) => [need.label, '歩', stats.perNeed[index].hops] as const),
  );
  appendStatTable(
    append,
    '移動時間',
    STARTUP_NEEDS.map((need, index) => [need.label, '分', stats.perNeed[index].travelMinutes] as const),
  );
  appendStatTable(
    append,
    '探索時間',
    STARTUP_NEEDS.map(
      (need, index) => [need.label, '分', stats.perNeed[index].pathDiscoveryMinutes] as const,
    ),
  );

  append('| 要るもの | 島のどこをたどっても届かないサイト |');
  append('| --- | --- |');
  for (const [index, need] of STARTUP_NEEDS.entries())
    append(
      `| ${need.label} | ${((stats.perNeed[index].unreachableSiteCount / stats.siteCount) * 100).toFixed(2)}% |`,
    );
  append();

  append('### 全部が揃うまで');
  append();
  appendStatTable(append, '項目', [
    ['歩数', '歩', stats.farthest.hops],
    ['移動時間', '分', stats.farthest.travelMinutes],
    ['探索時間', '分', stats.farthest.pathDiscoveryMinutes],
  ]);
  appendHopsHistogram(append, stats.farthest.hops);

  append('| 最後まで残る要るもの | 割合 |');
  append('| --- | --- |');
  const farthestTotal = stats.farthestNeedCounts.reduce((sum, count) => sum + count, 0);
  for (const [index, need] of STARTUP_NEEDS.entries())
    append(
      `| ${need.label} | ${farthestTotal === 0 ? '-' : ((stats.farthestNeedCounts[index] / farthestTotal) * 100).toFixed(2)}% |`,
    );
  append();

  append('### 始めた土地の型ごと');
  append();
  append('今の開始地点は砂浜が既定（`IslandSpawner.placePlayer`）なので、砂浜の行がそのまま');
  append('今の立ち上がりになる。');
  append();
  append('| 土地 | 全部が揃うまでの歩数（平均） | 最小 | 最大 | n |');
  append('| --- | --- | --- | --- | --- |');
  for (const [name, stat] of [...stats.farthestHopsByLocation].sort((a, b) => a[0].localeCompare(b[0])))
    append(
      `| ${name} | ${stat.mean.toFixed(2)}歩 | ${stat.min.toFixed(0)}歩 |` +
        ` ${stat.max.toFixed(0)}歩 | ${stat.count} |`,
    );
  append();
}

function appendPerIsland(append: (line?: string) => void, stats: StartupReachStats): void {
  append('## 島ごと');
  append();
  append('その島で**最も条件の良いサイト**の値。島は引き直さないので（ContentSkeleton.md 2.3.1節）、');
  append('どの地点も条件を満たさない島ではここから始まる——**この分布の散らばりが、選抜をしても');
  append('引きで決まってしまうかどうかの材料**になる（同2.3.3節）。');
  append();
  append('「最も条件の良い」の順は「届かない数 → 全部が揃うまでの歩数 → その移動時間 → その探索時間');
  append('→ サイトのindex」で、良し悪しの判定ではなく順序の定義。');
  append();
  appendStatTable(append, '項目', [
    ['歩数', '歩', stats.best.hops],
    ['移動時間', '分', stats.best.travelMinutes],
    ['探索時間', '分', stats.best.pathDiscoveryMinutes],
  ]);
  appendHopsHistogram(append, stats.best.hops);

  append('### 最も条件の良いサイトの要るものごと');
  append();
  append('歩数がほとんど動かないときは、散らばりは移動時間と探索時間の側に出る。');
  append();
  append('| 要るもの | 歩数（平均） | 歩数（最大） | 移動時間（平均） | 探索時間（平均） |');
  append('| --- | --- | --- | --- | --- |');
  for (const [index, need] of STARTUP_NEEDS.entries()) {
    const perNeed = stats.bestPerNeed[index];
    append(
      `| ${need.label} | ${perNeed.hops.mean.toFixed(2)}歩 | ${perNeed.hops.max.toFixed(0)}歩 |` +
        ` ${perNeed.travelMinutes.mean.toFixed(2)}分 | ${perNeed.pathDiscoveryMinutes.mean.toFixed(2)}分 |`,
    );
  }
  append();

  append('### 島全体で採れないもの');
  append();
  append('| 要るもの | 島のどこでも採れない島 |');
  append('| --- | --- |');
  for (const [index, need] of STARTUP_NEEDS.entries())
    append(
      `| ${need.label} | ${((stats.missingIslandCounts[index] / stats.islandCount) * 100).toFixed(2)}% |`,
    );
  append();
  append(
    `最も条件の良いサイトからでも届かない要るものがある島: ` +
      `${((stats.islandsWithUnreachableCount / stats.islandCount) * 100).toFixed(2)}%`,
  );
  append();

  append('### 最も条件の良いサイトの土地');
  append();
  append('| 土地 | 割合 |');
  append('| --- | --- |');
  for (const [name, count] of [...stats.bestLocationCounts].sort((a, b) => b[1] - a[1]))
    append(`| ${name} | ${((count / stats.islandCount) * 100).toFixed(2)}% |`);
  append();
}

function buildReport(sources: StartupNeedSources, stats: StartupReachStats): string {
  const lines: string[] = [];
  const append = (line = ''): void => {
    lines.push(line);
  };

  append('# 開始地点の立ち上がりレポート');
  append();
  append('`tests/diagnostics/startupReachStatsReport.test.ts` が、定義');
  append('（`src/assets/world-codex/*.yaml`）と生成された島だけから計算した、');
  append(`開始地点ごとの「立ち上がりやすさ」（シード ${SEED_COUNT} 個）。`);
  append('`locations.yaml`の発見物か`terrain_generation.yaml`を変更したら以下で再生成する。');
  append();
  append('```');
  append('npm run stats:startup');
  append('```');
  append();

  appendMethod(append);
  appendSources(append, sources);
  appendPerSite(append, stats);
  appendPerIsland(append, stats);

  return lines.join('\n') + '\n';
}

const REPORT_PATH = join('docs', 'diagnostics', 'StartupReachStats.md');

/** 定義から島を生成して測り、レポートの中身を作る。再生成と鮮度の確認が同じものを見るための1箇所。 */
function buildReportFromDefinitions(): string {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  const sources = startupNeedSourcesOf(codex);

  const stats = createStats();
  for (let seed = 0; seed < SEED_COUNT; seed++)
    collect(stats, islandReachOf(sources, generateIsland(codex.generation, 'island', seed)));

  return buildReport(sources, stats);
}

describe.runIf(process.env.RUN_STARTUP_REACH_STATS === '1')('開始地点の立ち上がりレポート', () => {
  it(`${SEED_COUNT}シード分の島を測ってStartupReachStats.mdを再生成する`, () => {
    const report = buildReportFromDefinitions();
    writeFileSync(REPORT_PATH, report, 'utf8');
    console.log(`Report written to: ${REPORT_PATH}`);

    expect(report).toContain('# 開始地点の立ち上がりレポート');
  }, 600_000);
});

/**
 * 生成済みの`StartupReachStats.md`が、今の定義より古くなっていないか。
 *
 * **見るのは古さだけで、値の妥当性は見ない。** 値は`src/analysis/startupReach.ts`の単体試験と、
 * 再生成したレポートの差分が持つ。
 */
describe('開始地点の立ち上がりレポートの鮮度', () => {
  it('生成済みのStartupReachStats.mdが、今の定義から作り直したものと一致する', () => {
    const stored = readFileSync(REPORT_PATH, 'utf8');

    expect(normalizeNewlines(stored), "古い。'npm run stats:startup'で再生成する").toBe(
      normalizeNewlines(buildReportFromDefinitions()),
    );
  }, 600_000);
});

/** CRLFの作業ツリーで生成したレポートが、LFの作業ツリーで食い違わないようにする。 */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n');
}
