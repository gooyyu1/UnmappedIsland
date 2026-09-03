import { readFileSync } from 'node:fs';
import { isMap, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';
import { describe, expect, it } from 'vitest';
import { worldCodexYamlPaths } from '../support/worldCodexFiles';

/**
 * 行動の可否を決める2つの明るさ（`docs/engine/IlluminationSystem.md` 2節）のしきい値が、段の宣言の
 * 外へ散らないことの検査（同 8節）。
 *
 * **境目を持ってよいのは `stages` だけ**で、条件の側は段の名前（`in_stage`／`in_stage_or_above`）で
 * 見る。条件は行動の数だけ
 * 増えるので、そこへ数字を書き写すと、揃っているかを見るものが1つも無くなる——1箇所だけ境目のずれた
 * 条件を書いても、他のどのテストも通ってしまう。
 *
 * 見るのは**書き写された形が在ること**だけで、しきい値がいくつかは見ない。値のほうは
 * `illumination.test.ts`（実ファイルの定義で行動が止まること）と `stats:climate` の活動時間表が
 * 見ているので、重ねると赤の意味が決まらなくなる。
 *
 * **字面ではなく構文木を辿る。** 行の形で見分けると、同じ意味の `- {prop: x, gte: 5}` と
 * `- prop: x` ＋ `  gte: 5` が別の扱いになり、書き方を変えただけで検査をすり抜ける。
 */

/** 段でしか見てはいけない明るさ（IlluminationSystem.md 5節の表が見る2つ）。 */
const STAGED_BRIGHTNESS = new Set(['hand_brightness', 'looking_brightness']);

/** 実効値を数と直接比べる演算子キー（GameElementDefinition.md 14.1節）。 */
const COMPARISON_KEYS = new Set(['lt', 'lte', 'gt', 'gte', 'eq', 'neq', 'in', 'not_in']);

/** 条件1つの読み。`prop` を主語にした葉から、その葉が使っている演算子キーを拾う。 */
interface BrightnessCondition {
  readonly where: string;
  readonly propertyName: string;
  readonly comparisonKeys: readonly string[];
}

/**
 * 同梱の定義YAMLから、明るさを主語にした条件の葉をすべて拾う。ロード後の ConditionNode は木に
 * 畳まれていて列挙できないため、定義ファイルの構文木から拾う（`bundledLocale.test.ts` と同じ理由）。
 */
function brightnessConditions(): readonly BrightnessCondition[] {
  const found: BrightnessCondition[] = [];

  for (const path of worldCodexYamlPaths()) {
    const lineCounter = new LineCounter();
    const document = parseDocument(readFileSync(path, 'utf8'), { lineCounter });

    const walk = (node: unknown): void => {
      if (isSeq(node)) {
        for (const item of node.items) walk(item);
        return;
      }
      if (!isMap(node)) return;

      const propertyName = node.get('prop');
      if (typeof propertyName === 'string' && STAGED_BRIGHTNESS.has(propertyName))
        found.push({
          where: `${path}:${lineCounter.linePos(node.range?.[0] ?? 0).line}`,
          propertyName,
          comparisonKeys: node.items
            .map((pair) => (isScalar(pair.key) ? String(pair.key.value) : ''))
            .filter((key) => COMPARISON_KEYS.has(key)),
        });

      for (const pair of node.items) walk(pair.value);
    };

    walk(document.contents);
  }

  return found;
}

describe('明るさのしきい値は段の宣言にしかない', () => {
  it('条件の側が、行動の可否を決める2つの明るさを数と直接比べていない', () => {
    const conditions = brightnessConditions();

    // 何も拾えていない検査は、緑であることと見ていないことの区別が付かない。
    expect(conditions.length, '明るさを主語にした条件が1つも見つからない').toBeGreaterThan(0);

    expect(
      conditions
        .filter((condition) => condition.comparisonKeys.length > 0)
        .map(
          (condition) =>
            `${condition.where}: ${condition.propertyName} を ${condition.comparisonKeys.join('・')} で` +
            `直接比べている（段の名前で見る: in_stage／in_stage_or_above）`,
        ),
    ).toEqual([]);
  });
});
