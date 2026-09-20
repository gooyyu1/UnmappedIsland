import { describe, expect, it } from 'vitest';
import { buildBalanceTables, WHOLE_ISLAND } from '../../src/analysis/balanceTables';
import { MINUTES_PER_DAY } from '../../src/domain/worldTime';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';

/**
 * 同梱の定義に対して、土地に留まって1日ぶんの需要を埋める献立（`daily_minimum`、
 * BalanceStats.md「1日を賄う最小労働」）の合計が、どの土地でも1日に収まること。
 *
 * **見張るのはこの表が出す値そのもので、そこから「回せる／回せない」は導いていない。** 献立は
 * 貪欲解なので真の最小とは限らず（同節）、`unmet` の立つ土地では値段の付かなかった需要がそもそも
 * 入っていない。**収まっているから回せる、超えているから回せない、のどちらもこの合計からは出ない**
 * ——線を割ったままであることだけを留める。
 *
 * 岩の海岸と岸壁が、ヤシの実の漂着以外に`vitamin`の当てを持たず、1日ぶんを漂着から集めるだけで
 * 1000分を超えていた（issue #2403）。
 */
describe('土地に留まって1日を賄う献立', () => {
  const tables = buildBalanceTables(bundledCodex(), SAMPLE_CHARACTER);
  const lands = tables.places.filter((place) => place.name !== WHOLE_ISLAND);

  it('土地の行が1つも無いということが無い', () => {
    // 土地の数え方が壊れると下の検査は空の一覧を回して緑で通るので、先に顔ぶれが在ることで留める。
    expect(lands.length).toBeGreaterThan(0);
  });

  it('合計が1日を超える土地は無い', () => {
    const over = lands
      .filter((land) => land.menu.totalMinutes > MINUTES_PER_DAY)
      .map((land) => `${land.name}: ${Math.round(land.menu.totalMinutes)}分`);

    expect(over).toEqual([]);
  });
});
