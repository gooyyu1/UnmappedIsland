import { describe, expect, it } from 'vitest';
import { buildBalanceTables, WHOLE_ISLAND } from '../../src/analysis/balanceTables';
import { craftingStepsOf } from '../../src/analysis/craftingSteps';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';

/**
 * **中身入りの器が、繰り返し使える道具として数えられていないこと**の検査（issue #2150）。
 *
 * 飲用は器の`fill`から`transfer`で減らすだけで、器そのものを`destroy`も`become`もしない。
 * 消費を「その型が残らないこと」だけで読むと、水入りの甕は**消費されない入力＝道具**になり、
 * 中身を用意する時間が単位あたりの時間から丸ごと落ちる——器の中身が無尽蔵に湧くのと同じ勘定になる。
 *
 * 読み方そのものの単体試験は`tests/analysis/craftingSteps.test.ts`にある。ここが見るのは、
 * **同梱の定義でそれが実際に効いていること**——甕の容量と1杯の量から出る按分は、どちらの数字を
 * 動かしても変わるので、液体まわりを触るたびにここが見張る。
 */
describe('器の中身を持ち出す工程（同梱の定義）', () => {
  const codex = bundledCodex();
  const objectId = (name: string) => codex.objectNames.getId(name);

  it('1杯飲む工程は、水入りの甕を容量ぶんの1杯として消費する', () => {
    const jar = codex.objects.get(objectId('jar__content_water_liquid'));
    const drink = craftingStepsOf(codex, jar).find((step) => step.name === 'drink')!;

    // 甕は4000mL、1杯は250mL（liquid_containers.yaml）。飲み干した先は空の甕。
    expect(drink.inputs).toEqual([
      {
        kind: 'object',
        objectGlobalId: jar.globalId,
        consumed: true,
        count: 250 / 4000,
        emptiedInto: objectId('jar'),
      },
    ]);
  });

  it('1杯飲む工程は、ヤシの殻の器を1個まるごと消費する', () => {
    // 殻の器は250mL＝1杯ぶんしか抱えられないので、1杯で空になる。
    const bowl = codex.objects.get(objectId('coconut_bowl__content_water_liquid'));
    const drink = craftingStepsOf(codex, bowl).find((step) => step.name === 'drink')!;

    expect(drink.inputs).toEqual([
      {
        kind: 'object',
        objectGlobalId: bowl.globalId,
        consumed: true,
        count: 1,
        emptiedInto: objectId('coconut_bowl'),
      },
    ]);
  });

  it('飲んで水分を賄う経路の時間に、汲む時間が入っている', () => {
    const tables = buildBalanceTables(codex, SAMPLE_CHARACTER);
    const island = tables.places.find((place) => place.name === WHOLE_ISLAND)!;
    const hydration = island.properties.find((chains) => chains.propertyName === 'hydration')!;
    // 時間を数えられない経路（雨を受けて溜める）は除く。中身がただで湧く側なので、飲用の5分だけで
    // 正しい——数えられないことは`untimed`が言う。
    const drinking = hydration.routes.filter(
      (route) => !route.route.untimed && route.route.steps.some((step) => step.stepName === 'drink'),
    );

    expect(drinking.length).toBeGreaterThan(0);
    // 飲用そのものは5分（liquid_containers.yaml）。中身を用意する時間が入っていなければ、
    // 1回の実行はその5分ちょうどになる。
    for (const route of drinking) expect(route.route.executionMinutes).toBeGreaterThan(5);

    // **器そのものは按分していない。** 甕は空になって手元に残るので、1杯に乗るのは汲む5分を16杯へ
    // 割った0.31分だけ——甕の値段（数百分、`object_costs`）が少しでも乗れば、この上限を超える。
    // 汲む時間か甕の容量を動かしたら、ここの上限も一緒に動く。
    const fromJar = drinking.find((route) =>
      route.route.steps.some((step) => step.objectName === 'jar__content_water_liquid'),
    )!;
    expect(fromJar.route.executionMinutes).toBeLessThan(6);
  });
});
