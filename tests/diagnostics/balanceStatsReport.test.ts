import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  BalanceTables,
  Device,
  NamedAmount,
  PropertyChains,
  RoutePrerequisite,
  RouteStep,
} from '../../src/analysis/balanceTables';
import {
  buildBalanceTables,
  isGap,
  MINUTES_PER_DAY,
  MINUTES_PER_TICK,
  TICKS_PER_DAY,
} from '../../src/analysis/balanceTables';
import { islandLocationsOf } from '../../src/analysis/islandLocations';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import type { YamlRecord, YamlReportSection } from '../support/generatedReport';
import {
  describeDocumentedSections,
  describeReportFreshness,
  describeYamlReportRegeneration,
  formatYamlReport,
  rounded,
} from '../support/generatedReport';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 定義から計算した収支表（`src/analysis/balanceTables.ts`）を`stats/balance.yaml`へ書き出す。
 *
 * **書き出すのは数値だけ。** 何を測ったか・引いた線・数えていないものは、手書きの
 * `docs/diagnostics/BalanceStats.md` が持つ。
 *
 * 同じ表はコーデックスビューア（`src/codex-viewer/balancePage.ts`）でも見られる。**書き出しを残すのは
 * 差分のため**——数値を触ったときに何がどう動いたかは`git diff`でしか読めず、ビューアはその瞬間の
 * 姿しか見せられない。
 *
 * 定義の数値を変えた後に再生成する: `npm run stats:balance`。再生成と鮮度の形は
 * `tests/support/generatedReport.ts` が持つ。表を作り直すのは1秒で済むので、鮮度は丸ごと作り直して比べる。
 */

function stepsText(steps: readonly RouteStep[]): string {
  return steps.map((step) => `${step.objectName}.${step.stepName}`).join(' → ');
}

/** 値の増減・産出の一覧。名前と量を分けて持つ——読む側で名前から量を引けるようにする。 */
function amountRecords(amounts: readonly NamedAmount[]): YamlRecord[] {
  return amounts.map(({ name, amount }) => ({ name, amount: rounded(amount, 2) }));
}

/**
 * 前提（要る道具・他の土地で用意する材料）。**`object`が実際に使う型で、nullなら島のどこにも
 * 入手経路が無い**（内容の穴）。`minutes`のnullは値段が付かないことで、穴とは限らない——朽ちない
 * 設備の待ち生産でしか得られない道具は、手に入るが按分できない。
 */
function prerequisiteRecords(prerequisites: readonly RoutePrerequisite[]): YamlRecord[] {
  return prerequisites.map(({ label, objectName, minutes, imported }) => ({
    label,
    object: objectName ?? null,
    minutes: rounded(minutes, 1),
    imported,
  }));
}

/**
 * 経路が待つ設備と、その周期が進む条件。**`device_count`はこれらが成立し続けた場合の数**なので、
 * 数と条件は同じ行で読めなければならない（issue #981）。周期とレートは`devices`節が持つ。
 */
function deviceRecords(devices: readonly Device[]): YamlRecord[] {
  return devices.map(({ deviceName, stepName, condition }) => ({
    device: deviceName,
    step: stepName,
    condition,
  }));
}

function buildSections(codex: WorldCodex, tables: BalanceTables): readonly YamlReportSection[] {
  const chainPlaces = tables.places.filter((place) => place.properties.length > 0);

  return [
    {
      key: 'meta',
      records: [
        {
          character: SAMPLE_CHARACTER,
          minutes_per_tick: MINUTES_PER_TICK,
          ticks_per_day: TICKS_PER_DAY,
          minutes_per_day: MINUTES_PER_DAY,
        },
      ],
    },
    // 表が数えなかった土地と、外した根拠のタグ（`islandLocations`）。
    {
      key: 'excluded_locations',
      records: islandLocationsOf(codex).excludedSea.map(({ def, tag }) => ({ location: def.name, tag })),
    },
    { key: 'daily_needs', records: dailyNeedRecords(chainPlaces.flatMap((place) => place.properties)) },
    {
      key: 'daily_minimum',
      records: chainPlaces
        .filter((place) => place.menu.entries.length > 0 || place.menu.unmet.length > 0)
        .map((place) => ({
          place: place.name,
          total_minutes: rounded(place.menu.totalMinutes, 0),
          day_percent: rounded((place.menu.totalMinutes * 100) / MINUTES_PER_DAY, 1),
          unmet: place.menu.unmet,
        })),
    },
    {
      key: 'daily_minimum_menu',
      records: chainPlaces.flatMap((place) =>
        place.menu.entries.map((entry) => ({
          place: place.name,
          route: stepsText(entry.route.steps),
          repetitions: rounded(entry.repetitions, 2),
          minutes: rounded(entry.minutes, 0),
        })),
      ),
    },
    {
      key: 'chain_routes',
      records: chainPlaces.flatMap((place) =>
        place.properties.flatMap((chains) =>
          chains.routes
            .filter((entry) => !entry.route.untimed)
            .map((entry) => ({
              place: place.name,
              property: chains.propertyName,
              route: stepsText(entry.route.steps),
              imported: entry.route.needsImport,
              per_unit_minutes: rounded(entry.perUnitMinutes, 2),
              explore_minutes: rounded(entry.route.exploreMinutes / entry.gain, 2),
              other_minutes: rounded(entry.route.craftMinutes / entry.gain, 2),
              daily_minutes: rounded(entry.dailyMinutes, 0),
              day_percent: rounded(entry.dailyShare, 1),
              device_count: rounded(entry.simultaneousDeviceCount, 1),
              devices: deviceRecords(entry.route.devices),
              deltas: amountRecords(entry.route.deltas),
              prerequisites: prerequisiteRecords(entry.route.prerequisites),
            })),
        ),
      ),
    },
    {
      key: 'chain_untimed_routes',
      records: tables.places.flatMap((place) =>
        place.properties.flatMap((chains) =>
          chains.routes
            .filter((entry) => entry.route.untimed)
            .map((entry) => ({
              place: place.name,
              property: chains.propertyName,
              route: stepsText(entry.route.steps),
              deltas: amountRecords(entry.route.deltas),
            })),
        ),
      ),
    },
    {
      key: 'chain_gaps',
      records: tables.gaps.flatMap((gap): YamlRecord[] =>
        gap.blockedRoutes.length === 0
          ? [{ label: gap.label, blocked_route: null, deltas: [] }]
          : gap.blockedRoutes.map((route) => ({
              label: gap.label,
              blocked_route: stepsText(route.steps),
              deltas: amountRecords(route.deltas),
            })),
      ),
    },
    {
      key: 'object_costs',
      records: tables.objectCosts.map((cost) => ({
        object: cost.objectName,
        total_minutes: rounded(cost.minutes, 1),
        explore_minutes: rounded(cost.minutes === undefined ? undefined : (cost.exploreMinutes ?? 0), 1),
        other_minutes: rounded(cost.minutes === undefined ? undefined : (cost.craftMinutes ?? 0), 1),
        days: rounded(cost.days, 2),
        obtainable_without_cost: cost.obtainableWithoutCost,
        blocked_by_tool: cost.blockedByTool,
        steps: stepsText(cost.steps) || null,
        prerequisites: prerequisiteRecords(cost.prerequisites),
        missing: cost.missing,
      })),
    },
    {
      key: 'devices',
      records: tables.places.flatMap((place) =>
        place.devices.map((device) => ({
          place: place.name,
          device: device.deviceName,
          step: device.stepName,
          condition: device.condition,
          period_minutes: rounded(device.periodMinutes, 0),
          product: device.productName,
          per_cycle: rounded(device.perCycle, 3),
          per_day: rounded(device.perDay, 2),
          lifetime_property: device.lifetimeProperty ?? null,
          lifetime_days: rounded(device.lifetimeDays, 1),
          over_lifetime: rounded(device.overLifetime, 1),
          build_minutes: rounded(device.buildMinutes, 1),
          labor_minutes_per_unit: rounded(device.laborPerUnit, 2),
        })),
      ),
    },
    {
      key: 'rain_water',
      records: tables.rainWater.map((row) => ({
        container: row.containerName,
        season: row.seasonName,
        capacity_ml: rounded(row.capacity, 0),
        rain_ml_per_day: rounded(row.rainPerDay, 0),
        evaporation_ml_per_day: rounded(row.evaporationPerDay, 0),
        net_ml_per_day: rounded(row.netPerDay, 0),
      })),
    },
    {
      key: 'consumption',
      records: tables.consumption.flatMap((row) =>
        tables.characterNames.map((character, index) => {
          const perTick = row.perTickByCharacter[index];
          return {
            property: row.propertyName,
            condition: row.condition,
            character,
            per_tick: rounded(perTick, 2),
            per_day: rounded(perTick === undefined ? undefined : perTick * TICKS_PER_DAY, 0),
          };
        }),
      ),
    },
    {
      key: 'supply',
      records: tables.supply.map((row) => ({
        owner: row.ownerName,
        step: row.stepName,
        kind: row.kind,
        labor_minutes: rounded(row.laborMinutes, 0),
        unresolved_references: row.hasUnresolvedReferences,
        elapsed_minutes: rounded(row.elapsedMinutes, 0),
        spawns: amountRecords(row.spawns),
        agent_deltas: amountRecords(row.agentDeltas),
        self_deltas: amountRecords(row.selfDeltas),
      })),
    },
  ];
}

/**
 * 1日に要る量。**土地をまたいで同じ**（要る量を決めるのはキャラクタで、土地ではない）ので、
 * 土地ごとに繰り返さずここへ1度だけ出す。
 */
function dailyNeedRecords(properties: readonly PropertyChains[]): YamlRecord[] {
  const records = new Map<string, YamlRecord>();
  for (const chains of properties)
    records.set(chains.propertyName, {
      property: chains.propertyName,
      daily_need: rounded(chains.dailyNeed, 0),
      lethal: chains.lethal,
      supplied_by: chains.suppliedByNames,
    });
  return [...records.values()];
}

const REPORT_PATH = join('stats', 'balance.yaml');
const DOC_PATH = join('docs', 'diagnostics', 'BalanceStats.md');

/** 定義を読んで収支を計算する。再生成と鮮度の確認が同じものを見るための1箇所。 */
function balanceFromDefinitions(): { readonly codex: WorldCodex; readonly tables: BalanceTables } {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  return { codex, tables: buildBalanceTables(codex, SAMPLE_CHARACTER) };
}

function buildReportFromDefinitions(): string {
  const { codex, tables } = balanceFromDefinitions();
  return formatYamlReport(
    [
      'アイテム収支。定義（src/assets/world-codex/*.yaml）だけから計算した「時間あたりの収支」。',
      '生成物。手で書き換えず、npm run stats:balance で作り直す。',
      '何を測ったか・引いた線・数えていないものは docs/diagnostics/BalanceStats.md。',
    ],
    buildSections(codex, tables),
  );
}

const DOCUMENTED_SECTIONS = describeDocumentedSections(DOC_PATH, REPORT_PATH);

describeYamlReportRegeneration(
  REPORT_PATH,
  'RUN_BALANCE_STATS',
  buildReportFromDefinitions,
  DOCUMENTED_SECTIONS.required,
);

describeReportFreshness(REPORT_PATH, 'npm run stats:balance', buildReportFromDefinitions);

/**
 * 雨で溜まる水は、**時間を数えられていないだけで内容の穴ではない**（issue #660）。穴として数えられると
 * 水を要る経路がまとめて塞がれるので、`chain_gaps` に載っていないことを見る。
 *
 * レポートの字面では表せない——この節は穴が1つも無ければ空になり、載る名前も `x → y` の形を取りうる。
 * 再生成（`RUN_BALANCE_STATS`）の中に置くとCIが見ないままになる（issue #768）ので、常時走らせる。
 */
describe('収支の穴', () => {
  it('雨で溜まる水が、島全体で入手経路が無いものに数えられていない', () => {
    const gaps = balanceFromDefinitions().tables.gaps.map((gap) => gap.label);

    expect(gaps.filter((label) => label.includes('water_liquid'))).toEqual([]);
  }, 600_000);
});

/**
 * 値段の付かない道具では `imported` が常に偽になる（BalanceStats.md の `imported` の説明、
 * issue #1217）。
 * **同梱の定義には、その差が表に出る場面がまだ無い**ことを見る——値段の付かない道具を要る経路が
 * 現れた時点で、その経路の `imported` は「どこで用意するか」を答えていないことになる。
 */
describe('値段の付かない道具', () => {
  it('前提として要る道具に、値段の付かないものが1つも無い', () => {
    const { tables } = balanceFromDefinitions();
    const prerequisites = [
      ...tables.places.flatMap((place) =>
        place.properties.flatMap((chains) => chains.routes.flatMap((entry) => entry.route.prerequisites)),
      ),
      ...tables.objectCosts.flatMap((cost) => cost.prerequisites),
    ];

    // 型は決まっているのに値段が付かないものが、値段の付かない道具（穴のほうは型が決まらない）。
    expect(
      prerequisites
        .filter((prerequisite) => !isGap(prerequisite) && prerequisite.minutes === undefined)
        .map((prerequisite) => prerequisite.label),
    ).toEqual([]);
  }, 600_000);
});

/**
 * 代入（`set`）で消える増減が、期待値から落ちていること（issue #1337）。
 *
 * 生肉を食べる枝のうち、食中毒の枝（重み12）は満腹を0へ代入するので、その枝では直前に足した500が
 * 残らない。**表は経路の比較に使うもの**なので、これを数えないと生の満腹が実際より安く出る。
 */
describe('代入で打ち消される増減', () => {
  it('生肉を食べたときの満腹が、食中毒の枝を引いた期待値になっている', () => {
    const { tables } = balanceFromDefinitions();
    const satietyOf = (ownerName: string): number | undefined =>
      tables.supply
        .find((row) => row.ownerName === ownerName && row.stepName === 'eat')
        ?.agentDeltas.find((delta) => delta.name === 'satiety')?.amount;

    // 重みは 100 : {prop: spoilage}=0 : {prop: spoilage}=0 : 12。
    expect(satietyOf('raw_meat')).toBeCloseTo((500 * 100) / 112, 2);
    expect(satietyOf('raw_meat__cure_salted')).toBeCloseTo((500 * 100) / 112, 2);
  }, 600_000);
});
