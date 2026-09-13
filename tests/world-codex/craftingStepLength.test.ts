import { describe, expect, it } from 'vitest';
import { buildBalanceTables } from '../../src/analysis/balanceTables';
import { craftingStepsOf } from '../../src/analysis/craftingSteps';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';

/**
 * 1つの工程が払わせてよい時間の線（[`docs/world/SurvivalItems.md`](../../docs/world/SurvivalItems.md)
 * 12.2節）を、同梱のYAMLに対して確かめる。
 *
 * **素材の劣化とは別の軸なので、見張りも別に置く**——`weatheringYaml.test.ts` の中に混ぜると、
 * 次にこの線を触る人が素材の名前を持つファイルの中を探すことになる。
 */
const codex = bundledCodex();

/** 1つの工程に充ててよい、1日の余剰に対する割合（SurvivalItems.md 12.2節）。 */
const STEP_SHARE = 0.6;

describe('1つの工程の長さ', () => {
  it('1日の余剰の6割を超えない', () => {
    // 工程は途中で止められない（GameElementDefinition.md 11.3節）ので、1つが余剰を食い切ると、
    // 着手した日は他に何もできなくなる。**全数を見る**ので、レシピを足した人もここへ掛かる。
    const limit = buildBalanceTables(codex, SAMPLE_CHARACTER).surplusMinutes * STEP_SHARE;
    for (const def of codex.objects) {
      if (codex.isGenerated(def)) continue;
      for (const step of craftingStepsOf(codex, def))
        expect(step.laborMinutes, `${def.name} の ${step.name} が払う時間（分）`).toBeLessThanOrEqual(limit);
    }
  });
});
