import { describe, expect, it } from 'vitest';
import { buildBalanceTables, WHOLE_ISLAND } from '../../src/analysis/balanceTables';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 同梱の定義に対して、総コスト（`object_costs`）の出ない行が理由ごとに分かれること（issue #1175）。
 *
 * 塩は塩田が返すが、塩田は朽ちないので1周期ぶんを按分できず（BalanceStats.md「待って得る生産の
 * 数え方」）、総コストが出ない。それを入手経路の無いものと同じ`undefined`で出すと、**工程も設備も
 * 在るのに内容の穴と読める**。
 *
 * **塩は、朽ちない設備だけが産む最初の物。** 囲いと畑の産物は探索でも採れるため、この形はこれまで
 * 表に現れていなかった——分かれ方が壊れたことは、同梱の定義を通してしか見えない。
 */
describe('総コストが出ない理由', () => {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  const tables = buildBalanceTables(codex, SAMPLE_CHARACTER);
  const costOf = (objectName: string) => tables.objectCosts.find((cost) => cost.objectName === objectName)!;

  it('塩は、総コストが出ないまま入手経路のあるものとして印が付く', () => {
    expect(costOf('salt')).toMatchObject({ minutes: undefined, obtainableWithoutCost: true });
  });

  it('その印が指す先（待ち生産表）に、塩の周期とレートが在る', () => {
    const wholeIsland = tables.places.find((place) => place.name === WHOLE_ISLAND)!;

    expect(wholeIsland.devices.find((device) => device.productName === 'salt')).toMatchObject({
      deviceName: 'salt_pan',
      lifetimeDays: undefined,
    });
  });

  it('同じ朽ちない設備でも、他に作り方のある産物には印が付かない', () => {
    // 畑も囲いも朽ちないが、タロイモもヤケイも探索で採れるので総コストは出る。印が「朽ちない設備が
    // 返すもの」ではなく「値段の付かないもの」であることが、ここで分かれる。
    expect(costOf('taro').obtainableWithoutCost).toBe(false);
    expect(costOf('junglefowl').obtainableWithoutCost).toBe(false);
    expect(costOf('taro').minutes).toBeGreaterThan(0);
  });

  it('総コストが出ないその他は、埋めるべき穴のまま残る', () => {
    // 印が全部の行へ付いてしまうと、内容の穴を数える側が空になる。
    const unreachable = tables.objectCosts.filter(
      (cost) => cost.minutes === undefined && !cost.obtainableWithoutCost,
    );

    expect(unreachable.map((cost) => cost.objectName)).toContain('spear');
  });
});
