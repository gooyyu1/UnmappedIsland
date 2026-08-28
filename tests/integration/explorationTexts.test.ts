import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { StartedGame } from '../../src/domain/generation/NewGame';
import { startNewGame } from '../../src/domain/generation/NewGame';
import type { WorldObject } from '../../src/domain/WorldObject';
import { fromGameSession } from '../../src/game/view/PlayScreenView';
import type { Localization } from '../../src/locale/Localization';
import { bundledLocaleText, LOCALE_FILE, parseLocale } from '../../src/locale/Localization';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';
import { seededRng } from '../../src/domain/Rng';

/**
 * 探索のタブが出す文言（見出し、[Windows.md](../../docs/ui/Windows.md) 5節）が、**型ごとの言い換えを
 * 通って**画面へ届くかを見る試験。何が見つかるかを言うのは `explore` の説明文なので、そちらも見る。
 *
 * 同梱の対応表（ja.yaml）を読むのは、言い換えが在ること自体が同梱の中身だから——探索できる型が
 * 陸だけではなくなった（海区、Voyage.md 3節）ので、1つの文で全部を言えるかどうかがここで決まる。
 */
describe('探索のタブの文言（世界→映し→対応表 通し）', () => {
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

  /** その場所の探索のタブの見出し（探索できない場所ではundefined）。 */
  function titleOf(game: StartedGame, place: WorldObject): string | undefined {
    return fromGameSession(game, codex, locale).windowOf(place).exploration?.title;
  }

  it('タブの見出しは、言い換えていない土地では画面の既定語', () => {
    const game = newGame();

    expect(titleOf(game, game.startLocation.instance)).toBe(locale.uiText('exploration'));
  });

  it('タブの見出しは、海区では見張り', () => {
    const game = newGame();

    for (const zoneName of ['coastal_waters', 'tide_rip', 'open_water']) {
      expect(titleOf(game, singletonPlace(game, zoneName)), `${zoneName}の見出し`).toBe('見張り');
    }
  });

  it('海区の見張りの説明は、見つかるのが航路であることを言う', () => {
    for (const zoneName of ['coastal_waters', 'tide_rip', 'open_water']) {
      const description = locale.object(zoneName).interaction('explore').description;

      expect(description, `${zoneName}の説明`).toContain('航路');
      expect(description, `${zoneName}で「土地」も「道」も言わない`).not.toMatch(/土地|道/);
    }
  });

  it('探索の進み具合の説明も、海区では見張りのこととして言う', () => {
    for (const zoneName of ['coastal_waters', 'tide_rip', 'open_water']) {
      const texts = locale.object(zoneName).prop('exploration_progress');

      expect(texts.displayName, `${zoneName}の表示名`).toBe('見張りの進み具合');
      expect(texts.description, `${zoneName}の説明`).toContain('航路');
      expect(texts.description, `${zoneName}で「土地」と言わない`).not.toMatch(/土地/);
    }
  });
});
