import { describe, expect, it } from 'vitest';
import type { StepOutcome } from '../../src/analysis/CraftingStep';
import { rangeCyclesOf } from '../../src/analysis/rangeCycles';
import type { StaticValueResolver } from '../../src/analysis/staticValue';
import { highestDeclaredLayer, layeredResolver } from '../../src/analysis/staticValue';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * **プレイヤーが仕込む在庫を重みにした抽選**（塩田の`brine`、畑の`*_sown`）が、在庫の初期値
 * ——まだ何も仕込んでいない状態——で読まれて「何も起きない回」へ畳まれないことの検査
 * （issue #1167）。
 *
 * 読み方そのものの単体試験は`tests/analysis/craftingSteps.test.ts`にある。ここが見るのは、
 * **同梱の設備がその読み方で実際に産物を返すこと**——塩田も畑も、待って返る物が丸ごと
 * `stats/balance.yaml`から消えるという形で壊れていた。
 */
describe('仕込んだ在庫を重みにした抽選（同梱の定義）', () => {
  const codex = bundledCodex();

  /**
   * 周期1つ（`<プロパティ>.<端>`）の、1回あたりに生まれる型ごとの期待個数。
   *
   * placeは、その設備を置いた土地（罠の掛かる重みは土地が`base`で入れる、TrapSystem.md 3節）。
   */
  function periodicSpawnsOf(ownerName: string, stepName: string, placeName?: string): Map<string, number> {
    const def = codex.objects.get(codex.objectNames.getId(ownerName));
    const cycles = rangeCyclesOf(def, placeName === undefined ? undefined : ancestorOf(placeName));
    const step = cycles.map((cycle) => cycle.step).find((candidate) => candidate.name === stepName);

    expect(step, `${ownerName}の周期${stepName}が立っていない`).toBeDefined();
    return expectedSpawnsOf(step?.outcomes ?? []);
  }

  /** その土地に置いたものとして、祖先の宣言値を答える手立て（balanceTablesが土地1つを渡すときと同じ）。 */
  function ancestorOf(placeName: string): StaticValueResolver {
    const place = codex.objects.get(codex.objectNames.getId(placeName));
    return layeredResolver([highestDeclaredLayer('ancestor', [place], 'zero')]);
  }

  function expectedSpawnsOf(outcomes: readonly StepOutcome[]): Map<string, number> {
    const expected = new Map<string, number>();
    for (const outcome of outcomes)
      for (const spawn of outcome.spawns) {
        const name = codex.objectNames.getName(spawn.objectGlobalId);
        expected.set(name, (expected.get(name) ?? 0) + outcome.probability * spawn.count);
      }
    return expected;
  }

  it('塩田が、張った海水1杯ぶんの塩を返す', () => {
    const spawns = periodicSpawnsOf('salt_pan', 'drying_remaining.on_min');

    expect(spawns.get('salt')).toBe(1);
  });

  it('畑が、撒いた作物を等分で返す', () => {
    const spawns = periodicSpawnsOf('field', 'growth_remaining.on_min');

    // 撒いてある株の数は作物どうしで同じとして読むので、1株から採れる3つが候補の数で割れる。
    expect(spawns.get('taro')).toBeCloseTo(1.5);
    expect(spawns.get('water_spinach')).toBeCloseTo(1.5);
  });

  it('在庫ではない重み（罠のつまみ）は宣言値のまま読む', () => {
    // 草原のくくり罠。空振り40・草食10・肉食10の卓を引いてから、卓ごとに掛からない8と
    // 土地のヤケイ10・ネズミ6を引く（traps.yaml・locations.yaml）。どの重みも候補が減らさない
    // ので在庫としては読まず、宣言値のままの配分になる。
    const spawns = periodicSpawnsOf('snare', 'catch_remaining.on_min', 'grassland');

    expect(spawns.get('junglefowl')).toBeCloseTo((10 / 60) * (10 / 24));
    expect(spawns.get('rat')).toBeCloseTo((10 / 60) * (6 / 24) + (10 / 60) * (6 / 14));
  });
});
