import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * 夜の枠が拠点の加工を収めきることの検査（`ContentSkeleton.md` 8.3節）。
 *
 * 8.3節は「**夜が足りなくなることはなく、足りないのは昼です**」と言い切っている。夜の加工の枠は
 * 嵐の夜を引いたもの（`terrain.yaml` の `daily_budget.night_craft`、同 8.2節）なので、**言い切りが
 * 崩れるのは嵐が夜を食う割合が膨らんだときか、拠点の加工が積み上がったとき**で、その境目はここが持つ。
 *
 * **レポートを読むだけで、解析は通さない**——見たいのは出来上がった1周回の勘定で、そこへ至る数え方は
 * `tests/analysis/` と各レポートの鮮度検査が持つ。
 */

/** レポート1本の節。 */
function statsReport(fileName: string): Record<string, readonly Record<string, unknown>[]> {
  return parse(readFileSync(join('stats', fileName), 'utf8')) as Record<
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
  return Number(matched[0][column]);
}

describe('夜の枠（ContentSkeleton.md 8.3節）', () => {
  it('嵐の夜を引いた夜の枠で、拠点の加工を収めきる', () => {
    const terrain = statsReport('terrain.yaml');

    const cycleDays = cell(terrain, 'cycle', { base: 'shortest_mean', metric: 'total_days' }, 'mean');
    const baseMinutes = cell(terrain, 'work_piles_total', {}, 'base_minutes');
    const nightCraftMinutes = cell(terrain, 'daily_budget', {}, 'night_craft');
    expect(cycleDays, '1周回の日数が読めない').toBeGreaterThan(0);
    expect(baseMinutes, '拠点の加工の総量が読めない').toBeGreaterThan(0);

    expect(nightCraftMinutes * cycleDays, '嵐の夜を引いた夜の枠が、拠点の加工に足りない').toBeGreaterThan(
      baseMinutes,
    );
  });
});
