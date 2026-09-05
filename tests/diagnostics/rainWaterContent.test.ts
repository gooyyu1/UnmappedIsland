import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RainWaterRow, SeasonName } from '../../src/analysis/seasonalRain';
import { rainWaterRows, SEASON_CLIMATE } from '../../src/analysis/seasonalRain';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * 同梱の定義に対する、雨で溜まる水の結論の検査。数え方そのものは`tests/analysis/rainWater.test.ts`。
 *
 * 見るのは2つ。**差引の符号**——雨だけで水を賄えるのは雨季だけで、それ以外の季節は置いておくだけでは
 * 減る（`LiquidContainerSystem.md` 6節）。そして**同じ実測値を写している設計文書とのずれ**——同じ値が
 * 2箇所にあると、片方だけが更新されても誰も気づかない（issue #775）。
 */
describe('雨で溜まる水（同梱の定義）', () => {
  const codex = bundledCodex();
  const rows = rainWaterRows(codex);

  it('雨だけで水を賄えるのは雨季だけ', () => {
    expect(rows.length, '雨を受ける容器が1つも数えられていない').toBeGreaterThan(0);
    for (const row of rows) {
      const label = `${row.containerName} / ${row.seasonName}`;
      if (row.seasonName === 'wet') expect(row.netPerDay, label).toBeGreaterThan(0);
      else expect(row.netPerDay, label).toBeLessThan(0);
    }
  });

  /**
   * 蒸発の実測値は2箇所（設計文書の日数表と解析）にある。読み手が見るのは日数のほうで、mL/tickは
   * それを容量で割っただけなので、割り戻して突き合わせる。
   */
  it('蒸発がLiquidContainerSystem.mdの日数表と一致する', () => {
    const doc = readFileSync(join('docs', 'engine', 'LiquidContainerSystem.md'), 'utf8').split(/\r?\n/);
    for (const [containerName, apertureLabel] of [
      ['coconut_bowl', 'ヤシの器'],
      ['jar', '甕'],
    ]) {
      const days = emptyingDaysOf(doc, apertureLabel);
      for (const season of SEASON_CLIMATE) {
        const row = rowOf(rows, containerName, season.name);
        expect(row.capacity / row.evaporationPerDay, `${containerName} / ${season.name} の日数`).toBeCloseTo(
          days.get(season.name)!,
          1,
        );
      }
    }
  });
});

function rowOf(rows: readonly RainWaterRow[], containerName: string, seasonName: SeasonName): RainWaterRow {
  const row = rows.find(
    (candidate) => candidate.containerName === containerName && candidate.seasonName === seasonName,
  );
  expect(row, `${containerName} / ${seasonName} の行`).toBeDefined();
  return row!;
}

/**
 * `docs/engine/LiquidContainerSystem.md` 6節の「満杯から空になるまでの日数」の表から、見出しが
 * その語を含む列（口径）を季節ごとに読む。
 */
function emptyingDaysOf(lines: readonly string[], apertureLabel: string): ReadonlyMap<SeasonName, number> {
  const start = lines.findIndex((line) => line.startsWith('満杯から空になるまでの日数'));
  expect(start, '日数表が見つからない').toBeGreaterThanOrEqual(0);
  const table = lines.slice(start);

  const header = table.find((line) => line.startsWith('|'));
  expect(header, '日数表の見出し行が見つからない').toBeDefined();
  const column = cellsOf(header!).findIndex((cell) => cell.includes(apertureLabel));
  expect(column, `列 '${apertureLabel}' が見つからない`).toBeGreaterThanOrEqual(0);

  const days = new Map<SeasonName, number>();
  for (const season of SEASON_CLIMATE) {
    const row = table.find((line) => line.startsWith(`| \`${season.name}\` |`));
    expect(row, `行 '${season.name}' が見つからない`).toBeDefined();
    days.set(season.name, Number.parseFloat(cellsOf(row!)[column]));
  }
  return days;
}

/** 表の行（`| a | b |`）の、両端の空文字を落としたセル。 */
function cellsOf(row: string): readonly string[] {
  return row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}
