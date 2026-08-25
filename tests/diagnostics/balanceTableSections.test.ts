import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BalanceTables } from '../../src/analysis/balanceTables';
import { buildBalanceTables } from '../../src/analysis/balanceTables';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 収支レポート（`docs/diagnostics/BalanceStats.md`）の各節が、同梱の定義に対して**中身を持つ**ことの検査。
 *
 * 定義から解く道具は、読み方の前提が定義とずれても例外を投げず、0行を返す。レポートは行が0の節を
 * 丸ごと出さないので、**壊れたことが「節が消える」形でしか現れない**——`rain_filled_liquid` へ条件が
 * 1つ増えただけで雨の増分が1つも数えられなくなり、`### 雨で溜まる水` が消えた実例がある（issue #765）。
 * レポートを再生成する `balanceStatsReport.test.ts` は `RUN_BALANCE_STATS` の下でしか走らないため、
 * CIにはこれを見張るものが無かった（issue #768）。
 *
 * 見るのは**行が在ることと見出しが揃っていることだけで、値は見ない**。値の妥当性は各解析の単体試験
 * （`tests/analysis/`）と、再生成した `BalanceStats.md` の差分が持つ。
 */

/** レポートの節1つと、その節を出させている行。 */
interface ReportSection {
  /** `BalanceStats.md` に現れる見出しそのもの。 */
  readonly heading: string;

  /** その節に並ぶ行の数。0になると、レポートからこの節が消える。 */
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
 * 空になってはいけない節。**土地ごとの節（`### 島全体` など）と、内容の穴を挙げる節
 * （`### 島全体で入手経路が無いもの`）は入れない**——前者は土地の宣言しだいで増減し、後者は
 * 空であることが望ましい状態。
 */
const SECTIONS: readonly ReportSection[] = [
  {
    heading: '## 1. 連鎖表（素材から摂取までの総時間）',
    rowCount: (tables) => chainRouteCount(tables, false),
  },
  {
    heading: '### 数えられない経路',
    rowCount: (tables) => chainRouteCount(tables, true),
  },
  {
    heading: '### 総コスト',
    rowCount: (tables) => tables.objectCosts.filter((cost) => cost.minutes !== undefined).length,
  },
  {
    heading: '## 3. 待ち生産表（設備が時間をかけて返す分）',
    rowCount: (tables) => tables.places.flatMap((place) => place.devices).length,
  },
  {
    heading: '### 雨で溜まる水',
    rowCount: (tables) => tables.rainWater.length,
  },
  {
    heading: '## 4. 消費表（1日あたり何が要るか）',
    rowCount: (tables) => tables.consumption.length,
  },
  {
    heading: '## 5. 供給表（1工程あたり）',
    rowCount: (tables) => tables.supply.length,
  },
];

describe('収支レポートの節', () => {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  const tables = buildBalanceTables(codex, SAMPLE_CHARACTER);

  it('同梱の定義に対して、どの節も行を持つ', () => {
    const empty = SECTIONS.filter((section) => section.rowCount(tables) === 0).map(
      (section) => section.heading,
    );

    expect(empty, '解析が同梱の定義を読めなくなると、この節がレポートから消える').toEqual([]);
  });

  it('見出しが、生成済みのレポートと揃っている', () => {
    // 上の一覧が古びると、消えた節をここが見張れなくなる。生成物と突き合わせて、見出しの改名や
    // 節の削除に気づけるようにする（`npm run stats:balance` で再生成される側が正）。
    const report = readFileSync(join('docs', 'diagnostics', 'BalanceStats.md'), 'utf8');
    const missing = SECTIONS.map((section) => section.heading).filter((heading) => !report.includes(heading));

    expect(missing, 'レポートに無い見出しを見張っている').toEqual([]);
  });
});
