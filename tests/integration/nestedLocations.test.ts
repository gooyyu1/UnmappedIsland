import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { StartedGame } from '../../src/domain/generation/NewGame';
import { startNewGame } from '../../src/domain/generation/NewGame';
import type { WorldObject } from '../../src/domain/WorldObject';
import { fromGameSession } from '../../src/game/view/PlayScreenView';
import type { Localization } from '../../src/locale/Localization';
import { parseLocale } from '../../src/locale/Localization';
import { applyScenario, bundledScenario } from '../../src/scenario/Scenario';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import { seededRng } from '../../src/domain/Rng';

/**
 * 入れ物の中に居るときに、外側の場所が画面へ出るかを通しで見る試験（ScreenLayout.md 7.1.1節）。
 *
 * **同梱の宣言が「場所の中の場所」を作れることまで含めて見る**——筏は設置物でありながら場所なので
 * （voyage.yaml）、乗り込むと現在地がそれ自体さらに別の場所の中に入る。映しの側に航海専用の分岐は
 * 無く、条件は入れ子になっていることだけなので、ここで見るのは繋ぎ目が成立するかだけ。
 */
describe('入れ物の中から見た外側の場所（世界→映し 通し）', () => {
  let codex: WorldCodex;
  let locale: Localization;

  beforeAll(() => {
    codex = bundledCodex();
    locale = parseLocale('ja.yaml', 'object_texts:\n  stone:\n    display_name: 石\n');
  });

  /** 出航のしたくシナリオ（砂浜に積荷入りの筏がある）から始める。 */
  function ready(): { game: StartedGame; raft: WorldObject } {
    const scenario = bundledScenario('voyage_ready');
    if (scenario === undefined) throw new Error('同梱シナリオ voyage_ready がありません。');

    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, seededRng(scenario.seed));
    applyScenario(game, scenario, codex);

    const raft = game.startLocation.fixtures.find((fixture) => fixture.def.name === 'raft');
    if (raft === undefined) throw new Error('シナリオが筏を置いていません。');
    return { game, raft };
  }

  /** 筏へ乗り込む（プレイヤーを筏のcharactersスロットへ移す）。 */
  function board(game: StartedGame, raft: WorldObject): void {
    expect(
      game.player.instance.moveToSlotOrRejection(raft.getSlot(codex.slotNames.getId('characters'))),
      '筏へ乗り込める',
    ).toBeUndefined();
  }

  it('陸に立っている間は、映せる場所が現在地だけになる', () => {
    const { game } = ready();

    const nested = fromGameSession(game, codex, locale).nestedLocations;

    expect(nested, '砂浜を含む場所は世界そのものなので、切り替える先は無い').toHaveLength(1);
    expect(nested[0].window.card.identity).toEqual([game.startLocation.instance.instanceId]);
  });

  it('筏に乗り込むと、外側の砂浜の設置物を引ける', () => {
    const { game, raft } = ready();
    board(game, raft);

    const view = fromGameSession(game, codex, locale);
    const nested = view.nestedLocations;

    expect(nested, '現在地（筏）と、それを載せている砂浜').toHaveLength(2);
    expect(nested[0].window.card.identity, '先頭は現在地の筏').toEqual([raft.instanceId]);
    expect(
      view.cardsIn(nested[1].fixtures).flatMap((card) => card?.objects ?? []),
      '外側の設置物には筏自身が並ぶ',
    ).toContain(raft);
  });

  it('出航しても同じ形で、外側は海区になる', () => {
    const { game, raft } = ready();
    board(game, raft);
    expect(raft.tryGetAction('set_sail', game.player.instance)?.tryExecute(), '出航できる').toBe(true);

    const nested = fromGameSession(game, codex, locale).nestedLocations;

    expect(nested, '海の上でも現在地と外側の2件').toHaveLength(2);
    expect(nested[1].fixtures.owner.def.name, '外側は島に最も近い海区').toBe('coastal_waters');
    // **見張りは、外側の場所を探索することそのもの**（docs/world/Voyage.md 3節）。筏に乗ったまま
    // 海区を探索できるので、航海のための入口を画面側に足さずに済んでいる。
    expect(nested[1].explore(), '海区は探索を宣言しているので、外側でも見張れる').toBe(true);
  });
});
