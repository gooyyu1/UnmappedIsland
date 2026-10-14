import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activityHoursOf, litPlacesOf, openAirGaleShareOf } from '../../src/analysis/activityHours';
import {
  cycleDaysOf,
  dailyBudgetOf,
  dailyPhasesOf,
  locationTypeDaysOf,
  SLEEP_MINUTES_PER_DAY,
  workPileAmountsOf,
  workTotalOf,
  WORK_PILES,
  WORK_SHARES,
} from '../../src/analysis/dailyPhases';
import { SEASON_CLIMATE } from '../../src/analysis/seasonalRain';
import { generateIsland } from '../../src/domain/generation/TerrainGenerator';
import { MINUTES_PER_DAY } from '../../src/domain/worldTime';
import { bundledBalanceTables, bundledCodex } from '../support/worldCodexFiles';

/**
 * 局面ごとの1日（`src/analysis/dailyPhases.ts`）が置いている前提の検査。
 *
 * 1日の勘定は、宣言（山の配分・山の一覧）と収支表の噛み合いに乗っている。**噛み合わなくなっても
 * レポートは静かに出続ける**ので、崩れた時点で赤くする。
 */
describe('局面ごとの1日の前提', () => {
  const codex = bundledCodex();
  const balance = bundledBalanceTables();
  const seasons = SEASON_CLIMATE.map((season) => ({
    seasonName: season.name,
    durationDays: season.durationDays,
    hoursByWeather: new Map(Object.entries(season.hoursByWeather)),
  }));
  const galeShare = openAirGaleShareOf(codex, seasons);

  it('収支表の最小労働が、睡眠と自由時間の両方を残す幅に収まっている', () => {
    // 最小労働が睡眠を割ると生存の採取が負になり、1日の実入りが全土地で水増しされる。
    expect(dailyBudgetOf(balance, galeShare).survivalGatheringMinutes, '昼に払う生存の採取').toBeGreaterThan(
      0,
    );
    // 1日を使い切ると自由時間が0以下になり、山の日数が出なくなる（ObjectCost.days）。
    expect(balance.surplusMinutes, '最小労働を払って残る自由時間').toBeGreaterThan(0);
  });

  it('1日の割り付けは、嵐で止まる時間を含めてちょうど24時間になる', () => {
    const budget = dailyBudgetOf(balance, galeShare);
    const total =
      budget.outdoorWindowMinutes +
      budget.nightCraftMinutes +
      budget.stormStopMinutes +
      SLEEP_MINUTES_PER_DAY;

    expect(total, '屋外＋夜の加工＋嵐で止まる時間＋睡眠').toBeCloseTo(MINUTES_PER_DAY, 6);
  });

  // 嵐は往復の移動も止める（ContentSkeleton.md 8.1.4節・8.2節）。頭打ちの側だけで嵐を引く形へ戻ると、
  // 屋外の枠で律速されている局面では嵐がどれだけ長くても日数が1日も動かない（issue #2297）。
  // 実測の嵐と、嵐の無い空とで、同じ島の1周回を比べる。
  it('屋外が嵐で閉ざされる時間は、1周回の日数を伸ばす', () => {
    // 嵐を1時間も測っていない実測は、比べる2つを同じにしてこの見張りを素通りさせる。
    expect(galeShare, '屋外が嵐で閉ざされる割合').toBeGreaterThan(0);

    const locationDays = locationTypeDaysOf(codex, activityHoursOf(codex, seasons));
    const amounts = workPileAmountsOf(codex, balance);
    const totalDaysOver = (share: number): number => {
      const budget = dailyBudgetOf(balance, share);
      const work = workTotalOf(amounts, budget);
      let totalDays = 0;
      for (let seed = 0; seed < 20; seed++) {
        const base = dailyPhasesOf(
          generateIsland(codex.generation, 'island', seed),
          locationDays,
          budget,
        ).bestBase;
        const cycle = cycleDaysOf(base, work);
        expect(cycle, `シード${seed}: 1周回が成立する`).toBeDefined();
        totalDays += cycle!.totalDays;
      }
      return totalDays;
    };

    expect(totalDaysOver(galeShare), '嵐のある空での1周回（20島の合計）').toBeGreaterThan(totalDaysOver(0));
  }, 30_000);

  // 1日の枠から引く嵐は、拠点でも行き先でもなく島全体の値（dailyBudgetOf）。成り立つのは、1日を
  // 過ごすどの土地にも風雨が届くときだけ——屋根に守られた土地が生まれると、そこで過ごす日の枠を
  // 縮めすぎる。
  it('島に生える土地は、どれも屋根に守られていない', () => {
    const siteNames = new Set(
      codex.generation!.locationTypes.map((type) => codex.objects.get(type.objectDefGlobalId).name),
    );
    const sheltered = litPlacesOf(codex).filter((place) => place.sheltered && siteNames.has(place.name));

    expect(siteNames.size, '島に生える土地の型').toBeGreaterThan(0);
    expect(
      sheltered.map((place) => place.name),
      '屋根に守られた土地',
    ).toEqual([]);
  });

  it('山の配分の割合が、合計で1になる', () => {
    const total = WORK_SHARES.reduce((sum, share) => sum + share.share, 0);

    expect(total, '山の配分の合計').toBe(1);
  });

  /**
   * `WORK_PILES` は1周回の日数の出どころで、ContentSkeleton.md 4節の表の写し。**系統を足しても山を
   * 足さなければ、1周回の日数は黙って短いまま**なので、表の行と系統（同 3節）の両方と突き合わせる。
   */
  it('山の一覧が、ContentSkeleton.md の系統と各系統の段の表に過不足なく一致する', () => {
    const doc = readFileSync(join('docs', 'world', 'ContentSkeleton.md'), 'utf8');
    const sectionOf = (heading: string): string[] => {
      const lines = doc.split(/\r?\n/);
      const start = lines.indexOf(heading);
      expect(start, `${heading} が見つからない`).toBeGreaterThanOrEqual(0);
      const end = lines.findIndex((line, index) => index > start && /^##? /.test(line));
      return lines.slice(start + 1, end === -1 ? lines.length : end);
    };
    const tableRows = (lines: string[]): string[][] =>
      lines
        .filter((line) => /^\| \d+ \|/.test(line))
        .map((line) => line.split('|').map((cell) => cell.trim()));

    const systems = tableRows(sectionOf('## 3. 繰り返し払う支出を系統に分ける')).map((cells) =>
      Number(cells[1]),
    );
    expect(systems, '同 3節の系統の表が読めない').not.toHaveLength(0);
    expect(
      [...new Set(WORK_PILES.map((pile) => pile.system))].sort((a, b) => a - b),
      '山の無い系統',
    ).toEqual(systems);

    const documented = tableRows(sectionOf('## 4. 各系統の段')).flatMap((cells) =>
      [...cells[4].matchAll(/pile=(\S+) days/g)].map((match) => `${cells[1]} ${match[1]}`),
    );
    expect(WORK_PILES.map((pile) => `${pile.system} ${pile.label}`).sort(), '同 4節の表の山').toEqual(
      documented.sort(),
    );
  });

  it('山が名乗る型とタグが、すべて収支表に値段を持つ', () => {
    // 値段が出ない型やどの型も名乗らないタグを名乗っていれば workPileAmountsOf が投げる。
    const amounts = workPileAmountsOf(codex, balance);

    expect(
      amounts.filter((amount) => amount.minutes <= 0).map((amount) => amount.pile.label),
      '量が0以下の山',
    ).toEqual([]);
    // 収支表を検査の本体で組むので、混み合った回には1件あたりの上限を越える。
    // 上限とその名乗り方は `vite.config.ts` の `testTimeout` のコメント（issue #2376）。
  }, 30_000);
});
