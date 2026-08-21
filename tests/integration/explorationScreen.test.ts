import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { NewGameSession } from '../../src/domain/generation/NewGame';
import { start as startNewGame } from '../../src/domain/generation/NewGame';
import { Path } from '../../src/domain/views/Path';
import type { PlayScreenView } from '../../src/game/view/PlayScreenView';
import { fromGameSession } from '../../src/game/view/PlayScreenView';
import { characterIcon } from '../../src/game/view/characterCard';
import type { CardPlace, ScreenPlace } from '../../src/game/view/cardPlaces';
import { cardPlacesOf } from '../../src/game/view/cardPlaces';
import type { Localization } from '../../src/locale/Localization';
import { parseLocale } from '../../src/locale/Localization';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { SeededRng } from '../support/SeededRng';
import { pathsIn } from '../support/paths';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 探索して見つけたもの・道・地図が画面に出るまでを、世界・映しを繋いだまま通す試験。
 *
 * ここで見るのは、**生成された島が画面に届くか**——土地の名前は命名処理（NameAssigner）だけが持ち、
 * 道の行き先は生成された繋がりでしか決まらない。層を切り離すとどちらも作れないので、
 * 実データ（terrain_generation.yaml・locations.yaml）とrngの引きに依存する。
 */
describe('探索と地図（世界→映し 通し）', () => {
  let codex: WorldCodex;
  let locale: Localization;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    locale = parseLocale('ja.yaml', 'object_texts:\n  stone:\n    display_name: 石\n');
  });

  /** その区画のレーンに並んでいる札（空き枠を除いたもの）。 */
  function lane(view: PlayScreenView, game: NewGameSession, screen: ScreenPlace) {
    return view.cardsIn(place(game, screen)).filter((card) => card !== undefined);
  }

  /** 画面の区画（3つのレーン）が今映している場所。 */
  function place(game: NewGameSession, screen: ScreenPlace): CardPlace {
    return cardPlacesOf(game.player, game.player.location ?? game.startLocation)(screen);
  }

  /** 現在地を探索率100%まで探索する。100%到達後も探索は続けられるため、回数で止める。 */
  function exploreToFull(game: NewGameSession): void {
    const location = game.player.location ?? game.startLocation;
    for (let i = 0; i < location.explorationProgressMax; i++) game.player.explore();
  }

  it('開始直後は漂着地だけが出て、設置物・アイテムのレーンは空になる', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));

    const view = fromGameSession(game, codex, locale);

    expect(view.currentLocationCard.name, '現在地は命名処理が付けた漂着地の名前').toBe(
      locale.locationName(game.map.nameOfInstance(game.startLocation.instance.instanceId)!),
    );
    expect(lane(view, game, 'fixtures'), '未探索なので設置物も道も見つかっていない').toEqual([]);
    expect(lane(view, game, 'items'), '未探索なので土地には何も落ちていない').toEqual([]);
    expect(view.elapsedDays).toBe(0);
    expect(view.hour * 60 + view.minute, '時計はランダムに決まった開始時刻をそのまま映す').toBe(
      game.world.hour * 60 + game.world.minute,
    );
  });

  it('探索で見つかった発見物と道が、それぞれのレーンの内容になる', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const location = game.startLocation;
    exploreToFull(game);

    const view = fromGameSession(game, codex, locale);

    expect(lane(view, game, 'items').map((card) => card.name)).toEqual(
      location.itemStacks.map((stack) => locale.object(stack[0].def.name).displayName),
    );
    expect(lane(view, game, 'items').length, '探索し切れば何かしら見つかっている').toBeGreaterThan(0);

    // 設置物のレーンには道も並ぶ。道のカードだけは、道そのものではなく行き先の土地名を映す。
    const pathTagId = codex.tagNames.getId('path');
    expect(lane(view, game, 'fixtures').map((card) => card.name)).toEqual(
      location.fixtureStacks.map((stack) =>
        stack[0].def.tags.includes(pathTagId)
          ? locale.locationName(game.map.nameOfInstance(new Path(stack[0], codex).destinationInstanceId)!)
          : locale.object(stack[0].def.name).displayName,
      ),
    );
    expect(pathsIn(location, codex).length, '探索し切れば全ての道が見つかっている').toBeGreaterThan(0);
  });

  it('行き先の違う道は、1枚のカードにまとまらない', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);
    const paths = pathsIn(game.startLocation, codex);
    const destinations = new Set(paths.map((path) => new Path(path, codex).destinationInstanceId));
    expect(destinations.size, '行き先の違う道が2本以上ある土地で確かめる').toBeGreaterThan(1);

    const view = fromGameSession(game, codex, locale);

    // 設置物のレーンには探索で見つかった木や茂みも並ぶので、道のカードだけを数える。
    const pathTagId = codex.tagNames.getId('path');
    const pathCardNames = lane(view, game, 'fixtures')
      .filter((card) => card.objects[0].def.tags.includes(pathTagId))
      .map((card) => card.name);

    expect(new Set(pathCardNames).size, '道のカードは行き先ごとに分かれる').toBe(destinations.size);
  });

  it('道のカードは行き先の土地の絵を出し、他の設置物は自分の絵を出す', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);

    const view = fromGameSession(game, codex, locale);

    const pathTagId = codex.tagNames.getId('path');
    const [paths, others] = [true, false].map((isPath) =>
      lane(view, game, 'fixtures').filter((card) => card.objects[0].def.tags.includes(pathTagId) === isPath),
    );
    expect(paths.length, '道と道以外が並ぶ土地で確かめる').toBeGreaterThan(0);
    expect(others.length).toBeGreaterThan(0);

    expect(paths.map((card) => card.art)).toEqual(
      paths.map((card) => new Path(card.objects[0], codex).destination?.def.name),
    );
    expect(
      paths.some((card) => card.art !== game.startLocation.instance.def.name),
      '行き先は今いる土地とは限らない',
    ).toBe(true);
    expect(others.every((card) => card.art === card.objects[0].def.name)).toBe(true);
  });

  it('探索率は現在地の進捗を0〜1で表し、100%を超えない', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));

    expect(
      fromGameSession(game, codex, locale).currentLocationWindow.explorationRatio,
      '開始直後は未探索',
    ).toBe(0);

    exploreToFull(game);
    expect(
      fromGameSession(game, codex, locale).currentLocationWindow.explorationRatio,
      '探索し切れば100%',
    ).toBe(1);

    // 100%到達後も探索は続けられる（ExplorationSystem.md 2節）が、探索率は100%のまま。
    expect(game.player.explore()).toBe(true);
    expect(fromGameSession(game, codex, locale).currentLocationWindow.explorationRatio).toBe(1);
  });

  it('道のカードのアクションで、現在地が行き先へ移る', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);
    const path = new Path(pathsIn(game.startLocation, codex)[0], codex);

    const view = fromGameSession(game, codex, locale);
    const card = lane(view, game, 'fixtures').find((fixture) => fixture.objects[0] === path.instance)!;
    card.actions.find((action) => action.name === 'travel')!.execute();

    expect(fromGameSession(game, codex, locale).currentLocationCard.name).toBe(
      locale.locationName(game.map.nameOfInstance(path.destinationInstanceId)!),
    );
  });

  it('開始直後の地図は、現在地の土地だけを知っていて道は無い', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));

    const view = fromGameSession(game, codex, locale);

    expect(view.mapLands.map((land) => land.card.name)).toEqual([view.currentLocationCard.name]);
    expect(view.mapLands[0].site, 'サイトindexは現在地の土地を指す').toBe(
      game.map.siteInstanceIds.indexOf(game.startLocation.instance.instanceId),
    );
    expect(view.mapLands[0].current, '現在地のカードは強調表示の対象').toBe(true);
    expect(view.mapRoads).toEqual([]);
  });

  it('探索で道が見つかると、地図はその道と行き先の土地を知る', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);

    const view = fromGameSession(game, codex, locale);

    const currentSite = game.map.siteInstanceIds.indexOf(game.startLocation.instance.instanceId);
    const destinations = pathsIn(game.startLocation, codex).map((path) =>
      game.map.siteInstanceIds.indexOf(new Path(path, codex).destinationInstanceId),
    );
    expect(destinations.length, '道が見つかる土地で確かめる').toBeGreaterThan(0);

    expect(new Set(view.mapLands.map((land) => land.site)), '現在地と、見つかった道の行き先').toEqual(
      new Set([currentSite, ...destinations]),
    );
    expect(new Set(view.mapRoads.map((road) => `${road.a}/${road.b}`)), '道は両端で1本にまとまる').toEqual(
      new Set(
        destinations.map((site) =>
          site < currentSite ? `${site}/${currentSite}` : `${currentSite}/${site}`,
        ),
      ),
    );
    for (const road of view.mapRoads) {
      expect(
        view.mapLands.some((land) => land.site === road.a) &&
          view.mapLands.some((land) => land.site === road.b),
        '道の両端は必ず既知の土地',
      ).toBe(true);
    }
  });

  it('地図の土地カードは、その土地の名前と絵を持つ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);

    const view = fromGameSession(game, codex, locale);

    const root = game.startLocation.instance.findRoot();
    for (const land of view.mapLands) {
      const instanceId = game.map.siteInstanceIds[land.site];
      expect(land.card.name).toBe(locale.locationName(game.map.nameOfInstance(instanceId)!));
      expect(land.card.art, '絵は土地のobject_defの識別子で引く').toBe(
        root.findDescendantByInstanceId(instanceId)?.def.name,
      );
      expect(land.card.art).toBeDefined();
    }
  });

  it('移動しても、それまでに知った土地と道は地図に残る', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);
    const before = fromGameSession(game, codex, locale);
    const path = new Path(pathsIn(game.startLocation, codex)[0], codex);
    expect(path.travel(game.player.instance)).toBe(true);

    const view = fromGameSession(game, codex, locale);

    expect(new Set(view.mapLands.map((land) => land.site))).toEqual(
      new Set(before.mapLands.map((land) => land.site)),
    );
    expect(new Set(view.mapRoads.map((road) => `${road.a}/${road.b}`))).toEqual(
      new Set(before.mapRoads.map((road) => `${road.a}/${road.b}`)),
    );

    // 強調表示（current）は1枚だけで、移動に追従する。
    const currentSites = view.mapLands.filter((land) => land.current).map((land) => land.site);
    expect(currentSites).toEqual([game.map.siteInstanceIds.indexOf(path.destinationInstanceId)]);
  });

  it('現在地は移動に追従する', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);
    const path = new Path(pathsIn(game.startLocation, codex)[0], codex);
    expect(path.travel(game.player.instance)).toBe(true);

    const view = fromGameSession(game, codex, locale);

    expect(view.currentLocationCard.name).toBe(
      locale.locationName(game.map.nameOfInstance(path.destinationInstanceId)!),
    );
  });

  it('道のカードのアクションは、その道が持つ移動時間を出す', () => {
    // travelのdurationはその道のtravel_minutesを引く（locations.yaml）。道は生成された繋がりに
    // しか無いので、時間の出どころもここでしか確かめられない。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    exploreToFull(game);
    const path = pathsIn(game.startLocation, codex)[0];

    const view = fromGameSession(game, codex, locale);
    const travel = lane(view, game, 'fixtures').find((card) => card.objects[0] === path)!.actions[0];

    expect(travel.minutes).toBe(new Path(path, codex).travelMinutes);
    expect(travel.minutes, '移動には時間がかかる').toBeGreaterThan(0);
  });

  it('キャラクタと土地の札も、他の札と同じ道で作る', () => {
    // どちらもWorldObjectで、種別は物の型が名乗るタグ（character / location、core.yaml）から決まる。
    // 札の作り方を対象ごとに分けると、印・バー・個体の識別子といった規約がそこにだけ届かなくなる。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const view = fromGameSession(game, codex, locale);

    expect(view.characterCard.kind).toBe('character');
    expect(view.characterCard.icon, 'キャラクタは型ごとの代役アイコンを持つ').toBe(
      characterIcon(SAMPLE_CHARACTER),
    );
    expect(view.characterCard.identity, '貸し出した札が帰る先の鍵').toEqual([
      game.player.instance.instanceId,
    ]);

    expect(view.currentLocationCard.kind).toBe('location');
    expect(view.currentLocationCard.identity).toEqual([game.startLocation.instance.instanceId]);
    expect(view.currentLocationCard.name, '個体に付いた名前は型の名前より優先される').toBe(
      locale.locationName(game.map.nameOfInstance(game.startLocation.instance.instanceId)!),
    );
  });
});
