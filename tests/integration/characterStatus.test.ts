import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { StartedGame } from '../../src/domain/generation/NewGame';
import { startNewGame } from '../../src/domain/generation/NewGame';
import type { PlayScreenView } from '../../src/game/view/PlayScreenView';
import { fromGameSession } from '../../src/game/view/PlayScreenView';
import type { CardPlace, ScreenPlace } from '../../src/game/view/cardPlaces';
import { cardPlacesOf } from '../../src/game/view/cardPlaces';
import type { Localization } from '../../src/locale/Localization';
import { parseLocale } from '../../src/locale/Localization';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';
import { seededRng } from '../../src/domain/Rng';

/**
 * 同梱のキャラクタ定義（`characters/`）が作る値が、そのまま画面の説明として読めることを通しで見る試験。
 *
 * 段の名前も境目も、荷が重すぎて歩けなくなる重さも、宣言した数字そのもの。**画面側だけを見ても、
 * 宣言側だけを見ても、噛み合っているかは分からない**ので、実データに依存したまま確かめる。
 */
describe('キャラクタのステータス（世界→映し 通し）', () => {
  let codex: WorldCodex;
  let locale: Localization;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    locale = parseLocale('ja.yaml', 'object_texts:\n  stone:\n    display_name: 石\n');
  });

  /** その区画のレーンに並んでいる札（空き枠を除いたもの）。 */
  function lane(view: PlayScreenView, game: StartedGame, screen: ScreenPlace) {
    return view.cardsIn(place(game, screen)).filter((card) => card !== undefined);
  }

  function place(game: StartedGame, screen: ScreenPlace): CardPlace {
    return cardPlacesOf(game.player, game.player.location ?? game.startLocation)(screen);
  }

  /** 現在地を探索率100%まで探索する。100%到達後も探索は続けられるため、回数で止める。 */
  function exploreToFull(game: StartedGame): void {
    const location = game.player.location ?? game.startLocation;
    for (let i = 0; i < location.explorationProgressMax; i++) game.player.explore();
  }

  it('ステータスの詳細には、意味・今いる段・影響の出入りが揃う', () => {
    // ステータス詳細ウィンドウ（Windows.md 8節）。UIはどのステータスが何に効くかを知らず、
    // 持続効果の宣言（characters/）から導いたものをそのまま並べる。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, seededRng(1234));

    const view = fromGameSession(game, codex, locale);
    const bodyFat = view.propertyCategories
      .flatMap((tab) => tab.entries)
      .find((entry) => entry.key === 'body_fat');

    expect(bodyFat?.stage?.name, '開始直後は標準の段（characters/）').toBe('nourished');
    // 段はrangeの中の区間で、上端は次の段のmin（nourished 480〜stout 2880、medic）。
    expect(bodyFat?.stage?.span?.start).toBeCloseTo(480 / 5760);
    expect(bodyFat?.stage?.span?.end).toBeCloseTo(2880 / 5760);
    // 目盛りは全部の段の境目（starved 0 は下限なので含まない。gaunt 96・nourished 480・stout 2880・obese 4320）。
    expect(bodyFat?.stage?.boundaries).toEqual([96, 480, 2880, 4320].map((value) => value / 5760));
    // 段の中の進みは、その段の中だけを見た割合（開始値1440は nourished 480〜2880 の4割）。
    expect(bodyFat?.stage?.progress?.nextName).toBe('stout');
    expect(bodyFat?.stage?.progress?.ratio).toBeCloseTo((1440 - 480) / (2880 - 480));
    expect(
      bodyFat?.detail?.received.map((influence) => `${influence.name}${influence.increases ? '+' : '-'}`),
      '3大栄養素が流れ込み、自分の段の基礎代謝が削る',
    ).toEqual(['carbohydrate+', 'protein+', 'lipid+', 'body_fat-']);
    expect(
      bodyFat?.detail?.received.every((influence) => !influence.reversible),
      'transferもaddも不可逆なので、記号は＋−になる',
    ).toBe(true);
  });

  it('荷が重すぎると移動のアクションが押せなくなり、理由の文言が付く', () => {
    // ContainerSystem.md 5節: 危険域（too_heavy）に入ると道のtravelのconditionsが落ちる。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, seededRng(1234));
    exploreToFull(game);
    const localeWithReason = parseLocale('ja.yaml', 'reason_texts:\n  too_heavy: 荷が重すぎて歩けない。\n');
    const pathTagId = codex.tagNames.getId('path');
    const travelOf = (view: ReturnType<typeof fromGameSession>) =>
      lane(view, game, 'fixtures').find((card) => card.objects[0].def.tags.includes(pathTagId))!.actions[0];

    expect(travelOf(fromGameSession(game, codex, localeWithReason)).enabled, '空身なら歩ける').toBe(true);

    // 手持ちへ石（1kgずつ）を積んで、どのキャラクタでも危険域へ届く重さにする。同じ物は束ねられる
    // ので、枠数の決まった手持ちにも40個入る。
    const handId = codex.slotNames.getId('hand');
    for (let i = 0; i < 40; i++)
      game.session
        .createObject(codex.objectNames.getId('stone'))
        .moveToSlotOrRejection(game.player.instance.getSlot(handId));
    expect(
      game.player.instance.tryGetProperty(codex.propertyNames.getId('load'))?.getEffectiveValue() ?? 0,
      '持ち物の重さがそのまま負荷になる',
    ).toBeGreaterThan(0);

    const travel = travelOf(fromGameSession(game, codex, localeWithReason));
    expect(travel.enabled).toBe(false);
    expect(travel.reason).toBe('荷が重すぎて歩けない。');

    travel.execute();
    expect(game.player.location?.instance.instanceId, '押しても移動しない').toBe(
      game.startLocation.instance.instanceId,
    );
  });

  it('同じに描かれる影響は1つの枠へ畳まれ、件数が付く', () => {
    // Windows.md 8節: 中身の子N個は同じ絵・同じ記号になるので、並べても数えるしかない。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, seededRng(1234));
    const handId = codex.slotNames.getId('hand');
    for (let i = 0; i < 40; i++)
      game.session
        .createObject(codex.objectNames.getId('stone'))
        .moveToSlotOrRejection(game.player.instance.getSlot(handId));

    const load = fromGameSession(game, codex, locale)
      .propertyCategories.flatMap((tab) => tab.entries)
      .find((entry) => entry.key === 'load')?.detail;

    const fromStones = load?.received.filter((influence) => influence.name === '石');
    expect(fromStones?.length, '40個の石は1枠').toBe(1);
    expect(fromStones?.[0].count).toBe(40);
  });
});
