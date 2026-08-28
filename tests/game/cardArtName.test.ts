import { describe, expect, it } from 'vitest';
import { IslandMap, Site } from '../../src/domain/generation/IslandMap';
import { StartedGame } from '../../src/domain/generation/NewGame';
import type { WorldObject } from '../../src/domain/WorldObject';
import type { PlayScreenView } from '../../src/game/view/PlayScreenView';
import { fromGameSession } from '../../src/game/view/PlayScreenView';
import { characterCardContent } from '../../src/game/view/characterCard';
import { recipeCategories } from '../../src/game/view/recipeList';
import { parseLocale } from '../../src/locale/Localization';
import type { MiniGame } from '../support/miniGame';
import { miniGame } from '../support/miniGame';

/**
 * 札が絵を引く鍵が、object_defの識別子ではなく**型が名乗る絵の名前**（`art`、
 * GameElementDefinition.md 4.3節）であることの検査。識別子で引くと、1枚を共有している型の絵は
 * 在庫に無い鍵で引かれ、黙って絵文字の代役へ落ちる。
 *
 * **同梱の定義は読まない**——`art`を宣言している型が同梱には1つも無く、識別子で引いても差が出ない。
 */
describe('artを宣言した型の札', () => {
  /** 共有する絵の名前。**どの型の識別子とも違う**ことだけが要る（在庫の有無は札の作りに効かない）。 */
  const SHARED_ART = 'shared_art';

  const locale = parseLocale('ja.yaml', 'object_texts:\n  meadow:\n    display_name: 草原\n');

  const WORLD = `
in_progress_tags: [item]
object_defs:
  # 行き先の土地。SKELETONのlandと同じ枠を持ち、絵だけを共有する。
  meadow:
    tags: [location]
    art: ${SHARED_ART}
    slots:
      items: {cell: {accept: {tag: item}}}
      fixtures: {cell: {accept: {tag: fixture}}}
      characters: {cell_count: 1, cell: {accept: {tag: character}}}

  # 道。行き先はインスタンスごとの値なので、生成の代わりにテストが書き込む。
  road:
    tags: [fixture, path]
    props:
      destination_id: {value: 0}

  stone: {tags: [item]}

  basket:
    tags: [item]
    art: ${SHARED_ART}
    recipes:
      woven:
        steps:
          - requires: [{object: stone, count: 1, consume: true}]
            duration: 30

  hero:
    traits: [carrier]
    art: ${SHARED_ART}
`;

  /** 現在地から草原へ1本の道が通った島。道は現在地のfixturesに出ている（＝発見済み）。 */
  const setUp = (): { mini: MiniGame; meadow: WorldObject } => {
    const mini = miniGame(WORLD);
    const meadow = mini.createObject('meadow', mini.slot('locations', mini.game.world.instance));
    const road = mini.createObject('road', mini.slot('fixtures', mini.land));
    road.tryGetProperty(mini.codex.propertyNames.getId('destination_id'))!.setNumber(meadow.instanceId);
    return { mini, meadow };
  };

  /**
   * 島の地図を持ったゲーム。miniGameの島はサイトを持たない（地形生成を通さないため）ので、
   * 現在地と行き先の2つだけを置いた地図に差し替える。
   */
  const withMap = (mini: MiniGame, meadow: WorldObject): StartedGame => {
    const map = new IslandMap('test', 0, [new Site(0, 0, 0, false), new Site(1, 1, 0, false)], []);
    map.siteInstanceIds[0] = mini.land.instanceId;
    map.siteInstanceIds[1] = meadow.instanceId;
    return new StartedGame(
      mini.game.session,
      mini.game.world,
      mini.game.player,
      mini.game.startLocation,
      map,
    );
  };

  const viewOf = (mini: MiniGame, game = mini.game): PlayScreenView =>
    fromGameSession(game, mini.codex, locale);

  it('道の札は、行き先の土地の絵の名前で引く', () => {
    const { mini } = setUp();

    const card = viewOf(mini).cardsIn(mini.slot('fixtures', mini.land))[0]!;

    expect(card.art).toBe(SHARED_ART);
  });

  it('地図ウィンドウの土地は、その土地の絵の名前で引く', () => {
    const { mini, meadow } = setUp();

    const lands = viewOf(mini, withMap(mini, meadow)).mapLands;

    expect(lands.find((land) => land.site === 1)?.card.art).toBe(SHARED_ART);
  });

  it('レシピ一覧の完成品は、完成品の絵の名前で引く', () => {
    const { mini } = setUp();

    const shelves = recipeCategories(mini.game, mini.codex, locale, () => {});

    expect(shelves.flatMap((shelf) => shelf.entries).map((entry) => entry.card.art)).toEqual([SHARED_ART]);
  });

  it('開始画面のキャラクタは、そのキャラクタの絵の名前で引く', () => {
    const { mini } = setUp();

    expect(characterCardContent(mini.codex, 'hero', locale).art).toBe(SHARED_ART);
  });
});
