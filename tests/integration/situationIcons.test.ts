import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { StartedGame } from '../../src/domain/generation/NewGame';
import { startNewGame } from '../../src/domain/generation/NewGame';
import { fromGameSession } from '../../src/game/view/PlayScreenView';
import type { Localization } from '../../src/locale/Localization';
import { parseLocale } from '../../src/locale/Localization';
import { applyScenario, bundledScenario } from '../../src/scenario/Scenario';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import { seededRng } from '../../src/domain/Rng';

/**
 * 状況アイコン（[`ScreenLayout.md`](../../docs/ui/ScreenLayout.md) 4.1.1節）が、同梱の宣言から
 * 画面まで届くかを通しで見る試験。
 *
 * **出す／消すを決めているのは宣言だけ**（段の`situation`）で、画面の側には何のプロパティかを見る
 * 分岐が無い。噛み合っているかは宣言側だけを見ても映し側だけを見ても分からないので、実データと
 * 実シナリオを通したまま確かめる。
 */
describe('状況アイコン（世界→映し 通し）', () => {
  let codex: WorldCodex;
  let locale: Localization;

  beforeAll(() => {
    codex = bundledCodex();
    locale = parseLocale('ja.yaml', 'object_texts:\n  stone:\n    display_name: 石\n');
  });

  /** 同梱シナリオから始める。 */
  function started(scenarioName: string): StartedGame {
    const scenario = bundledScenario(scenarioName);
    if (scenario === undefined) throw new Error(`同梱シナリオ ${scenarioName} がありません。`);

    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, seededRng(scenario.seed));
    applyScenario(game, scenario);
    return game;
  }

  /** 今の画面に並んでいる状況アイコンの識別子。 */
  function shownSituations(game: StartedGame): readonly string[] {
    return fromGameSession(game, locale).conditions;
  }

  /** 現在地へ浅い洞窟を据え、その中へ入る（locations.yamlのshallow_cave）。 */
  function entersShallowCave(game: StartedGame): void {
    const location = game.player.location ?? game.startLocation;
    const cave = game.session.createObject(codex.objectNames.getId('shallow_cave'));
    expect(
      cave.moveToSlotOrRejection(location.instance.getSlot(codex.slotNames.getId('fixtures'))),
      '浅い洞窟を据えられない',
    ).toBeUndefined();
    expect(cave.tryGetAction('enter', game.player.instance)?.tryExecute(), '洞窟へ入れない').toBe(true);
  }

  /**
   * 嵐で屋外が閉ざされていることは、押して断られるまで分からない、では遅い
   * （[`ContentSkeleton.md`](../../docs/world/ContentSkeleton.md) 8.1.4節）。**止めているのは風雨**
   * なので、翳りの濃さ（明るさの演出）からは読めない。
   *
   * 消える側も同じ1つの宣言で決まる——屋根の下では`sheltered`の段が風雨を0まで落とし、`gale`の段ごと
   * 外れる。**同じ嵐の中で居場所だけを変える**ので、変わったのがそれだけであることがこの1件で出る。
   */
  it('嵐の間は風雨のアイコンが出て、屋根の下へ入ると消える', () => {
    const game = started('storm');

    expect(shownSituations(game), '嵐の屋外').toContain('too_stormy');

    entersShallowCave(game);

    expect(shownSituations(game), '同じ嵐でも屋根の下').not.toContain('too_stormy');
  });

  /**
   * 1行に入るのは4つまでで、同時に5つ以上が点く組み合わせが現れたら行の側を見直す
   * （ScreenLayout.md 4.1.1節）。**1つのプロパティが居る段は1つ**なので、`situation`を名乗る段を
   * 持つプロパティの数が、そのまま同時に点きうる数の上限になる。
   */
  it('同時に点きうるアイコンは、1行に入る数を超えない', () => {
    const game = started('storm');
    const naming = game.player.instance
      .allProperties()
      .filter((property) => property.def.stages.some((stage) => stage.situation !== undefined))
      .map((property) => property.def.name);

    expect(naming.length, '状況アイコンを名乗る宣言が1つも無い').toBeGreaterThan(0);
    expect(naming.length, `同時に点きうるのは ${naming.join('・')}`).toBeLessThanOrEqual(
      SITUATION_ROW_CAPACITY,
    );
  });
});

/** 状況アイコンの行に一度に並べられる数（ScreenLayout.md 4.1.1節）。 */
const SITUATION_ROW_CAPACITY = 4;
