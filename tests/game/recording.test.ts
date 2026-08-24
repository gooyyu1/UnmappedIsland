import { beforeAll, describe, expect, it } from 'vitest';
import type { Localization } from '../../src/locale/Localization';
import { parseLocale } from '../../src/locale/Localization';
import { runAndRecordChange } from '../../src/game/view/recording';
import type { MiniGame } from '../support/miniGame';
import { miniGame } from '../support/miniGame';

/**
 * ワールドを変える操作の、経過中のtickごとの控え（runAndRecordChange）の自動テスト。
 *
 * 経過し切ったあとの画面が正しくても、経過中のフレームが壊れていることはある。控えがtickごとに
 * 取れていること・各控えがその時点のワールドを映していることを、画面を作らずに確かめる。
 *
 * **ワールドは直に動かす**（advanceWorldTime・destroy）。どの操作が何分かかるかは世界側の宣言の話で、
 * 控える側の責務ではない。
 */
describe('runAndRecordChange（経過中のtickごとの控え）', () => {
  let locale: Localization;

  beforeAll(() => {
    locale = parseLocale(
      'ja.yaml',
      'object_texts:\n  stone:\n    display_name: 石\n  tree:\n    display_name: 木\n',
    );
  });

  const setUp = (): MiniGame =>
    miniGame(`
object_defs:
  stone:
    tags: [item]
  tree:
    tags: [fixture]
`);

  it('時間の経過は、tick境界ごとに表示内容を控える', () => {
    const mini = setUp();
    const game = mini.game;
    const before = game.world.totalMinutes;

    const recording = runAndRecordChange(game, mini.codex, locale, undefined, () => {
      game.session.advanceWorldTime(60);
    });

    const after = game.world.totalMinutes;
    expect(after, '60分ぶん進む').toBe(before + 60);

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
        Math.trunc(tick.minutes) - (Math.trunc(tick.minutes) % game.world.rawMinutesPerTick),
      );
    }
  });

  it('経過中の控えは、経過し切ってから起きた変化を映さない', () => {
    // 控えたviewは、あとから実時間をかけて見せる。cardsInは呼んだ時点の生きたワールドを読むので、
    // 控えるときに常に見えている3つのレーンが焼き付いていないと、経過中の画面に未来が映る
    // （withFrozenCards）。**焼き付けを頼むのは控える側の仕事ではない**ので、3つとも渡していない。
    const mini = setUp();
    const hand = mini.slot('hand');
    const items = mini.slot('items', mini.land);
    const fixtures = mini.slot('fixtures', mini.land);
    const shown = [
      { name: '手持ち', lane: hand, object: mini.createObject('stone', hand) },
      { name: 'アイテム', lane: items, object: mini.createObject('stone', items) },
      { name: '設置物', lane: fixtures, object: mini.createObject('tree', fixtures) },
    ].map((lane) => ({ ...lane, instanceId: lane.object.instanceId }));

    const recording = runAndRecordChange(mini.game, mini.codex, locale, undefined, () => {
      mini.game.session.advanceWorldTime(60);
      for (const { object } of shown) object.destroy();
    });

    expect(recording.ticks.length, '60分ぶんのtick境界がある').toBeGreaterThan(0);
    for (const tick of recording.ticks)
      for (const { name, lane, object } of shown)
        expect(
          tick.view.cardsIn(lane).map((card) => card?.objectGlobalId),
          `tick@${tick.minutes}の${name}レーンには、まだ物がある`,
        ).toContain(object.def.globalId);

    for (const { name, instanceId } of shown)
      expect(
        recording.changesAtEnd.some((change) => change.object.instanceId === instanceId),
        `${name}レーンの物が消えるのは、経過し切った時点`,
      ).toBe(true);
  });

  it('時間を消費しない変更は、控えを持たずに出入りだけを返す', () => {
    const mini = setUp();

    let stoneId = -1;
    const recording = runAndRecordChange(mini.game, mini.codex, locale, undefined, () => {
      stoneId = mini.createObject('stone', mini.slot('hand')).instanceId;
    });

    expect(recording.ticks, '時間が経っていないのでtick境界を跨がない').toEqual([]);
    expect(
      recording.changesAtEnd.some(
        (change) => change.object.instanceId === stoneId && change.from === undefined,
      ),
      '生まれた石の出入りは、経過し切った時点で見せる分に入る',
    ).toBe(true);
  });
});
