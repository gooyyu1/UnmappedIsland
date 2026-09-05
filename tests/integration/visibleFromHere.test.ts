import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { StartedGame } from '../../src/domain/generation/NewGame';
import { startNewGame } from '../../src/domain/generation/NewGame';
import type { WorldObject } from '../../src/domain/WorldObject';
import { Path } from '../../src/domain/wrappers/Path';
import { fromGameSession } from '../../src/game/view/PlayScreenView';
import type { Localization } from '../../src/locale/Localization';
import { parseLocale } from '../../src/locale/Localization';
import { applyScenario, bundledScenario } from '../../src/scenario/Scenario';
import { pathsIn } from '../support/paths';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import { seededRng } from '../../src/domain/Rng';

/**
 * 「今いる場所から見えるのはどれか」（`PlayScreenView.visible`、ScreenLayout.md 7.1.1節）を、
 * 生成された島と同梱シナリオを通して見る試験。
 *
 * **世界に在ることと、ここから見えることは別**——置いてきた土地の道は世界に在り続けるし、筏の中に
 * 居ても外の設置物は見えている。この1つの基準の上に、子ウィンドウを畳むかどうかが載る
 * （`ShownCards.reborrowedWindow`）。
 */
describe('現在地から見える範囲（世界→映し 通し）', () => {
  let codex: WorldCodex;
  let locale: Localization;

  beforeAll(() => {
    codex = bundledCodex();
    locale = parseLocale('ja.yaml', 'object_texts:\n  stone:\n    display_name: 石\n');
  });

  /** 現在地を探索率100%まで探索する（道が全部見つかる）。 */
  function exploreToFull(game: StartedGame): void {
    const location = game.player.location ?? game.startLocation;
    for (let i = 0; i < location.explorationProgressMax; i++) game.player.explore();
  }

  it('別の土地へ移ると、置いてきた道は世界に在っても見えなくなる', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, seededRng(1234));
    exploreToFull(game);
    const left = game.startLocation.instance;
    const road = pathsIn(game.startLocation, codex)[0];
    expect(road, '探索し切れば道が見つかっている').toBeDefined();
    expect(fromGameSession(game, codex, locale).visible(road), '渡る前は現在地の設置物').toBe(true);

    expect(new Path(road, codex).travel(game.player.instance), '道を渡れる').toBe(true);

    expect(game.player.location?.instance, '別の土地へ移った').not.toBe(left);
    expect(road.parent, '道は置いてきた土地の設置物のまま世界に在る').toBe(left);
    expect(fromGameSession(game, codex, locale).visible(road), '世界に在っても、移った先からは見えない').toBe(
      false,
    );
  });

  it('キャラクタ自身と現在地そのものも見える', () => {
    // **札を借りない窓（装備・怪我・キャラクタ・現在地）の主**。これらの窓も同じ基準で畳むように
    // なったので、ここが偽になると窓が操作のたびに閉じる。設置物だけを見る実装では通らない。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, seededRng(1234));

    const view = fromGameSession(game, codex, locale);

    expect(view.visible(game.player.instance), 'キャラクタは現在地の中に居る').toBe(true);
    expect(view.visible(game.startLocation.instance), '現在地は見える範囲そのもの').toBe(true);
  });

  it('筏の中に居ても、外側の場所に在る設置物は見えている', () => {
    const scenario = bundledScenario('voyage_ready');
    if (scenario === undefined) throw new Error('同梱シナリオ voyage_ready がありません。');
    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, seededRng(scenario.seed));
    applyScenario(game, scenario, codex);
    const raft = game.startLocation.fixtures.find((fixture) => fixture.def.name === 'raft');
    if (raft === undefined) throw new Error('シナリオが筏を置いていません。');

    // 筏へ乗り込む＝現在地が筏になり、砂浜はその外側になる。
    expect(
      game.player.instance.moveToSlotOrRejection(raft.getSlot(codex.slotNames.getId('characters'))),
      '筏へ乗り込める',
    ).toBeUndefined();

    const view = fromGameSession(game, codex, locale);
    const outside: readonly WorldObject[] = game.startLocation.fixtures;
    expect(outside.length, '外側の砂浜には設置物（筏を含む）が並んでいる').toBeGreaterThan(0);
    expect(
      outside.every((fixture) => view.visible(fixture)),
      '「現在地の子か」では落ちてしまうものが、外側まで数えれば見えている',
    ).toBe(true);
  });
});
