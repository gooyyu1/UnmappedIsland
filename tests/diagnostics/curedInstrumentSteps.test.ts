import { describe, expect, it } from 'vitest';
import { craftingStepsOf } from '../../src/analysis/craftingSteps';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * **既に済んでいる加工を、まだできる加工として数えていないこと**の検査（issue #1510）。
 *
 * 相手をタグで指した操作は、行き先が相手の型で決まるなら候補ごとに工程が割れる
 * （craftingSteps.instrumentTypesOf）。塩蔵の相手（`perishable`）には**漬け上がった変種も
 * 混ざる**——変種もcuredタグを持ち、`become: {cure: salted}`の行き先も自分自身に解けるため。
 * 相手に課された条件（`not: {subject: instrument, matches: {tag: cured}}`）を読まないと、
 * `stats/balance.yaml`の工程が産物1種につきcure軸の値の数だけ並ぶ。
 *
 * 読み方そのものの単体試験は`tests/analysis/craftingSteps.test.ts`にある。ここが見るのは、
 * **同梱の定義でその条件が実際に効いていること**——cure軸の値が1つの間は水増しが1倍で、
 * 値が増えて初めて現れる形なので、値を足すたびにここが見張る。
 */
describe('既に漬かった相手を数えない（同梱の定義）', () => {
  const codex = bundledCodex();

  it('塩蔵の工程は、漬かっていない産物1種につき1つ', () => {
    const salt = codex.objects.get(codex.objectNames.getId('salt'));
    const products = craftingStepsOf(codex, salt)
      .filter((step) => step.name === 'cure')
      .flatMap((step) => step.outputs.map((output) => output.objectGlobalId));

    expect(new Set(products).size).toBe(products.length);
  });
});
