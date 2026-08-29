import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { StartedGame } from '../../src/domain/generation/NewGame';
import { startNewGame } from '../../src/domain/generation/NewGame';
import type { WorldObject } from '../../src/domain/WorldObject';
import type { PlayScreenView } from '../../src/game/view/PlayScreenView';
import { fromGameSession } from '../../src/game/view/PlayScreenView';
import { ShownCards } from '../../src/game/view/ShownCards';
import type { Recording } from '../../src/game/view/recording';
import { runAndRecordChange } from '../../src/game/view/recording';
import type { Localization } from '../../src/locale/Localization';
import { parseLocale } from '../../src/locale/Localization';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { applyScenario, bundledScenario } from '../../src/scenario/Scenario';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';
import { seededRng } from '../../src/domain/Rng';

/**
 * 探索で見つかったものが発見物の枠（`docs/ui/Windows.md` 5.1節）に並ぶまでを、実データ
 * （`world-codex`）と実際の探索を通して見る試験。
 *
 * **海区の見張りは、拾ったものを手元へ直に入れる**（`voyage.yaml` の `explore` の `pick` の
 * `spawn: {into: actor}`）。アイテムレーンにも設置物レーンにも現れないので、レーンの並びの差分では
 * 数えられない——同じ見張りが立てる航路（設置物レーンへ出る）だけが枠に入る、という食い違いになる。
 */
describe('発見物の枠（世界→映し 通し）', () => {
  let codex: WorldCodex;
  let locale: Localization;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    locale = parseLocale('ja.yaml', 'object_texts:\n  stone:\n    display_name: 石\n');
  });

  /** 筏に乗って海区に浮かんでいる状態（出航のしたくシナリオから、実際に漕ぎ出したところ）。 */
  function afloat(): { game: StartedGame; zone: WorldObject } {
    const scenario = bundledScenario('voyage_ready');
    if (scenario === undefined) throw new Error('同梱シナリオ voyage_ready がありません。');

    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, seededRng(scenario.seed));
    applyScenario(game, scenario, codex);

    const raft = game.startLocation.fixtures.find((fixture) => fixture.def.name === 'raft');
    if (raft === undefined) throw new Error('シナリオが筏を置いていません。');

    const zone = game.world.instance.findSelfOrDescendantOfDef(codex.objectNames.getId('coastal_waters'));
    if (zone === undefined) throw new Error('海区 coastal_waters がありません。');

    expect(
      raft.moveToSlotOrRejection(zone.getSlot(codex.slotNames.getId('fixtures'))),
      '筏を海区へ浮かべる',
    ).toBeUndefined();
    expect(
      game.player.instance.moveToSlotOrRejection(raft.getSlot(codex.slotNames.getId('characters'))),
      '筏へ乗り込む',
    ).toBeUndefined();

    return { game, zone };
  }

  /**
   * 画面と同じ形で発見物を抱える札の並び。設置物レーンが映しているのは**探索できる場所**——
   * 筏に乗っていれば、見張りの相手は外側の海区（`PlayScene.shownLocation`と同じ選び方）。
   */
  function shownCardsOf(view: () => PlayScreenView): ShownCards {
    return new ShownCards({
      stacksIn: (place) => view().cardsIn(place),
      cardOfObjects: (objects) => view().cardOfObjects(objects),
      combinationOf: (dragged, target, count) => view().combinationOf(dragged, target, count),
      visible: (object) => view().visible(object),
      windowPlace: () => undefined,
      places: (screen) => (screen === 'fixtures' ? exploredIn(view()).fixtures : view().places(screen)),
    });
  }

  /** 設置物レーンが映している場所＝探索できる場所（筏に乗っていれば外側の海区）。 */
  function exploredIn(view: PlayScreenView) {
    const explorable = view.nestedLocations.find((nested) => nested.window.exploration !== undefined);
    if (explorable === undefined) throw new Error('探索できる場所が見えていません。');
    return explorable;
  }

  /** 見張りを1回。画面と同じく、経過の控えを取りながら実行する。 */
  function exploreOnce(game: StartedGame, view: PlayScreenView): Recording {
    return runAndRecordChange(game, codex, locale, undefined, () => {
      expect(exploredIn(view).explore(), '見張りを実行できる').toBe(true);
    });
  }

  /** その控えのうち、世界に生まれてプレイヤーの手元（hand）へ直に入ったもの。 */
  function spawnedIntoHand(game: StartedGame, recording: Recording): readonly WorldObject[] {
    const hand = game.player.instance.getSlot(game.player.handSlotId);
    return recording.changesAtEnd
      .filter((change) => change.from === undefined && change.to === hand)
      .map((change) => change.object);
  }

  it('海区の見張りで手元に入ったアイテムも、発見物の枠に並ぶ', () => {
    const { game } = afloat();
    let view = fromGameSession(game, codex, locale);
    const shown = shownCardsOf(() => view);

    // 見張りが返すものは抽選（voyage.yamlの pick）なので、拾い物が出る回まで繰り返す。
    for (let attempt = 0; attempt < 40; attempt++) {
      const recording = exploreOnce(game, view);
      view = fromGameSession(game, codex, locale);
      const picked = spawnedIntoHand(game, recording);
      shown.takeFound(recording.changesAtEnd);
      if (picked.length === 0) continue;

      const inFound = new Set(shown.found.flatMap((card) => card.identity ?? []));
      expect(
        picked.map((object) => `${object.def.name}#${object.instanceId}`),
        '手元へ直に入った拾い物も発見物',
      ).toEqual(
        picked
          .filter((object) => inFound.has(object.instanceId))
          .map((object) => `${object.def.name}#${object.instanceId}`),
      );
      return;
    }
    throw new Error('見張りを40回繰り返しても拾い物が出ませんでした。');
  });

  it('陸の探索で公開された道も、隠しスロットから出てきたぶんとして数える', () => {
    // 道は生まれるのではなく、未発見の枠から設置物の枠へ移って「発見」される
    // （Location.revealDueFixtures）。生まれた物だけを数えると、こちらが落ちる。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, seededRng(1234));
    let view = fromGameSession(game, codex, locale);
    const shown = shownCardsOf(() => view);

    const fixtures = game.startLocation.instance.getSlot(game.startLocation.fixturesSlotId);
    for (let attempt = 0; attempt < game.startLocation.explorationProgressMax; attempt++) {
      const recording = exploreOnce(game, view);
      view = fromGameSession(game, codex, locale);
      const revealed = recording.changesAtEnd
        .filter((change) => change.to === fixtures && change.from !== undefined)
        .map((change) => change.object);
      shown.takeFound(recording.changesAtEnd);
      if (revealed.length === 0) continue;

      const inFound = new Set(shown.found.flatMap((card) => card.identity ?? []));
      expect(
        revealed.every((object) => inFound.has(object.instanceId)),
        '公開された設置物も発見物',
      ).toBe(true);
      return;
    }
    throw new Error('探索し切っても設置物が公開されませんでした。');
  });

  it('見張りで現れた航路も、同じ控えから発見物になる', () => {
    const { game, zone } = afloat();
    let view = fromGameSession(game, codex, locale);
    const shown = shownCardsOf(() => view);

    const fixtures = zone.getSlot(codex.slotNames.getId('fixtures'));
    for (let attempt = 0; attempt < 40; attempt++) {
      const recording = exploreOnce(game, view);
      view = fromGameSession(game, codex, locale);
      const routes = recording.changesAtEnd
        .filter((change) => change.to === fixtures)
        .map((change) => change.object);
      shown.takeFound(recording.changesAtEnd);
      if (routes.length === 0) continue;

      const inFound = new Set(shown.found.flatMap((card) => card.identity ?? []));
      expect(
        routes.every((object) => inFound.has(object.instanceId)),
        '海区の設置物レーンへ出たものも発見物',
      ).toBe(true);
      return;
    }
    throw new Error('見張りを40回繰り返しても海区に設置物が現れませんでした。');
  });
});
