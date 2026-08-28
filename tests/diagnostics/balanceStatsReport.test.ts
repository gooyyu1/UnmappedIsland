import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  BalanceTables,
  NamedAmount,
  PropertyChains,
  RoutePrerequisite,
  RouteStep,
} from '../../src/analysis/balanceTables';
import {
  buildBalanceTables,
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
  RoundedNumber,
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

/**
 * 丸めた数。**決まらない値はnullで書く**——`—`と書くと、読む側では数ではなく文字列になって型が
 * 行ごとに変わる。`-0.00`は`0.00`へ均す（丸めで符号だけが残った値に意味は無い）。
 */
function rounded(value: number | undefined, digits = 1): RoundedNumber | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  const zero = (0).toFixed(digits);
  return new RoundedNumber(value.toFixed(digits) === `-${zero}` ? 0 : value, digits);
}

function stepsText(steps: readonly RouteStep[]): string {
  return steps.map((step) => `${step.objectName}.${step.stepName}`).join(' → ');
}

/** 値の増減・産出の一覧。名前と量を分けて持つ——読む側で名前から量を引けるようにする。 */
function amountRecords(amounts: readonly NamedAmount[]): YamlRecord[] {
  return amounts.map(({ name, amount }) => ({ name, amount: rounded(amount, 2) }));
}

/**
 * 前提（要る道具・他の土地で用意する材料）。`minutes`がnullなのは**入手経路が無い**ことで、
 * 決まらないのではない。
 */
function prerequisiteRecords(prerequisites: readonly RoutePrerequisite[]): YamlRecord[] {
  return prerequisites.map(({ label, minutes, imported }) => ({
    label,
    minutes: rounded(minutes),
    imported,
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
        total_minutes: rounded(cost.minutes),
        explore_minutes: rounded(cost.minutes === undefined ? undefined : (cost.exploreMinutes ?? 0)),
        other_minutes: rounded(cost.minutes === undefined ? undefined : (cost.craftMinutes ?? 0)),
        days: rounded(cost.days, 2),
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
          build_minutes: rounded(device.buildMinutes),
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
        actor_deltas: amountRecords(row.actorDeltas),
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
