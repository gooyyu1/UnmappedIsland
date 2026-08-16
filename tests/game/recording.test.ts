import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { start as startNewGame } from '../../src/domain/generation/NewGame';
import type { Localization } from '../../src/locale/Localization';
import { parseLocale } from '../../src/locale/Localization';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { recordChange } from '../../src/game/recording';
import { SeededRng } from '../support/SeededRng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * ワールドを変える操作の、経過中のtickごとの控え（recordChange）の自動テスト。
 *
 * 経過し切ったあとの画面が正しくても、経過中のフレームが壊れていることはある（貸した札の枚数の
 * 引き算がその一例）。控えがtickごとに取れていること・各控えがその時点のワールドを映していることを、
 * 画面を作らずに確かめる。
 */
describe('recordChange（経過中のtickごとの控え）', () => {
  let codex: WorldCodex;
  let locale: Localization;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    locale = parseLocale('ja.yaml', 'object_texts:\n  stone:\n    display_name: 石\n');
  });

  it('時間のかかる操作は、経過中のtick境界ごとに表示内容を控える', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const before = game.world.totalMinutes;

    const recording = recordChange(game, codex, locale, undefined, () => {
      game.player.explore(game.session);
    });

    const after = game.world.totalMinutes;
    expect(after, '探索はゲーム内時間を消費する').toBeGreaterThan(before);

    // 経過し切った時刻の控えは持たない（その並びは行動の効果まで含めて呼び出し側が見せる）。
    for (const tick of recording.ticks) {
      expect(tick.minutes).toBeGreaterThan(before);
      expect(tick.minutes).toBeLessThan(after);
    }
    expect(
      recording.ticks.map((tick) => tick.minutes),
      'tick境界の順に並ぶ',
    ).toEqual([...recording.ticks.map((tick) => tick.minutes)].sort((a, b) => a - b));

    // 各控えは、その時点の時計を映している（viewの時刻 = 控えの時刻）。
    for (const tick of recording.ticks) {
      const minutes = tick.view.elapsedDays * 24 * 60 + tick.view.hour * 60 + tick.view.minute;
      expect(minutes, '控えたviewはそのtick時点のワールドから作られている').toBe(
        Math.trunc(tick.minutes) - (Math.trunc(tick.minutes) % game.world.minutesPerTick),
      );
    }
  });

  it('時間を消費しない変更は、控えを持たずに出入りだけを返す', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));

    let stoneId = -1;
    const recording = recordChange(game, codex, locale, undefined, () => {
      const stone = game.session.spawn(codex.objectNames.getId('stone'));
      stoneId = stone.instanceId;
      expect(stone.moveToSlot(game.player.instance, codex.slotNames.getId('hand'))).toBeUndefined();
    });

    expect(recording.ticks, '時間が経っていないのでtick境界を跨がない').toEqual([]);
    expect(
      recording.changes.some((change) => change.object.instanceId === stoneId && change.from === undefined),
      '生まれた石の出入りは、経過し切った時点で見せる分に入る',
    ).toBe(true);
  });
});
