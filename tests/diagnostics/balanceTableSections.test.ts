import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BalanceTables } from '../../src/analysis/balanceTables';
import { WHOLE_ISLAND } from '../../src/analysis/balanceTables';
import { yamlSectionKeys } from '../support/generatedReport';
import { bundledBalanceTables } from '../support/worldCodexFiles';

/**
 * 収支レポート（`stats/balance.yaml`）の各節が、同梱の定義に対して**中身を持つ**ことの検査。
 *
 * 定義から解く道具は、読み方の前提が定義とずれても例外を投げず、0行を返す。**壊れたことが
 * 「節が空になる」形でしか現れない**——`rain_filled_liquid` へ条件が1つ増えただけで雨の増分が
 * 1つも数えられなくなり、雨で溜まる水の節が消えた実例がある（issue #765）。レポートを再生成する
 * `balanceStatsReport.test.ts` は `RUN_BALANCE_STATS` の下でしか走らないため、CIにはこれを
 * 見張るものが無かった（issue #768）。
 *
 * **生成済みのレポートではなく、解析の出力そのものを数える。** 鮮度の検査は「書き出した物と
 * 作り直した物が一致するか」しか見ないので、**空になったまま再生成された節は素通りする。**
 *
 * 見るのは**行が在ることと節の名前が揃っていることだけで、値は見ない**。値の妥当性は各解析の
 * 単体試験（`tests/analysis/`）と、再生成した `stats/balance.yaml` の差分が持つ。
 */

/** レポートの節1つと、その節を出させている行。 */
interface ReportSection {
  /** `stats/balance.yaml` に現れる節の名前そのもの。 */
  readonly key: string;

  /** その節に並ぶレコードの数。0になると、この節が空になる。 */
  readonly rowCount: (tables: BalanceTables) => number;
}

/** 全土地の連鎖表の行。時間を数えられた経路と数えられない経路は、別々の節に出る。 */
function chainRouteCount(tables: BalanceTables, untimed: boolean): number {
  return tables.places
    .flatMap((place) => place.properties)
    .flatMap((chains) => chains.routes)
    .filter((entry) => entry.route.untimed === untimed).length;
}

/**
 * 空になってはいけない節。**レポートの節は、ここか下の{@link UNCHECKED_SECTIONS}のどちらかに必ず
 * 入る**（「節の名前が、生成済みのレポートと過不足なく揃っている」）。
 */
const SECTIONS: readonly ReportSection[] = [
  { key: 'daily_needs', rowCount: (tables) => tables.places.flatMap((place) => place.properties).length },
  {
    key: 'daily_minimum',
    rowCount: (tables) =>
      tables.places.filter((place) => place.menu.entries.length > 0 || place.menu.unmet.length > 0).length,
  },
  {
    key: 'daily_minimum_menu',
    rowCount: (tables) => tables.places.flatMap((place) => place.menu.entries).length,
  },
  { key: 'chain_routes', rowCount: (tables) => chainRouteCount(tables, false) },
  { key: 'chain_untimed_routes', rowCount: (tables) => chainRouteCount(tables, true) },
  {
    key: 'object_costs',
    rowCount: (tables) => tables.objectCosts.filter((cost) => cost.minutes !== undefined).length,
  },
  { key: 'devices', rowCount: (tables) => tables.places.flatMap((place) => place.devices).length },
  { key: 'rain_water', rowCount: (tables) => tables.rainWater.length },
  { key: 'consumption', rowCount: (tables) => tables.consumption.length },
  { key: 'supply', rowCount: (tables) => tables.supply.length },
];

/** 空かどうかを見ない節。 */
const UNCHECKED_SECTIONS = [
  // 解析の出力ではなく、数えた前提（代表キャラクタ・暦）の1行。
  'meta',
  // 表が数えなかった土地。外すものが無ければ空でよい。
  'excluded_locations',
  // 内容の穴。空であることが望ましい状態で、手書きの文書の側でも「空でもよい」と印を付けてある。
  'chain_gaps',
];

describe('収支レポートの節', () => {
  const tables = bundledBalanceTables();

  it('同梱の定義に対して、どの節も行を持つ', () => {
    const empty = SECTIONS.filter((section) => section.rowCount(tables) === 0).map((section) => section.key);

    expect(empty, '解析が同梱の定義を読めなくなると、この節が空になる').toEqual([]);
  });

  it('節の名前が、生成済みのレポートと過不足なく揃っている', () => {
    // 上の一覧が古びると、空になった節をここが見張れなくなる。生成物と両向きに突き合わせて、節の
    // 改名・削除にも、**足した節が空かどうかを誰も見ていないこと**にも気づけるようにする
    // （`npm run stats:balance` で再生成される側が正）。
    const keys = yamlSectionKeys(readFileSync(join('stats', 'balance.yaml'), 'utf8'));

    expect([...SECTIONS.map((section) => section.key), ...UNCHECKED_SECTIONS].sort()).toEqual(
      [...keys].sort(),
    );
  });

  it('島全体の連鎖表が、経路を持つ', () => {
    // 島全体は土地の宣言しだいで増減しない——渡り歩ける前提で全資源を集めた場合そのもの。
    // ここが空になると「入手できるかどうかの判定」が丸ごと消える。
    const wholeIsland = tables.places.find((place) => place.name === WHOLE_ISLAND);

    expect(
      wholeIsland?.properties.flatMap((chains) => chains.routes).length ?? 0,
      '島全体の経路が1本も無い',
    ).toBeGreaterThan(0);
  });
});
