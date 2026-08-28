import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { startNewGame } from '../../src/domain/generation/NewGame';
import type { StartedGame } from '../../src/domain/generation/NewGame';
import type { WorldObject } from '../../src/domain/WorldObject';
import { applyScenario, bundledScenario } from '../../src/scenario/Scenario';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';
import { seededRng } from '../../src/domain/Rng';
import { voyageForecastOf } from '../../src/game/view/voyageForecast';
import { cardLooksOf } from '../../src/game/view/cardLooks';
import { voyageDaysText } from '../../src/game/looks/timeTexts';
import { parseLocale } from '../../src/locale/Localization';
import { borrowedFace } from '../../src/game/ui/cardFace';

/**
 * 積み下ろしの間に出す推定日数（docs/concept/GameEndings.md 9.3節・docs/ui/CardView.md 16節）を、
 * 同梱のYAMLから画面の文字まで通しで見る試験。
 *
 * **出航のしたくシナリオ（砂浜に積荷入りの筏）から実際に動かす。** 見積もりは海図の幅・海区の素の
 * 横断時間・積載の段の3つが噛み合って初めて出るので、**画面側だけを見ても宣言側だけを見ても
 * 噛み合っているかは分からない**。段の境目も、段が引く分数も、宣言した数字そのもの。
 */
describe('推定日数', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  });

  /** 出航のしたくシナリオの状態（砂浜に積荷入りの筏があり、プレイヤーは岸に立っている）。 */
  function ready(): { game: StartedGame; raft: WorldObject } {
    const scenario = bundledScenario('voyage_ready');
    if (scenario === undefined) throw new Error('同梱シナリオ voyage_ready がありません。');

    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, seededRng(scenario.seed));
    applyScenario(game, scenario, codex);

    const raft = game.startLocation.fixtures.find((fixture) => fixture.def.name === 'raft');
    if (raft === undefined) throw new Error('シナリオが筏を置いていません。');
    return { game, raft };
  }

  function forecastIn(
    game: StartedGame,
  ): (object: WorldObject) => ReturnType<ReturnType<typeof voyageForecastOf>> {
    return voyageForecastOf(codex, game.world);
  }

  /** 筏の積荷の枠へ物を1つ積む。 */
  function load(game: StartedGame, raft: WorldObject, objectName: string): WorldObject {
    const item = game.session.createObject(codex.objectNames.getId(objectName));
    const rejection = item.moveToSlotOrRejection(raft.getSlot(codex.slotNames.getId('items')));
    if (rejection !== undefined) throw new Error(`${objectName}を積めませんでした: ${rejection}`);
    return item;
  }

  it('海岸に繋いだ筏が、幅を持ったまま推定日数を出す', () => {
    const { game, raft } = ready();
    const forecast = forecastIn(game)(raft);

    expect(forecast, '砂浜の筏には見積もりが出る').toBeDefined();
    // 砂浜が面するのは島影の海（本土まで14海区）。海図はまだ方角しか知らないので±5海区の幅がある
    // （Voyage.md 3.7節）ため、日数も幅のまま出る。
    expect(forecast!.minDays).toBeGreaterThan(0);
    expect(forecast!.maxDays, '海図に幅がある間は日数も幅を持つ').toBeGreaterThan(forecast!.minDays);
  });

  it('積荷を1つ増やすと日数が延び、下ろすと戻る', () => {
    const { game, raft } = ready();
    const forecast = forecastIn(game);

    const before = forecast(raft);
    expect(before).toBeDefined();

    // 積載が速さの段を1つ下げるまで丸太を積む（1本20kg。段の境目はVoyage.md 3.2節）。
    const logs: WorldObject[] = [];
    while (forecast(raft)!.maxDays === before!.maxDays) {
      if (logs.length >= 20) throw new Error('積んでも日数が動きませんでした。');
      logs.push(load(game, raft, 'log'));
    }

    const laden = forecast(raft)!;
    expect(laden.maxDays, '積むほど横断が長くなる').toBeGreaterThan(before!.maxDays);

    // **最後の1本を下ろすだけで戻る。** 積み下ろしのたびに数字が動くことが9.3節の要（かなめ）。
    const last = logs.pop()!;
    last.destroy();
    expect(forecast(raft)!.maxDays, '1つ下ろせば戻る').toBe(before!.maxDays);

    // その1本を積み直せば、また延びる。
    load(game, raft, 'log');
    expect(forecast(raft)!.maxDays, '1つ積めばまた延びる').toBe(laden.maxDays);
  });

  it('海にも海岸にも居ない筏には出さない', () => {
    const { game, raft } = ready();
    const forecast = forecastIn(game);
    expect(forecast(raft)).toBeDefined();

    // プレイヤーの手へ移すと、面している海区が無くなる（どこへ漕ぎ出すのかが決まらない）。
    raft.moveToSlotOrRejection(game.startLocation.instance.getSlot(codex.slotNames.getId('fixtures')));
    const inland = game.session.createObject(codex.objectNames.getId('jungle'));
    expect(raft.moveToSlotOrRejection(inland.getSlot(codex.slotNames.getId('fixtures')))).toBeUndefined();
    expect(forecast(raft), '海に面していない土地では見積もりが出ない').toBeUndefined();
  });

  it('帆を組み込むと日数が縮む', () => {
    const { game, raft } = ready();
    const forecast = forecastIn(game);
    const before = forecast(raft)!;

    // 帆は積荷ではなく筏の一部（構造スロット）。**陸ではゲートが閉じている**が、海に出れば必ず
    // 効くものなので見積もりには入る（Voyage.md 3.2節）。
    const sail = game.session.createObject(codex.objectNames.getId('rawhide_sail'));
    expect(sail.moveToSlotOrRejection(raft.getSlot(codex.slotNames.getId('structure')))).toBeUndefined();

    expect(forecast(raft)!.maxDays, '帆を張れば早く着く').toBeLessThan(before.maxDays);
  });

  it('海の上でも、今いる海区の値で出す', () => {
    const { game, raft } = ready();
    const forecast = forecastIn(game);
    const moored = forecast(raft)!;

    const zone = game.world.instance.findSelfOrDescendantOfDef(codex.objectNames.getId('coastal_waters'));
    expect(zone, '海区は世界の初めから在る').toBeDefined();
    expect(raft.moveToSlotOrRejection(zone!.getSlot(codex.slotNames.getId('fixtures')))).toBeUndefined();

    // 砂浜が面しているのがこの海区なので、繋いであったときと同じ値になる（Voyage.md 3.6節）。
    expect(forecast(raft), '出航しても見積もりは続く').toEqual(moored);

    // 渡り終えた海区は海図に幅を持たない（同3.7節）ので、日数も1つの数になる。
    zone!.getProperty(codex.propertyNames.getId('chart_crossed')).setNumber(1);
    const crossed = forecast(raft)!;
    expect(crossed.minDays, '幅が消えれば両端が揃う').toBe(crossed.maxDays);
  });

  it('渡る当人でない物には出さない', () => {
    const { game, raft } = ready();
    const forecast = forecastIn(game);
    expect(forecast(load(game, raft, 'log')), '積荷そのものは渡る当人ではない').toBeUndefined();
  });

  it('筏の札の桟に、その文字が乗る', () => {
    const { game, raft } = ready();
    const looks = cardLooksOf(codex, parseLocale('ja.yaml', ''), game.world, () => undefined);
    const forecast = forecastIn(game)(raft)!;

    const days = voyageDaysText(forecast.minDays, forecast.maxDays);
    expect(looks.contentOf(raft).railText).toBe(days);
    // 子ウィンドウが借りる札（Windows.md 1.1節）も同じ見た目を出す——見た目のぶんだけを取り出す
    // 経路（cardFace）が落とすと、筏を開いた先だけ日数が消える。
    expect(borrowedFace(looks.contentOf(raft)).railText).toBe(days);
    // 見積もりを持たない物の札は、桟に文字を出さない。
    expect(looks.contentOf(load(game, raft, 'log')).railText).toBeUndefined();
  });

  it('幅が無くなれば1つの数として書く', () => {
    expect(voyageDaysText(2.5, 2.5)).toBe('本土まで 2.5日');
    expect(voyageDaysText(1.5, 3)).toBe('本土まで 1.5〜3日');
  });
});
