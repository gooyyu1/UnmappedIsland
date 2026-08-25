import { join } from 'node:path';
import { activityHoursOf } from '../../src/analysis/activityHours';
import type { BaseDailyPhases, LocationTypeDay } from '../../src/analysis/dailyPhases';
import {
  dailyPhasesOf,
  locationTypeDaysOf,
  OUTDOOR_WINDOW_MINUTES,
  SURVIVAL_GATHERING_MINUTES,
  WORK_SHARES,
} from '../../src/analysis/dailyPhases';
import { SEASON_CLIMATE } from '../../src/analysis/seasonalRain';
import type { GenerationScopeDef } from '../../src/domain/generation/GenerationScopeDef';
import type { IslandMap } from '../../src/domain/generation/IslandMap';
import { generateIsland } from '../../src/domain/generation/TerrainGenerator';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { describeReportFreshness, describeReportRegeneration } from '../support/generatedReport';
import { Stat } from '../support/Stat';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * パスネットワーク（TerrainGeneration.md 3.5節）の現在の実装について、土地1つあたりの道の本数
 * （連結数）などの統計を計測し、`docs/diagnostics/TerrainStats.md`へ書き出す。
 *
 * 「繋がりすぎ/繋がらなすぎ」を数値で見るためのもので、`extra_edge_detour_factor` 等を変えた後に
 * 再生成する: `npm run stats:terrain`。再生成と鮮度の形は `tests/support/generatedReport.ts` が持つ。
 * 500シードの生成は1秒で済むので、鮮度は丸ごと作り直して比べる。
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
  /** 道1本あたり: 距離（m）・両端の高低差（m）・移動時間（分）。 */
  readonly distanceMeters: Stat;
  readonly climbMeters: Stat;
  readonly travelMinutes: Stat;

  /** 島1つあたり: 最も条件の良い拠点から見た片道（分）。 */
  readonly chosenBaseOneWayMinutes: Stat;
  /** 土地1つあたり: その土地を拠点にしたときの片道（分）。 */
  readonly anyBaseOneWayMinutes: Stat;

  /** 島1つあたり: 最も条件の良い拠点から見た、局面ごとの1日。 */
  readonly exploration: ExplorationPhaseStats;
  readonly steady: SteadyPhaseStats;
}

/** 探索の局面（島を開き切るまで）の分布。 */
interface ExplorationPhaseStats {
  /** 島の全土地を探索率100%まで開くのに要る探索時間の合計（分）。 */
  readonly explorationMinutes: Stat;
  /** 日帰りだけで開き切る行程。**成立しない島は標本に入らない**ので、nがその島数になる。 */
  readonly dayTripDays: Stat;
  readonly dayTripTravelMinutesPerDay: Stat;
  readonly dayTripExplorationMinutesPerDay: Stat;
  /** 土地ごとに安いほうを採ったときの日数と、そのうち泊まりを選んだ土地の数。 */
  readonly mixedDays: Stat;
  readonly stayOverSiteCount: Stat;
  /** 日帰りでは1分も探索が進まない土地の数。 */
  readonly dayTripImpossibleSiteCount: Stat;
}

/** 定常の局面（開き切った後）の1日の分布。 */
interface SteadyPhaseStats {
  readonly travelMinutesPerDay: Stat;
  readonly workMinutesPerDay: Stat;
  /**
   * 屋外の山1,000分あたりに要る日数。**日数を出すのはこちら**——1周回の山の量はどの島でも同じなので、
   * 島ごとの日数を平均するには、率ではなくその逆数を平均する。
   */
  readonly daysPerThousandWorkMinutes: Stat;
  /** 山の配分の呼び名 → その組の行き先。**その組の土地がある島だけ**を数えるので、nが出現数になる。 */
  readonly byShare: ReadonlyMap<string, ShareStats>;
}

/** 山の配分1つの分布。`dayShare`は、その組へ費やす日数が定常の局面に占める割合。 */
interface ShareStats {
  readonly roundTripMinutes: Stat;
  readonly workMinutesPerDay: Stat;
  readonly dayShare: Stat;
}

function addDailyPhases(stats: TerrainStats, base: BaseDailyPhases): void {
  const exploration = stats.exploration;
  exploration.explorationMinutes.add(base.exploration.explorationMinutes);
  exploration.mixedDays.add(base.exploration.mixedDays);
  exploration.stayOverSiteCount.add(base.exploration.stayOverSiteCount);
  exploration.dayTripImpossibleSiteCount.add(base.exploration.dayTripImpossibleSiteCount);
  if (base.exploration.dayTripDays !== undefined) {
    exploration.dayTripDays.add(base.exploration.dayTripDays);
    exploration.dayTripTravelMinutesPerDay.add(base.exploration.dayTripTravelMinutesPerDay!);
    exploration.dayTripExplorationMinutesPerDay.add(base.exploration.dayTripExplorationMinutesPerDay!);
  }

  stats.steady.travelMinutesPerDay.add(base.steady.travelMinutesPerDay);
  stats.steady.workMinutesPerDay.add(base.steady.workMinutesPerDay);
  stats.steady.daysPerThousandWorkMinutes.add(1000 / base.steady.workMinutesPerDay);
  for (const share of base.steady.shares) {
    const stat = stats.steady.byShare.get(share.label)!;
    stat.roundTripMinutes.add(share.roundTripMinutes);
    stat.workMinutesPerDay.add(share.workMinutesPerDay);
    stat.dayShare.add(share.dayShare);
  }
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
    distanceMeters: new Stat(),
    climbMeters: new Stat(),
    travelMinutes: new Stat(),
    chosenBaseOneWayMinutes: new Stat(),
    anyBaseOneWayMinutes: new Stat(),
    exploration: {
      explorationMinutes: new Stat(),
      dayTripDays: new Stat(),
      dayTripTravelMinutesPerDay: new Stat(),
      dayTripExplorationMinutesPerDay: new Stat(),
      mixedDays: new Stat(),
      stayOverSiteCount: new Stat(),
      dayTripImpossibleSiteCount: new Stat(),
    },
    steady: {
      travelMinutesPerDay: new Stat(),
      workMinutesPerDay: new Stat(),
      daysPerThousandWorkMinutes: new Stat(),
      byShare: new Map(
        WORK_SHARES.map((share) => [
          share.label,
          { roundTripMinutes: new Stat(), workMinutesPerDay: new Stat(), dayShare: new Stat() },
        ]),
      ),
    },
  };
}

function collect(
  stats: TerrainStats,
  map: IslandMap,
  scope: GenerationScopeDef,
  elevationSpan: number,
  locationDays: ReadonlyMap<number, LocationTypeDay>,
): void {
  const metersPerElevationUnit = scope.metersPerElevationUnit(elevationSpan);
  const elevationOf = (site: number): number => map.sites[site].axisValues.get(scope.elevationAxis)!;

  const n = map.sites.length;
  const degrees = new Array<number>(n).fill(0);
  for (const edge of map.edges) {
    degrees[edge.a]++;
    degrees[edge.b]++;
    stats.distanceMeters.add(edge.distanceMeters);
    stats.climbMeters.add(Math.abs(elevationOf(edge.a) - elevationOf(edge.b)) * metersPerElevationUnit);
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

  const phases = dailyPhasesOf(map, locationDays);
  stats.chosenBaseOneWayMinutes.add(phases.bestBase.oneWayMinutes);
  for (const base of phases.bases) stats.anyBaseOneWayMinutes.add(base.oneWayMinutes);
  addDailyPhases(stats, phases.bestBase);
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
  append('移動時間は「距離 ÷ 歩く速さ × 両端のmove_costの平均 ＋ 高低差 ÷ 登り下りの速さ」');
  append('（TerrainGeneration.md 3.5節）。距離も高低差も現実の長さで、縮尺と速さは');
  append('`generation_scopes.island` が別々に宣言している。');
  append();
  appendStatTable('項目', [
    ['距離', 'm', stats.distanceMeters],
    ['両端の高低差', 'm', stats.climbMeters],
    ['移動時間', '分', stats.travelMinutes],
  ]);

  append('## 島の広さ');
  append();
  append('拠点から他の土地への片道（最短経路）の平均。**拠点を選ぶと縮む**——プレイヤーは拠点を');
  append('選べるので、1周回で実際に払うのは上の行に近い。');
  append();
  appendStatTable('拠点の選び方', [
    ['他の土地への片道が平均で最も短い土地', '分', stats.chosenBaseOneWayMinutes],
    ['どの土地を拠点にしてもよいとき', '分', stats.anyBaseOneWayMinutes],
  ]);

  append('## 局面ごとの1日');
  append();
  append('拠点を出て仕事をして帰る1日を、局面ごとに数える（ContentSkeleton.md 8.2節・8.3節）。');
  append('計算は`src/analysis/dailyPhases.ts`で、拠点は上の「片道が平均で最も短い土地」。');
  append();
  append('**数え方は局面をまたいで1つだけ。**');
  append();
  append('```');
  append(
    `その日その土地で進む仕事（分） = min(${OUTDOOR_WINDOW_MINUTES} − 往復の移動 −` +
      ` ${SURVIVAL_GATHERING_MINUTES}, その土地の活動できる時間)`,
  );
  append('```');
  append();
  append(`- **${OUTDOOR_WINDOW_MINUTES}分** = 屋外の枠。太陽が出ている12時間で、移動のしきい値を`);
  append('  満たす時間そのもの。');
  append(`- **${SURVIVAL_GATHERING_MINUTES}分** = 1日を賄う生存の採取（BalanceStats.mdの最小労働から`);
  append('  睡眠を引いた分）。');
  append('- **その土地の活動できる時間** = ClimateSystemStats.md「土地×季節ごとの活動時間」の季節平均。');
  append('  遠さは移動の項として、暗さは頭打ちとして、同じ1行に入る。');
  append('- 1日は1つの土地で使う（往復1回）。余った時間は次の土地へ繰り越さない。');
  append('- 土地の間は最短経路をたどる。');
  append();

  append('### 探索の局面（島を開き切るまで）');
  append();
  append('未踏の土地を、拠点から近い順に探索率100%まで開いていく行程。**遠い土地へ着くのに要る道は、');
  append('手前の土地を開く過程で必ず出る**ので、開く順は移動時間の小さい順に採れる');
  append('（ExplorationSystem.md 3.2節）。');
  append();
  append('**泊まりがけは、滞在中の生存の採取を現地で払わない**（補給を持ち込む行程、');
  append('GameEndings.md 9.2節）。1日に進む探索がその土地の活動できる時間を超えられないことと、');
  append('往復の移動も屋外の枠から出ることの2つだけで縛る。');
  append();
  appendStatTable('項目', [
    ['島を開くのに要る探索時間の合計', '分', stats.exploration.explorationMinutes],
    ['開き切るまでの日数（日帰りだけ）', '日', stats.exploration.dayTripDays],
    ['1日あたりの移動（往復、日帰りだけ）', '分', stats.exploration.dayTripTravelMinutesPerDay],
    ['1日あたりに進む探索（日帰りだけ）', '分', stats.exploration.dayTripExplorationMinutesPerDay],
    ['開き切るまでの日数（泊まりも使う）', '日', stats.exploration.mixedDays],
    ['泊まりのほうが安い土地', '個', stats.exploration.stayOverSiteCount],
    ['日帰りでは1分も探索が進まない土地', '個', stats.exploration.dayTripImpossibleSiteCount],
  ]);
  append(
    `日帰りだけで開き切れる島は ${((stats.exploration.dayTripDays.count / SEED_COUNT) * 100).toFixed(1)}%` +
      `（${stats.exploration.dayTripDays.count}/${SEED_COUNT}）。残りは、往復で枠が尽きる土地を` +
      '1つ以上持つ。',
  );
  append();

  append('### 定常の局面（開き切った後の1日）');
  append();
  append('探索は終わっていて、山（ContentSkeleton.md 4節）だけを進める1日。行き先は**山の土地の配分**');
  append('が決め、その組の中では**その日の実入りが最も多い土地**を選ぶ（同じなら近いほう）。');
  append('**島に無い組の配分は、ある組へ按分する。**');
  append();
  append('**配分は仕事の量の配分であって、日数の配分ではない。** 1日は1つの土地で使うので、ある組へ');
  append('費やす日数はその組の仕事量をその土地の1日の実入りで割ったものになり、下の「1日に進む山」は');
  append('その日数で重み付けした平均になる。');
  append();
  append('**日数を出すのは最後の行。** 1周回の山の量はどの島でも同じなので、島ごとの日数を平均するには');
  append('率ではなくその逆数を平均する——「1日に進む山」の平均で割ると、日数は短く出る。');
  append();
  appendStatTable('項目', [
    ['1日の移動（往復）', '分', stats.steady.travelMinutesPerDay],
    ['1日に進む山', '分', stats.steady.workMinutesPerDay],
    ['屋外の山1,000分あたりの日数', '日', stats.steady.daysPerThousandWorkMinutes],
  ]);

  append('配分ごとの内訳（その組の土地がある島だけを数えるので、右端がその島数の割合になる）。');
  append();
  append('| 配分 | 仕事の割合 | 往復の移動 | 1日に進む山 | 日数の割合 | その組を持つ島 |');
  append('| --- | --- | --- | --- | --- | --- |');
  for (const share of WORK_SHARES) {
    const stat = stats.steady.byShare.get(share.label)!;
    append(
      `| ${share.label} | ${(share.share * 100).toFixed(0)}% |` +
        ` ${stat.roundTripMinutes.mean.toFixed(2)}分 | ${stat.workMinutesPerDay.mean.toFixed(2)}分 |` +
        ` ${(stat.dayShare.mean * 100).toFixed(1)}% |` +
        ` ${((stat.dayShare.count / SEED_COUNT) * 100).toFixed(1)}% |`,
    );
  }
  append();

  return lines.join('\n') + '\n';
}

const REPORT_PATH = join('docs', 'diagnostics', 'TerrainStats.md');

/** 定義から島を生成して測り、レポートの中身を作る。再生成と鮮度の確認が同じものを見るための1箇所。 */
function buildReportFromDefinitions(): string {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();

  const scope = codex.generation!.scopes.get('island')!;
  const elevationRange = codex.generation!.axes.get(scope.elevationAxis)!.range;
  const elevationSpan = elevationRange.max - elevationRange.min;

  const locationDays = locationTypeDaysOf(
    codex,
    activityHoursOf(
      codex,
      SEASON_CLIMATE.map((season) => ({
        seasonName: season.name,
        durationDays: season.durationDays,
        hoursByWeather: new Map(Object.entries(season.hoursByWeather)),
      })),
    ),
  );

  const stats = createStats(codex.generation!.locationTypes.map((type) => type.name));
  for (let seed = 0; seed < SEED_COUNT; seed++) {
    collect(stats, generateIsland(codex.generation, 'island', seed), scope, elevationSpan, locationDays);
  }

  return buildReport(stats);
}

describeReportRegeneration(REPORT_PATH, 'RUN_TERRAIN_STATS', buildReportFromDefinitions, [
  '# 地形生成統計レポート',
]);

describeReportFreshness(REPORT_PATH, 'npm run stats:terrain', buildReportFromDefinitions);
