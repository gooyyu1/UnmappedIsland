import { describe, expect, it } from 'vitest';
import { buildBalanceTables, WHOLE_ISLAND } from '../../src/analysis/balanceTables';
import {
  SLEEP_MINUTES_PER_DAY,
  SURVIVAL_GATHERING_MINUTES,
  WORK_SHARES,
} from '../../src/analysis/dailyPhases';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 局面ごとの1日（`src/analysis/dailyPhases.ts`）が置いている前提の検査。
 *
 * 1日の勘定は、書き写した2つの数（生存の採取・山の配分）に乗っている。**どちらも崩れても
 * レポートは静かに出続ける**ので、崩れた時点で赤くする。
 */
describe('局面ごとの1日の前提', () => {
  it('生存の採取が、収支表の最小労働から睡眠を引いた分と一致する', () => {
    const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    const wholeIsland = buildBalanceTables(codex, SAMPLE_CHARACTER).places.find(
      (place) => place.name === WHOLE_ISLAND,
    );

    // BalanceStats.mdが載せるのと同じ丸め方（分の整数）で比べる。
    expect(wholeIsland, `収支表に ${WHOLE_ISLAND} の行が無い`).toBeDefined();
    expect(Math.round(wholeIsland!.menu.totalMinutes), '1日を賄う最小労働').toBe(
      SURVIVAL_GATHERING_MINUTES + SLEEP_MINUTES_PER_DAY,
    );
  });

  it('山の配分の割合が、合計で1になる', () => {
    const total = WORK_SHARES.reduce((sum, share) => sum + share.share, 0);

    expect(total, '山の配分の合計').toBe(1);
  });
});
