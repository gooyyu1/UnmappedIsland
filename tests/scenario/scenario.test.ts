import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { start as startNewGame } from '../../src/domain/generation/NewGame';
import { heatHazeFor } from '../../src/game/looks/heatHaze';
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

  it('failing_statusは、域が一通り出揃った状態にする', () => {
    // ステータスエリアの色分け（StatusArea.md 7節）を確かめるためのシナリオなので、狙った域に
    // 入っていること自体がこのファイルの中身の意味。段のしきい値を刻み直したら必ずここで落ちる。
    const scenario = load('failing_status');
    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, new SeededRng(scenario.seed));

    applyScenario(game, scenario, codex);

    const alertOf = (propertyName: string): string | undefined =>
      game.player.instance.tryGetProperty(codex.propertyNames.getId(propertyName))?.alert;

    expect(alertOf('hydration'), '水分は致命的域').toBe('fatal');
    expect(alertOf('satiety'), '満腹度は危険域').toBe('danger');
    expect(alertOf('wakefulness'), '覚醒度は要注意域').toBe('caution');
    expect(alertOf('stamina'), '体力は留意域').toBe('watch');
  });

  it('sprained_ankleは、怪我を負い痛みを感じている状態から始める', () => {
    // 負う契機は確率（coconut.yamlのpick_green_coconut）なので、見た目を確かめるにはここから始める。
    const scenario = load('sprained_ankle');
    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, new SeededRng(scenario.seed));

    applyScenario(game, scenario, codex);

    expect(game.player.injuryStacks.map((stack) => stack[0].def.name)).toEqual(['sprained_ankle']);
    expect(
      game.player.instance.tryGetProperty(codex.propertyNames.getId('pain'))?.getEffectiveValue() ?? 0,
    ).toBeGreaterThan(0);
  });

  it('jungle_startは、漂着地ではなく密林から始める', () => {
    const scenario = load('jungle_start');
    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, new SeededRng(scenario.seed));

    applyScenario(game, scenario, codex);

    expect(game.startLocation.instance.def.name, '開始地点が密林になる').toBe('jungle');
    expect(game.player.location?.instance, 'プレイヤーもその土地に居る').toBe(game.startLocation.instance);
  });

  it('scorching_hazeは、陽炎が立つ暑さから始まり、時間が経っても暑いままになる', () => {
    // 陽炎（ScreenLayout.md 7.5節 空の演出）を目で確かめるためのシナリオなので、開始直後だけでなく
    // しばらく見ていられる必要がある。calmのままだと1tickで暑い季節を外れて消えてしまう。
    const scenario = load('scorching_haze');
    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, new SeededRng(scenario.seed));

    applyScenario(game, scenario, codex);

    expect(heatHazeFor(game.world.ambientTemperature), '開始時点で陽炎が立つ').toBeDefined();

    game.session.advanceWorldTime(game.world.minutesPerTick * 4);

    expect(heatHazeFor(game.world.ambientTemperature), '数tick経っても立ったまま').toBeDefined();
  });

  it('stormは嵐から始まり、天気が選び直されても雨系のままになる', () => {
    // 嵐の演出を目で確かめるためのシナリオなので、見ている途中で晴れては困る。
    const scenario = load('storm');
    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, new SeededRng(scenario.seed));

    applyScenario(game, scenario, codex);

    expect(game.world.weather).toBe('storm');

    // weather_remaining（初期20tick）が尽きて選び直されるまで進める。
    game.session.advanceWorldTime(game.world.minutesPerTick * 24);

    expect(['storm', 'heavy_rain', 'light_rain'], '飽和した大気では晴れ系が選ばれない').toContain(
      game.world.weather,
    );
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
    const names = ['stone', 'twig', 'thick_branch', 'coconut', 'taro', 'water_spinach', 'woven_basket'];
    const scenario = parseScenario('over.yaml', `seed: 1\nplayer:\n  hand: [${names.join(', ')}]\n`);
    const game = startNewGame(codex, SAMPLE_CHARACTER, 1, new SeededRng(1));

    expect(() => applyScenario(game, scenario, codex)).toThrow(/woven_basket/);
  });

  it('propsはキャラクターのプロパティを上書きする', () => {
    const scenario = parseScenario('props.yaml', 'seed: 1\nplayer:\n  props:\n    hydration: 12\n');
    const game = startNewGame(codex, SAMPLE_CHARACTER, 1, new SeededRng(1));

    applyScenario(game, scenario, codex);

    expect(game.player.instance.tryGetProperty(codex.propertyNames.getId('hydration'))?.number ?? 0).toBe(12);
  });

  it('world.propsはシンボル型のプロパティも上書きできる（天候はシードで選べない）', () => {
    const scenario = parseScenario('weather.yaml', 'seed: 1\nworld:\n  props:\n    weather: storm\n');
    const game = startNewGame(codex, SAMPLE_CHARACTER, 1, new SeededRng(1));

    applyScenario(game, scenario, codex);

    const weatherId = codex.propertyNames.getId('weather');
    expect(game.world.instance.tryGetProperty(weatherId)?.number ?? 0).toBe(codex.symbolNames.getId('storm'));
  });

  it('シンボル名が違えばエラーになる（一生降らない雨を待たせない）', () => {
    const scenario = parseScenario('bad.yaml', 'seed: 1\nworld:\n  props:\n    weather: rainy\n');
    const game = startNewGame(codex, SAMPLE_CHARACTER, 1, new SeededRng(1));

    expect(() => applyScenario(game, scenario, codex)).toThrow(/rainy/);
  });

  it('hunting_groundは、体格の違う獲物と3つの武器を並べる', () => {
    // 狩りの釣り合い（HuntingSystem.md 1.2節）を目で確かめるためのシナリオなので、**体格の違う
    // 獲物と、配分の違う武器が同時に手元にある**ことがこのファイルの中身の意味。始めた時点で
    // どれでも殴れて、輪郭が明滅している（＝警戒が安全域を外れている）必要がある。
    const scenario = load('hunting_ground');
    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, new SeededRng(scenario.seed));

    applyScenario(game, scenario, codex);

    const [rat, junglefowl, monkey, boar, ...loot] = game.startLocation.items;
    expect(
      [rat, junglefowl, monkey, boar].map((animal) => animal.def.name),
      '体格の小さい順',
    ).toEqual(['rat', 'junglefowl', 'monkey', 'wild_boar']);
    expect(
      loot.map((item) => item.def.name),
      '持ち去られる候補が足元にある',
    ).toEqual(['coconut', 'woven_basket', 'thick_branch']);

    const weapons = game.player.hand.filter((item) => item !== undefined);
    expect(
      weapons.map((weapon) => weapon.def.name),
      '3つの武器が手元にある',
    ).toEqual(['sharp_stone', 'stone_axe', 'spear']);
    for (const weapon of weapons)
      expect(
        boar.combinationsWith(weapon, game.player.instance).map((c) => c.name),
        `${weapon.def.name}で殴れる`,
      ).toEqual(['strike']);
    expect(
      monkey.tryGetProperty(codex.propertyNames.getId('wariness'))?.alert,
      '始めた時点で警戒している',
    ).not.toBe('safe');
  });

  it('rain_collectingは、雨の中で空のヤシの殻を持たせる', () => {
    const scenario = load('rain_collecting');
    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, new SeededRng(scenario.seed));

    applyScenario(game, scenario, codex);

    const weatherId = codex.propertyNames.getId('weather');
    expect(game.world.instance.tryGetProperty(weatherId)?.number ?? 0, '雨を待たずに試せる').toBe(
      codex.symbolNames.getId('light_rain'),
    );
    expect(game.player.hand[0]?.def.name).toBe('coconut_bowl');
    expect(game.startLocation.items.map((item) => item.def.name)).toEqual(['coconut_bowl']);
  });
});
