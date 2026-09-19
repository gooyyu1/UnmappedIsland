import { describe, expect, it } from 'vitest';
import { buildBalanceTables, WHOLE_ISLAND } from '../../src/analysis/balanceTables';
import { MINUTES_PER_DAY } from '../../src/domain/worldTime';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';

/**
 * 同梱の定義に対して、土地に留まって1日ぶんの需要を埋める労働（`daily_minimum`、
 * BalanceStats.md「1日を賄う最小労働」）が、どの土地でも1日に収まること。
 *
 * **問うのは「数えられた分だけで既に1日を超えていないか」だけ。** 献立に載るのは値段の付く経路だけ
 * なので、`unmet` の立つ土地の合計は本当の値段より小さい——つまりこの合計は常に下限で、**下限が1日を
 * 超えていれば、その土地に留まって1日を回せないことが献立の中身によらず言える**。逆に収まっている
 * ことは、回せることの証明にはならない（この検査はそこまでは言わない）。
 *
 * 岩の海岸と岸壁が、ヤシの実の漂着以外に`vitamin`を返す物を持たず、1日ぶんの`vitamin`を漂着から
 * 集めるだけで1000分を超えていた（issue #2403）。
 */
describe('土地に留まって1日を賄う労働', () => {
  const tables = buildBalanceTables(bundledCodex(), SAMPLE_CHARACTER);
  const lands = tables.places.filter((place) => place.name !== WHOLE_ISLAND);

  it('土地の行が1つも無いということが無い', () => {
    // 土地の数え方が壊れると下の検査は空の一覧を回して緑で通るので、先に顔ぶれが在ることで留める。
    expect(lands.length).toBeGreaterThan(0);
  });

  it('数えられた分だけで1日を超える土地は無い', () => {
    const over = lands
      .filter((land) => land.menu.totalMinutes > MINUTES_PER_DAY)
      .map((land) => `${land.name}: ${Math.round(land.menu.totalMinutes)}分`);

    expect(over).toEqual([]);
  });
});
