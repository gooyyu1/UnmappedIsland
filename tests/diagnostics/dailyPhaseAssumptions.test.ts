import { describe, expect, it } from 'vitest';
import { buildBalanceTables } from '../../src/analysis/balanceTables';
import { dailyBudgetOf, workPileAmountsOf, WORK_SHARES } from '../../src/analysis/dailyPhases';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 局面ごとの1日（`src/analysis/dailyPhases.ts`）が置いている前提の検査。
 *
 * 1日の勘定は、宣言（山の配分・山の一覧）と収支表の噛み合いに乗っている。**噛み合わなくなっても
 * レポートは静かに出続ける**ので、崩れた時点で赤くする。
 */
describe('局面ごとの1日の前提', () => {
  it('収支表の最小労働が、睡眠と自由時間の両方を残す幅に収まっている', () => {
    const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    const budget = dailyBudgetOf(buildBalanceTables(codex, SAMPLE_CHARACTER));

    // 最小労働が睡眠を割ると生存の採取が負になり、1日の実入りが全土地で水増しされる。
    expect(budget.survivalGatheringMinutes, '昼に払う生存の採取').toBeGreaterThan(0);
    // 1日を使い切ると自由時間が0以下になり、山の日数が出なくなる（ObjectCost.days）。
    expect(budget.surplusMinutes, '最小労働を払って残る自由時間').toBeGreaterThan(0);
  });

  it('山の配分の割合が、合計で1になる', () => {
    const total = WORK_SHARES.reduce((sum, share) => sum + share.share, 0);

    expect(total, '山の配分の合計').toBe(1);
  });

  it('山が名乗る型が、すべて収支表に値段を持つ', () => {
    const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    const balance = buildBalanceTables(codex, SAMPLE_CHARACTER);

    // 値段が出ない型を名乗っていれば workPileAmountsOf が投げる。
    const amounts = workPileAmountsOf(balance, dailyBudgetOf(balance));

    expect(
      amounts.filter((amount) => amount.minutes <= 0).map((amount) => amount.pile.label),
      '量が0以下の山',
    ).toEqual([]);
  });
});
