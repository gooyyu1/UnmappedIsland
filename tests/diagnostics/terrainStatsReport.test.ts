import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import type { IslandMap } from '../../src/domain/generation/IslandMap';
import { generateIsland } from '../../src/domain/generation/TerrainGenerator';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { Stat } from '../support/Stat';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * パスネットワーク（TerrainGeneration.md 3.5節）の現在の実装について、土地1つあたりの道の本数
 * （連結数）などの統計を計測し、`docs/diagnostics/TerrainStats.md`へ書き出す。
 *
 * 通常のテストスイート（`npm test`）には含めない: 合否判定を目的とした回帰テストではなく、
 * 「繋がりすぎ/繋がらなすぎ」を数値で見るための再計測が目的のため、`RUN_TERRAIN_STATS`環境変数が
 * 立っているときだけ実行する。`extra_edge_detour_factor` 等を変えた後に再生成する:
 * `npm run stats:terrain`
 *
 * **代わりに、生成済みのレポートが古くなっていないかは常に見る**（末尾のdescribe）。500シードの
 * 生成は1秒で済むので、指紋のような間接の突き合わせは要らない——**丸ごと比べれば取りこぼしが無い。**
 */

const SEED_COUNT = 500;

/** 次数のヒストグラムに出す本数の上限（これを超える分はまとめて「N本以上」）。 */
const MAX_LISTED_DEGREE = 7;

interface TerrainStats {
  /** 島1つあたり: 土地数・道の本数・平均次数・次数の標準偏差。 */
  readonly siteCount: Stat;
  readonly edgeCount: Stat;
  readonly meanDegree: Stat;
  readonly degreeStdDevPerIsland: Stat;
  /** 島1つあたりの「MSTを超える余分な道」の本数と、土地数に対する比率（%）。 */
  readonly extraEdgeCount: Stat;
  readonly extraEdgeRatio: Stat;

  /** 島1つあたりに出た土地の種類の数（同じ型がいくつあっても1と数える）。 */
  readonly typesPerIsland: Stat;
  /** 型ごと: 島1つあたりの個数（出なかった島は0として数える）。並びはYAMLの宣言順。 */
  readonly countByType: ReadonlyMap<string, Stat>;

  /** 土地1つあたり: 次数。全島の全土地をまとめた分布。 */
  readonly degree: Stat;
  /** 道1本あたり: 移動時間（分）。 */
  readonly travelMinutes: Stat;
}

function createStats(typeNames: readonly string[]): TerrainStats {
  return {
    siteCount: new Stat(),
    edgeCount: new Stat(),
    meanDegree: new Stat(),
    degreeStdDevPerIsland: new Stat(),
    extraEdgeCount: new Stat(),
    extraEdgeRatio: new Stat(),
    typesPerIsland: new Stat(),
    countByType: new Map(typeNames.map((name) => [name, new Stat()])),
    degree: new Stat(),
    travelMinutes: new Stat(),
  };
}

function collect(stats: TerrainStats, map: IslandMap): void {
  const n = map.sites.length;
  const degrees = new Array<number>(n).fill(0);
  for (const edge of map.edges) {
    degrees[edge.a]++;
    degrees[edge.b]++;
    stats.travelMinutes.add(edge.travelMinutes);
  }

  const perIsland = new Stat();
  for (const degree of degrees) {
    stats.degree.add(degree);
    perIsland.add(degree);
  }

  stats.siteCount.add(n);
  stats.edgeCount.add(map.edges.length);
  stats.meanDegree.add(perIsland.mean);
  stats.degreeStdDevPerIsland.add(perIsland.stdDev);
  // 全土地を繋ぐのに最低限必要な道はn-1本（MST）。それを超えた分が近道・分岐として復活した辺。
  stats.extraEdgeCount.add(map.edges.length - (n - 1));
  stats.extraEdgeRatio.add(((map.edges.length - (n - 1)) / n) * 100);

  const counts = new Map<string, number>();
  for (const site of map.sites) counts.set(site.type!.name, (counts.get(site.type!.name) ?? 0) + 1);
  stats.typesPerIsland.add(counts.size);
  for (const [name, stat] of stats.countByType) stat.add(counts.get(name) ?? 0);
}

function buildReport(stats: TerrainStats): string {
  const lines: string[] = [];
  const append = (line = ''): void => {
    lines.push(line);
  };

  append('# 地形生成統計レポート');
  append();
  append('`tests/diagnostics/terrainStatsReport.test.ts` による生成実測値のスナップショット');
  append(`（シード ${SEED_COUNT} 個）。\`terrain_generation.yaml\` を変更したら以下で再生成する。`);
  append();
  append('```');
  append('npm run stats:terrain');
  append('```');
  append();
  append('## 計測方法');
  append();
  append('- 次数 = その土地に繋がっている道の本数。道は無向で、辺1本が両端の次数を1ずつ増やす。');
  append('- 余分な道 = 道の本数 − (土地数 − 1)。全土地を繋ぐのに最低限必要な本数（MST）を超えた分。');
  append('- 標準偏差は標本標準偏差（n-1）、5%ile/95%ileは最近隣法（nearest-rank）。');
  append();

  const appendStatTable = (firstColumn: string, rows: readonly (readonly [string, string, Stat])[]): void => {
    append(`| ${firstColumn} | 平均 | 最小 | 5%ile | 95%ile | 最大 | 標準偏差 | n |`);
    append('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const [label, unit, stat] of rows) append(stat.tableRow(label, unit));
    append();
  };

  append('## 島ごと');
  append();
  appendStatTable('項目', [
    ['土地数', '', stats.siteCount],
    ['道の本数', '', stats.edgeCount],
    ['平均次数', '', stats.meanDegree],
    ['次数の標準偏差', '', stats.degreeStdDevPerIsland],
    ['余分な道の本数', '', stats.extraEdgeCount],
    ['余分な道／土地数', '%', stats.extraEdgeRatio],
  ]);

  append('## 土地の種類ごと');
  append();
  append('同じ地形は環境も発見物も見た目も同じなので、並べても島は広くならない。個数は');
  append('`max_sites_per_type` で頭打ちにし、そこへ届く前から `crowding_penalty` で他の型へ譲らせている');
  append('（TerrainGeneration.md 3.4節）。');
  append();
  appendStatTable('項目', [['島あたりの種類数', '種類', stats.typesPerIsland]]);

  append('| 種類 | 出現する島 | 平均個数 | 出た島での平均 | 最大 |');
  append('| --- | --- | --- | --- | --- |');
  for (const [name, stat] of stats.countByType) {
    const appeared = 1 - stat.shareOf(0);
    const meanWhenPresent = appeared === 0 ? 0 : stat.mean / appeared;
    append(
      `| ${name} | ${(appeared * 100).toFixed(1)}% | ${stat.mean.toFixed(2)} |` +
        ` ${meanWhenPresent.toFixed(2)} | ${stat.max.toFixed(0)} |`,
    );
  }
  append();

  append('## 土地ごと');
  append();
  appendStatTable('項目', [['次数', '本', stats.degree]]);

  append('### 次数の分布');
  append();
  append('| 次数 | 割合 |');
  append('| --- | --- |');
  let listed = 0;
  for (let degree = 1; degree <= MAX_LISTED_DEGREE; degree++) {
    const share = stats.degree.shareOf(degree);
    listed += share;
    append(`| ${degree}本 | ${(share * 100).toFixed(2)}% |`);
  }
  append(`| ${MAX_LISTED_DEGREE + 1}本以上 | ${((1 - listed) * 100).toFixed(2)}% |`);
  append();

  append('## 道ごと');
  append();
  appendStatTable('項目', [['移動時間', '分', stats.travelMinutes]]);

  return lines.join('\n') + '\n';
}

const REPORT_PATH = join('docs', 'diagnostics', 'TerrainStats.md');

/** 定義から島を生成して測り、レポートの中身を作る。再生成と鮮度の確認が同じものを見るための1箇所。 */
function buildReportFromDefinitions(): string {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();

  const stats = createStats(codex.generation!.locationTypes.map((type) => type.name));
  for (let seed = 0; seed < SEED_COUNT; seed++) {
    collect(stats, generateIsland(codex.generation, 'island', seed));
  }

  return buildReport(stats);
}

describe.runIf(process.env.RUN_TERRAIN_STATS === '1')('地形生成統計レポート', () => {
  it(`${SEED_COUNT}シード分の島を生成してTerrainStats.mdを再生成する`, () => {
    const report = buildReportFromDefinitions();
    writeFileSync(REPORT_PATH, report, 'utf8');
    console.log(`Report written to: ${REPORT_PATH}`);

    expect(report).toContain('# 地形生成統計レポート');
  }, 600_000);
});

/**
 * 生成済みの`TerrainStats.md`が、今の定義より古くなっていないか。
 *
 * **見るのは古さだけで、値の妥当性は見ない。** 値は生成の単体試験と、再生成したレポートの差分が持つ。
 */
describe('地形生成統計レポートの鮮度', () => {
  it('生成済みのTerrainStats.mdが、今の定義から作り直したものと一致する', () => {
    const stored = readFileSync(REPORT_PATH, 'utf8');

    expect(normalizeNewlines(stored), "古い。'npm run stats:terrain'で再生成する").toBe(
      normalizeNewlines(buildReportFromDefinitions()),
    );
  }, 600_000);
});

/** CRLFの作業ツリーで生成したレポートが、LFの作業ツリーで食い違わないようにする。 */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n');
}
