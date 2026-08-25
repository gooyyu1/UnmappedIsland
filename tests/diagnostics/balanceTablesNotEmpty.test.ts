import { describe, expect, it } from 'vitest';
import type { BalanceTables } from '../../src/analysis/balanceTables';
import { buildBalanceTables } from '../../src/analysis/balanceTables';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 収支表の各表が、同梱の定義に対して空にならないことの検査。
 *
 * **値は見ない。** 見るのは「1行でも出るか」だけで、値の妥当性は
 * `balanceStatsReport.test.ts` の再生成の差分が持つ。
 *
 * 解析は定義から静的に解く道具なので、**解けない宣言に出会うとその増分を数に入れずに素通しする**
 * （`BalanceStats.md`「この表が数えていないもの」）。素通し自体は正しいが、**同梱の定義が
 * 全部そちらへ倒れると、表は黙って空になる。** 値が狂うのと違って差分にも現れないので、
 * 誰かが再生成するまで気づけない。
 *
 * 実際に起きた（issue #765）: `liquid_containers.yaml` の `rain_filled_liquid` へ条件が1つ増えた
 * だけで `seasonalRain` が雨の増分を1つも数えなくなり、`### 雨で溜まる水` の節が丸ごと消えた。
 * 捕まえたのは `npm run stats:balance` だけで、あれは `RUN_BALANCE_STATS` が立っているときしか
 * 走らないため**CIでは走らない**。
 *
 * `tests/analysis/` に置けない: あちらは層の単体試験で、同梱の定義を読めない
 * （`tests/architecture/testKinds.test.ts`）。同梱の中身が試験対象なので、置き場はここになる。
 */
describe('収支表は同梱の定義に対して空にならない', () => {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  const tables: BalanceTables = buildBalanceTables(codex, SAMPLE_CHARACTER);

  /** 表の名前と中身。名前は `BalanceStats.md` の節に対応する。 */
  const rows: readonly [string, readonly unknown[]][] = [
    ['総コスト', tables.objectCosts],
    ['1日に要る量', tables.dailyNeeds],
    ['消費', tables.consumption],
    ['供給', tables.supply],
    ['土地ごとの収支', tables.places],
    ['雨で溜まる水', tables.rainWater],
  ];

  it.each(rows)('%s の表が1行以上ある', (_name, table) => {
    expect(table.length).toBeGreaterThan(0);
  });

  /** 土地ごとの表は入れ子なので、中身まで空でないことを見る。 */
  it('土地ごとの収支に、経路と献立と設備が出る', () => {
    for (const place of tables.places) {
      expect(place.properties.length, `${place.name} の経路`).toBeGreaterThan(0);
      expect(place.menu.entries.length, `${place.name} の献立`).toBeGreaterThan(0);
    }
    expect(
      tables.places.some((place) => place.devices.length > 0),
      '待ち生産の設備がどの土地にも出ていない',
    ).toBe(true);
  });

  /**
   * **`gaps` だけは空でよい。** あれは「島のどこにも入手経路が無いもの」の一覧で、埋まっていれば
   * 空になるのが正しい。空を異常として扱うと、穴を埋めた瞬間に赤くなる。
   */
  it('入手経路の穴の一覧は、空でも異常ではない', () => {
    expect(Array.isArray(tables.gaps)).toBe(true);
  });
});
