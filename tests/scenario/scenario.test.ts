import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { start as startNewGame } from '../../src/domain/generation/NewGame';
import { applyScenario, bundledScenario, parseScenario, scenarioNames } from '../../src/scenario/Scenario';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { SeededRng } from '../support/SeededRng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * テスト用シナリオ（SaveDataManagement.md）の自動テスト。
 *
 * シナリオは「シードで世界を作り直し、決まった手順で中身を置く」だけなので、同梱ファイルが
 * 実際に適用できることをここで担保する。object_defの綴りを間違えたシナリオは、起動して初めて
 * 気づくことになるため。選択画面（ScenarioSelectScene）が失敗を扱わないのも、これが根拠。
 */
describe('テスト用シナリオ', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  function load(name: string) {
    const scenario = bundledScenario(name);
    if (scenario === undefined) throw new Error(`同梱シナリオ '${name}' がありません。`);
    return scenario;
  }

  it('同梱シナリオはすべて読めて、そのまま適用できる', () => {
    const names = scenarioNames();
    expect(names.length, '検査対象が無い（置き場所が変わっていないか）').toBeGreaterThan(0);

    for (const name of names) {
      const scenario = load(name);
      expect(scenario.title, `${name} に表示名が無い`).not.toBe('');
      const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, new SeededRng(scenario.seed));
      expect(() => applyScenario(game, scenario, codex), `${name} を適用できない`).not.toThrow();
    }
  });

  it('basket_and_stonesは、編み籠を持ち石と流木が落ちている状態にする', () => {
    const scenario = load('basket_and_stones');
    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, new SeededRng(scenario.seed));

    applyScenario(game, scenario, codex);

    expect(game.player.hand[0]?.def.name, '手持ちの先頭が編み籠').toBe('woven_basket');
    expect(
      game.startLocation.itemStacks.map((stack) => [stack[0].def.name, stack.length]),
      '同種はスタックにまとまる',
    ).toEqual([
      ['stone', 3],
      ['thick_branch', 2],
    ]);
  });

  it('jungle_startは、漂着地ではなく密林から始める', () => {
    const scenario = load('jungle_start');
    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, new SeededRng(scenario.seed));

    applyScenario(game, scenario, codex);

    expect(game.startLocation.instance.def.name, '開始地点が密林になる').toBe('jungle');
    expect(game.player.location?.instance, 'プレイヤーもその土地に居る').toBe(game.startLocation.instance);
  });

  it('土地の指定があると、置いたものはその土地に乗る', () => {
    const scenario = parseScenario('jungle.yaml', 'seed: 7\nlocation:\n  type: jungle\n  items: [stone]\n');
    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, new SeededRng(scenario.seed));

    applyScenario(game, scenario, codex);

    expect(game.startLocation.items.map((item) => item.def.name)).toEqual(['stone']);
  });

  it('指定した土地が島に無ければエラーになる（違う地形で始めない）', () => {
    // シード5は密林の出ない島（地形の分布はTerrainStats.md）。
    const scenario = parseScenario('nojungle.yaml', 'seed: 5\nlocation:\n  type: jungle\n');
    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, new SeededRng(scenario.seed));

    expect(() => applyScenario(game, scenario, codex)).toThrow(/jungle/);
  });

  it('個数の指定は、同じものをその数だけ並べたのと同じ', () => {
    const scenario = parseScenario('count.yaml', 'seed: 1\nlocation:\n  items: [stone x3, thick_branch]\n');

    expect(scenario.items).toEqual(['stone', 'stone', 'stone', 'thick_branch']);
  });

  it('many_stonesは、100個の石を1つのスタックとして持たせる', () => {
    const scenario = load('many_stones');
    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, new SeededRng(scenario.seed));

    applyScenario(game, scenario, codex);

    expect(game.player.hand[0]?.def.name).toBe('stone');
    expect(game.player.handStacks[0]?.length, '100個でも手持ちの1枠に収まる').toBe(100);
  });

  it('個数が上限を超えていればエラーになる（書き間違いを通さない）', () => {
    expect(() => parseScenario('over.yaml', 'seed: 1\nlocation:\n  items: [stone x1001]\n')).toThrow(/個数/);
  });

  it('object_defの名前が違えばエラーになる（黙って違う状態で始めない）', () => {
    const scenario = parseScenario('bad.yaml', 'seed: 1\nplayer:\n  hand: [no_such_item]\n');
    const game = startNewGame(codex, SAMPLE_CHARACTER, 1, new SeededRng(1));

    expect(() => applyScenario(game, scenario, codex)).toThrow(/no_such_item/);
  });

  it('受け入れられない置き方はエラーになる（手持ちの枠を超える）', () => {
    const names = ['stone', 'branch', 'thick_branch', 'coconut', 'taro', 'water_spinach', 'woven_basket'];
    const scenario = parseScenario('over.yaml', `seed: 1\nplayer:\n  hand: [${names.join(', ')}]\n`);
    const game = startNewGame(codex, SAMPLE_CHARACTER, 1, new SeededRng(1));

    expect(() => applyScenario(game, scenario, codex)).toThrow(/woven_basket/);
  });

  it('propsはキャラクターのプロパティを上書きする', () => {
    const scenario = parseScenario('props.yaml', 'seed: 1\nplayer:\n  props:\n    satiety: 1200\n');
    const game = startNewGame(codex, SAMPLE_CHARACTER, 1, new SeededRng(1));

    applyScenario(game, scenario, codex);

    expect(game.player.satiety).toBe(1200);
  });
});
