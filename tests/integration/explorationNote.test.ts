import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { StartedGame } from '../../src/domain/generation/NewGame';
import { startNewGame } from '../../src/domain/generation/NewGame';
import type { WorldObject } from '../../src/domain/WorldObject';
import { Location } from '../../src/domain/wrappers/Location';
import { fromGameSession } from '../../src/game/view/PlayScreenView';
import type { Localization } from '../../src/locale/Localization';
import { bundledLocaleText, LOCALE_FILE, parseLocale } from '../../src/locale/Localization';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';
import { seededRng } from '../../src/domain/Rng';

/**
 * 探索のタブのバーの下に出す補足の1行（[Windows.md](../../docs/ui/Windows.md) 5節）が、
 * **型ごとの言い換えを通って**画面へ届くかを見る試験。
 *
 * 同梱の対応表（ja.yaml）を読むのは、言い換えが在ること自体が同梱の中身だから——探索できる型が
 * 陸だけではなくなった（海区、Voyage.md 3節）ので、1つの文で全部を言えるかどうかがここで決まる。
 */
describe('探索の補足の1行（世界→映し→対応表 通し）', () => {
  let codex: WorldCodex;
  let locale: Localization;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    locale = parseLocale(LOCALE_FILE, bundledLocaleText());
  });

  function newGame(): StartedGame {
    return startNewGame(codex, SAMPLE_CHARACTER, 11, seededRng(1234));
  }

  /** 世界にただ1つ在る場所（海区）を型の名前で引く（singleton、GameElementDefinition.md 15節）。 */
  function singletonPlace(game: StartedGame, defName: string): WorldObject {
    const place = game.world.instance.findSelfOrDescendantOfDef(codex.objectNames.getId(defName));
    if (place === undefined) throw new Error(`${defName} が世界に居ません。`);
    return place;
  }

  /** その場所の探索の補足の1行（探索できない場所ではundefined）。 */
  function noteOf(game: StartedGame, place: WorldObject): string | undefined {
    return fromGameSession(game, codex, locale).windowOf(place).exploration?.note;
  }

  /** その場所を探索率100%まで探索する。100%到達後も続けられる型があるので、回数で止める。 */
  function exploreToFull(game: StartedGame, place: WorldObject): void {
    const explorable = new Location(place, codex);
    for (let i = 0; i < explorable.explorationProgressMax; i++) explorable.explore(game.player.instance);
  }

  it('上書きの無い土地では、アイテムと道が見つかると言う', () => {
    const game = newGame();

    const note = noteOf(game, game.startLocation.instance);

    expect(note).toBe('探索を続けると、アイテムや他の土地へ続く道が見つかる。');
  });

  it('海区では、見つかるのが航路であることを言う', () => {
    const game = newGame();

    for (const zoneName of ['coastal_waters', 'tide_rip', 'open_water']) {
      const note = noteOf(game, singletonPlace(game, zoneName));

      expect(note, `${zoneName}の補足`).toContain('航路');
      expect(note, `${zoneName}で「土地」も「道」も言わない`).not.toMatch(/土地|道/);
    }
  });

  it('探索し切ると、土地でも海区でも言うことが変わる', () => {
    const game = newGame();
    const zone = singletonPlace(game, 'coastal_waters');
    const before = { land: noteOf(game, game.startLocation.instance), sea: noteOf(game, zone) };

    exploreToFull(game, game.startLocation.instance);
    exploreToFull(game, zone);

    expect(noteOf(game, game.startLocation.instance), '土地は探索し切っても続けられる').not.toBe(before.land);
    expect(noteOf(game, zone), '海区は航路が見えたら見張りが終わる').not.toBe(before.sea);
    expect(noteOf(game, zone)).toContain('航路');
  });
});
