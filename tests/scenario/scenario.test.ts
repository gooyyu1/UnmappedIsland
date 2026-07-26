import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { start as startNewGame } from '../../src/domain/generation/NewGame';
import { applyScenario, parseScenario } from '../../src/scenario/Scenario';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { SeededRng } from '../support/SeededRng';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/** 同梱シナリオの置き場所（BootSceneが読むのと同じもの）。 */
const SCENARIO_DIR = 'public/scenarios';

/**
 * テスト用シナリオ（SaveDataManagement.md）の自動テスト。
 *
 * シナリオは「シードで世界を作り直し、決まった手順で中身を置く」だけなので、同梱ファイルが
 * 実際に適用できることをここで担保する。object_defの綴りを間違えたシナリオは、起動して初めて
 * 気づくことになるため。
 */
describe('テスト用シナリオ', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  function load(fileName: string) {
    return parseScenario(fileName, readFileSync(join(SCENARIO_DIR, fileName), 'utf8'));
  }

  it('同梱シナリオはすべて読めて、そのまま適用できる', () => {
    const files = readdirSync(SCENARIO_DIR).filter((file) => file.endsWith('.yaml'));
    expect(files.length, '検査対象が無い（置き場所が変わっていないか）').toBeGreaterThan(0);

    for (const file of files) {
      const scenario = load(file);
      const game = startNewGame(codex, scenario.seed, new SeededRng(scenario.seed));
      expect(() => applyScenario(game, scenario, codex), `${file} を適用できない`).not.toThrow();
    }
  });

  it('basket_and_stonesは、編み籠を持ち石と流木が落ちている状態にする', () => {
    const scenario = load('basket_and_stones.yaml');
    const game = startNewGame(codex, scenario.seed, new SeededRng(scenario.seed));

    applyScenario(game, scenario, codex);

    expect(game.player.hand[0]?.def.name, '手持ちの先頭が編み籠').toBe('woven_basket');
    expect(
      game.startLocation.itemStacks.map((stack) => [stack[0].def.name, stack.length]),
      '同種はスタックにまとまる',
    ).toEqual([
      ['stone', 3],
      ['driftwood', 2],
    ]);
  });

  it('object_defの名前が違えばエラーになる（黙って違う状態で始めない）', () => {
    const scenario = parseScenario('bad.yaml', 'seed: 1\nplayer:\n  hand: [no_such_item]\n');
    const game = startNewGame(codex, 1, new SeededRng(1));

    expect(() => applyScenario(game, scenario, codex)).toThrow(/no_such_item/);
  });

  it('受け入れられない置き方はエラーになる（手持ちの枠を超える）', () => {
    const names = ['stone', 'branch', 'driftwood', 'coconut', 'taro', 'water_spinach', 'woven_basket'];
    const scenario = parseScenario('over.yaml', `seed: 1\nplayer:\n  hand: [${names.join(', ')}]\n`);
    const game = startNewGame(codex, 1, new SeededRng(1));

    expect(() => applyScenario(game, scenario, codex)).toThrow(/woven_basket/);
  });

  it('propsはキャラクターのプロパティを上書きする', () => {
    const scenario = parseScenario('props.yaml', 'seed: 1\nplayer:\n  props:\n    satiety: 1200\n');
    const game = startNewGame(codex, 1, new SeededRng(1));

    applyScenario(game, scenario, codex);

    expect(game.player.satiety).toBe(1200);
  });
});
