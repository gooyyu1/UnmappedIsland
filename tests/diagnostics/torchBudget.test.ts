import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { activityHoursOf, type SeasonWeatherHours } from '../../src/analysis/activityHours';
import { carriedLightEvOf } from '../../src/analysis/carriedLight';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { MINUTES_PER_TICK } from '../../src/domain/worldTime';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * 松明1本が何を開き、そのために何分払うのかの検査（`ContentSkeleton.md` 8.1.1.4節）。
 *
 * **活動時間表（`stats/climate.yaml`の`activity_hours`）は光源を数えない**ので、「松明を持てば
 * どうなるか」はその表の外側にある。ここが測るのはその補集合で、同じ切り方（土地×季節×時刻×天気を
 * しきい値で切る）へ光源の段数だけを足して出す。
 *
 * 8.1.1.4節が書いた数のうち、**割り算の結果はレポートのどのセルでもない**——明かり1分あたりの手間も、
 * 往復に要る本数も、燃焼時間と手間と道の長さが揃って初めて出る。出どころの印
 * （`tests/docs/docStatsCitations.test.ts`）はセルの書き写ししか見ないので、そこはここが持つ。
 */

const ROOT = join(__dirname, '..', '..');

function statsReport(fileName: string): Record<string, readonly Record<string, unknown>[]> {
  return parse(readFileSync(join(ROOT, 'stats', fileName), 'utf-8')) as Record<
    string,
    readonly Record<string, unknown>[]
  >;
}

/** その節の、セレクタを満たす唯一のレコードの数値。1件に定まらなければ落とす。 */
function cell(
  report: Record<string, readonly Record<string, unknown>[]>,
  section: string,
  selector: Record<string, unknown>,
  column: string,
): number {
  const matched = (report[section] ?? []).filter((record) =>
    Object.entries(selector).every(([key, value]) => record[key] === value),
  );
  expect(matched, `${section} の ${JSON.stringify(selector)} が1件に定まらない`).toHaveLength(1);
  const value = matched[0][column];
  expect(typeof value, `${section}.${column} が数でない`).toBe('number');
  return value as number;
}

const SKELETON_DOC = readFileSync(join(ROOT, 'docs', 'world', 'ContentSkeleton.md'), 'utf-8');

/** 文書の、その正規表現が捕らえた数。捕まらなければ落とす（書き換えで数が消えたことも壊れた状態）。 */
function numberIn(text: string, pattern: RegExp, label: string): number {
  const matched = pattern.exec(text);
  expect(matched, `${label} が文書から読めない（${String(pattern)}）`).not.toBeNull();
  return Number.parseFloat(matched![1]);
}

/**
 * 松明が燃え続ける分数。`life` の上限（tick）を暦の刻みへ直したもので、
 * **どちらを動かしても付いてくる**。
 */
function torchBurnMinutesOf(codex: WorldCodex): number {
  const torch = codex.objects.get(codex.objectNames.getId('torch'));
  const life = torch.tryGetPropertyDef(codex.propertyNames.getId('life'));
  expect(life?.range, '松明が燃え残り（life）のrangeを宣言している').toBeDefined();
  return life!.range!.max * MINUTES_PER_TICK;
}

/**
 * 天気を等しい重みで並べた季節1つ。**出現時間の実測は要らない**——ここで見たいのは「どの時刻の
 * どの天気でも開くか」で、1つでも閉じる組み合わせがあれば時間が24を割る、という形で読む。
 * 等重みにするのは、重み0の組み合わせを作らないため。
 */
function everyWeatherEqually(codex: WorldCodex): readonly SeasonWeatherHours[] {
  const world = codex.objects.get(codex.objectNames.getId('world'));
  const weatherDef = world.tryGetPropertyDef(codex.vocabulary.world.weatherId);
  expect(weatherDef?.stages.length, 'worldが天気の段を宣言している').toBeGreaterThan(0);

  const names = weatherDef!.stages.map((stage) => stage.name);
  const durationDays = names.length;
  return [
    {
      seasonName: 'すべての天気',
      durationDays,
      hoursByWeather: new Map(names.map((name) => [name, 24])),
    },
  ];
}

describe('松明1本が買うもの（ContentSkeleton.md 8.1.1.4節）', () => {
  const codex = bundledCodex();
  const torchEv = carriedLightEvOf(codex, 'torch');
  const burnMinutes = torchBurnMinutesOf(codex);
  const balance = statsReport('balance.yaml');
  const terrain = statsReport('terrain.yaml');
  const torchCostMinutes = cell(balance, 'object_costs', { object: 'torch' }, 'total_minutes');

  it('灯っているあいだは、どの土地のどの時刻でも行動が開く（嵐の屋外の採取だけが閉じる）', () => {
    const rows = activityHoursOf(codex, everyWeatherEqually(codex), torchEv);
    expect(rows.length, '土地が1つも出ない').toBeGreaterThan(0);

    for (const row of rows) {
      const where = `${row.locationName}`;
      expect(row.travelHoursPerDay, `${where}: 移動`).toBeCloseTo(24, 6);
      expect(row.explorationHoursPerDay, `${where}: 探索`).toBeCloseTo(24, 6);
      expect(row.handworkHoursPerDay, `${where}: 手元の作業`).toBeCloseTo(24, 6);
      // 嵐は明るさではなく風雨が止める（8.1.4節）ので、松明では埋まらない。屋根の下（浅い洞窟）
      // だけは風雨が届かず、採取も24時間開く。
      expect(row.gatheringHoursPerDay, `${where}: 屋外の採取`).toBeLessThanOrEqual(24 + 1e-6);
    }
    expect(
      rows.some((row) => row.gatheringHoursPerDay < 24 - 1e-6),
      '嵐で採取が閉じる土地が1つも無い（松明が風雨まで埋めている）',
    ).toBe(true);
  });

  it('1段下げると手元の作業だけが閉じる——+11 はそこでしか置けない', () => {
    const dimmer = activityHoursOf(codex, everyWeatherEqually(codex), torchEv - 1);

    expect(
      dimmer.every((row) => row.travelHoursPerDay > 24 - 1e-6),
      '移動は1段下げても開いたまま',
    ).toBe(true);
    expect(
      dimmer.every((row) => row.explorationHoursPerDay > 24 - 1e-6),
      '探索は1段下げても開いたまま',
    ).toBe(true);
    expect(
      dimmer.some((row) => row.handworkHoursPerDay < 24 - 1e-6),
      '1段下げても手元の作業が閉じない土地が1つも無い',
    ).toBe(true);
  });

  it('燃えるのは2時間で、文書もそう書いている', () => {
    expect(burnMinutes).toBe(120);
    expect(/松明1本は2時間で/.test(SKELETON_DOC), '8.1.1.4節の見出しが燃焼時間を2時間と書いている').toBe(
      true,
    );
  });

  it('明かり1分あたりの手間が、文書の書いた比と合う', () => {
    const written = numberIn(SKELETON_DOC, /明かり1分あたり([\d.]+)分/, '明かり1分あたりの手間');
    expect(torchCostMinutes / burnMinutes).toBeCloseTo(written, 2);
  });

  it('日が暮れてから拠点へ往復するなら2本要る（1本では帰り着けない）', () => {
    const written = numberIn(SKELETON_DOC, /日が暮れてから往復するなら(\d+)本/, '往復に要る本数');
    const roundTripMinutes = cell(terrain, 'base_one_way', { base: 'shortest_mean' }, 'mean') * 2;

    expect(burnMinutes * (written - 1), '1本少なければ足りない').toBeLessThan(roundTripMinutes);
    expect(burnMinutes * written, 'その本数で足りる').toBeGreaterThanOrEqual(roundTripMinutes);
  });

  it('光源を持たない1日は、起きているあいだが既に埋まっている', () => {
    const budget = (column: string): number => cell(terrain, 'daily_budget', {}, column);
    const minutesPerDay = 24 * 60;

    expect(
      budget('outdoor_window') + budget('night_craft') + budget('sleep'),
      '屋外の窓・炉端・睡眠で1日がちょうど埋まる（松明の入る先が無い）',
    ).toBe(minutesPerDay);
  });
});
