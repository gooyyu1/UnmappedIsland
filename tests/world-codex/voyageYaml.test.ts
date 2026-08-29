import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { startNewGame } from '../../src/domain/generation/NewGame';
import type { StartedGame } from '../../src/domain/generation/NewGame';
import type { WorldObject } from '../../src/domain/WorldObject';
import { Location } from '../../src/domain/wrappers/Location';
import { applyScenario, bundledScenario } from '../../src/scenario/Scenario';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import {
  loadYamlDirectory,
  SAMPLE_CHARACTER,
  WORLD_CODEX_DIR,
  worldCodexYamlPaths,
} from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction } from '../support/illumination';
import { namedEntries, nodeAt, objectValueAt, readSeaChart } from '../support/seaChain';
import { seededRng } from '../../src/domain/Rng';

/**
 * 8種類の顔ぶれ（docs/world/ContentSkeleton.md 7節）と、それを配った海区。**顔ぶれは型でもタグでも
 * ないので、どの海区がどの顔ぶれかを知っているのはこの表と、海区のつまみの値だけ。**
 */
const FACES: ReadonlyMap<string, readonly string[]> = new Map([
  ['沿岸', ['coastal_waters', 'mainland_shallows']],
  ['潮目', ['tide_rip', 'outer_tide_rip']],
  ['海藻の帯', ['kelp_belt', 'drifting_kelp']],
  ['岩礁', ['reef_shallows', 'black_reef']],
  ['海鳥の岩', ['gull_rock', 'white_rock']],
  ['沈船の海', ['wreck_waters']],
  ['小島のある海区', ['islet_waters']],
  ['空の海', ['open_water', 'long_swell']],
]);

/**
 * 小島（`offshore_islet`）が立つ海区。**顔ぶれが決める**（ContentSkeleton.md 7節）——小島のある海区と、
 * 海鳥の岩（鳥が巣を作るその岩が、上陸できる小島そのもの）の2つ。
 */
const ISLET_ZONES: readonly string[] = ['gull_rock', 'islet_waters', 'white_rock'];

/** 砂浜から最寄りの小島（海鳥の岩）まで、見張って渡っていく海区の順（4区間、素の横断時間1680分）。 */
const TO_NEAREST_ISLET: readonly string[] = ['coastal_waters', 'kelp_belt', 'tide_rip', 'reef_shallows'];

/**
 * 帰り道——今いる海区と、そこで押す航路。**行きに見張った辺をそのまま戻る**ので、帰りに見張りは
 * 1度も要らない（GameEndings.md 12.5節）。最後の1本（`route_to_shore`）だけが海岸へ着く。
 */
const BACK_TO_SHORE: readonly (readonly [string, string])[] = [
  ['gull_rock', 'route_to_reef_shallows'],
  ['reef_shallows', 'route_to_tide_rip'],
  ['tide_rip', 'route_to_kelp_belt'],
  ['kelp_belt', 'route_to_coastal_waters'],
  ['coastal_waters', 'route_to_shore'],
];

/**
 * 海岸と、そこから漕ぎ出したときに立つ海区（voyage.yamlのcoast trait、locations.yamlの各海岸）。
 * **出航地点ごとに違うのはこの1点だけ**で、距離も危険度もそこからの帰結（GameEndings.md 5節）。
 */
const OFFSHORE: ReadonlyMap<string, string> = new Map([
  ['sandy_beach', 'coastal_waters'],
  ['rocky_coast', 'tide_rip'],
  ['cliff_coast', 'gull_rock'],
]);

/** 海岸が「この海区に面している」と名乗るつまみの綴り（voyage.yamlのcoast trait）。 */
const OFFSHORE_PREFIX = 'offshore_';

/** 見張りの発見量のつまみ（voyage.yamlのsea_zone）。 */
const KNOBS = [
  'barren_find',
  'driftwood_find',
  'flotsam_find',
  'seaweed_find',
  'egg_find',
  'wreck_find',
  'shoal_find',
  'seabird_find',
];

/**
 * 顔ぶれごとに、見張りが返すもの——拾えるもの（手に入る）・湧くもの（海区に立つ）・実りの濃さ
 * （1回の見張りで何かが返る割合）。**顔ぶれ1つにつき1つの海区**を見る（同じ顔ぶれの海区が同じ
 * 配り方であることは別の検査が受け持つ）。
 *
 * 濃さの許容幅は、試行回数ぶんの揺れ（標準誤差は0.04ほど）より広く、顔ぶれの差（0.8/0.55/0.2/0）
 * より狭く取る。
 */
const YIELDS: readonly (readonly [string, readonly string[], readonly string[], number, number])[] = [
  ['coastal_waters', ['thick_branch', 'seaweed'], ['fish_shoal'], 0.7, 0.9],
  ['tide_rip', [], ['fish_shoal'], 0.7, 0.9],
  ['kelp_belt', ['seaweed'], [], 0.45, 0.65],
  ['reef_shallows', ['thick_branch', 'rope'], ['fish_shoal'], 0.45, 0.65],
  ['gull_rock', ['bird_egg', 'feather'], ['seabird_flock'], 0.45, 0.65],
  ['wreck_waters', ['thick_branch', 'rope', 'golden_chalice'], [], 0.1, 0.3],
  ['islet_waters', [], [], 0, 0],
  ['open_water', [], [], 0, 0],
];

/** 1つの海区を何回見張って数えるか。 */
const WATCHES = 120;

/** 海区の網（航路の宣言から組み立てたもの）。行き先の型から海区を引くのに使う。 */
const SEA_CHART = readSeaChart();

/** 航路が二手に分かれる海区（voyage.yaml のうねりの海）と、そこから出る近道・遠回りの航路。 */
const FORK = 'long_swell';
const SHORTCUT_ONWARD = 'route_to_drifting_kelp';
const DETOUR_ONWARD = 'route_to_outer_tide_rip';

/**
 * 島からの脱出（voyage.yaml、docs/world/Voyage.md）の検証。
 *
 * 出航（筏ごと最初の海区へ移る）・見張り（航路が現れる）・横断（風と積載が時間を決める）・
 * 到達（最後の海区から本土へ渡る）を、出航のしたくシナリオ（voyage_ready.yaml）の状態から
 * 実際に動かして確かめる。
 */
describe('筏と航海', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  });

  /** 出航のしたくシナリオの状態から始める（砂浜に積荷入りの筏があり、聖杯も積んである）。 */
  function ready(): { game: StartedGame; raft: WorldObject } {
    const scenario = bundledScenario('voyage_ready');
    if (scenario === undefined) throw new Error('同梱シナリオ voyage_ready がありません。');

    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, seededRng(scenario.seed));
    applyScenario(game, scenario, codex);

    const raft = game.startLocation.fixtures.find((fixture) => fixture.def.name === 'raft');
    if (raft === undefined) throw new Error('シナリオが筏を置いていません。');
    return { game, raft };
  }

  /** 世界にただ1つ在る場所（海区・本土）を型の名前で引く（singleton、15節）。 */
  function singletonPlace(game: StartedGame, defName: string): WorldObject {
    const place = game.world.instance.findSelfOrDescendantOfDef(codex.objectNames.getId(defName));
    if (place === undefined) throw new Error(`${defName} が世界に居ません。`);
    return place;
  }

  /** 風向きを直接置く（8時間ごとの引き直しは天気と同じ仕組みなので、ここでは向きだけを固定する）。 */
  function setWind(game: StartedGame, wind: string): void {
    game.world.instance
      .getProperty(codex.propertyNames.getId('wind'))
      .setNumberWithoutEvents(codex.symbolNames.getId(wind));
  }

  /**
   * 天気と風向きを据えたまま動かなくする（core.yamlのweather/wind）。**残り時間も一緒に伸ばす**
   * ——どちらも残り時間が尽きれば引き直されるので、置いただけでは数tickのうちに別のものへ変わる。
   */
  function holdWeather(game: StartedGame, weather: string, wind: string): void {
    const world = game.world.instance;
    world
      .getProperty(codex.propertyNames.getId('weather'))
      .setNumberWithoutEvents(codex.symbolNames.getId(weather));
    setWind(game, wind);
    for (const name of ['weather_remaining', 'wind_remaining'])
      world.getProperty(codex.propertyNames.getId(name)).setNumberWithoutEvents(9999);
  }

  function propertyOf(object: WorldObject, name: string): number {
    return object.tryGetProperty(codex.propertyNames.getId(name))?.getEffectiveValue() ?? 0;
  }

  /** 1tick（15分）進める。 */
  function tick(game: StartedGame): void {
    game.session.advanceWorldTime(game.world.rawMinutesPerTick);
  }

  /** 今の海区を1回見張る（地上の探索そのもの）。 */
  function keepWatch(game: StartedGame, zone: WorldObject): boolean {
    return new Location(zone, codex).explore(game.player.instance);
  }

  /** その海区に現れている航路（宣言順。まだ見えていなければ空）。 */
  function sightedRoutes(zone: WorldObject): readonly WorldObject[] {
    return new Location(zone, codex).fixtures.filter((fixture) =>
      fixture.def.hasTag(codex.tagNames.getId('sea_route')),
    );
  }

  /** その海区から、名指しした行き先の航路を渡る。渡れなければfalse。 */
  function cross(game: StartedGame, zone: WorldObject, routeName: string): boolean {
    const route = sightedRoutes(zone).find((fixture) => fixture.def.name === routeName);
    return route?.tryGetAction('cross', game.player.instance)?.tryExecute() === true;
  }

  /**
   * その海区の航路が見えるまで見張り、**その見張りが立てた航路**を宣言順に返す。
   *
   * 渡り着いた海区には来た航路が既に立っている（航路は辺なので、見つけた側の見張りが両端へ1本ずつ
   * 立てる。voyage.yaml）ので、今そこに在る航路からは進む先を選べない。**見張りの前後の差**が、
   * その見張りの成果になる。
   *
   * **航路が現れた時点で止める。** 見張り自体は航路が見えた後も続けられる（GameEndings.md 12.1節）
   * ので、止めるのはこの検査の都合。回数の上限は、どの海区の必要回数（最大5）よりも十分に大きい値。
   */
  function watchUntilSighted(game: StartedGame, zone: WorldObject): readonly WorldObject[] {
    const before = new Set(sightedRoutes(zone).map((route) => route.instanceId));
    const sinceBefore = (): readonly WorldObject[] =>
      sightedRoutes(zone).filter((route) => !before.has(route.instanceId));

    for (let i = 0; i < 20 && sinceBefore().length === 0 && keepWatch(game, zone); i++);
    return sinceBefore();
  }

  /**
   * その海区の航路が見えるまで見張り、**本土へ最短で近づく航路**を渡る。渡れなければfalse。
   *
   * 見張りが立てるのは進む先の航路だけだが、**分かれ道では2本立つ**（voyage.yaml のうねりの海）ので、
   * 宣言順ではなく行き先の残り海区数で選ぶ——最短の経路を辿ることを、この検査の側で決めておく。
   */
  function watchAndCross(game: StartedGame, zone: WorldObject): boolean {
    const remainingId = codex.propertyNames.getId('zones_to_mainland');
    const remainingBeyond = (route: WorldObject): number => {
      const destination = SEA_CHART.routeDestinations.get(route.def.name);
      const zone = destination === undefined ? undefined : singletonPlace(game, destination);
      // 本土そのものへの航路が最短（残り0）。海区でない行き先は残り海区数を持たない。
      return zone?.tryGetProperty(remainingId)?.getEffectiveValue() ?? 0;
    };

    const onward = [...watchUntilSighted(game, zone)].sort((a, b) => remainingBeyond(a) - remainingBeyond(b));
    return onward.at(0)?.tryGetAction('cross', game.player.instance)?.tryExecute() === true;
  }

  /**
   * 渇きと飢えを満たす。**海区をいくつも渡ると数日かかる**ので、補給せずに渡ると乗り手が先に
   * 倒れる——航海の検査で見たいのは海区の連なりのほうで、何日ぶんの水と食料が要るかは別の問題
   * （GameEndings.md 12.4節）。
   */
  function keepAlive(game: StartedGame): void {
    for (const name of ['hydration', 'satiety']) {
      const property = game.player.instance.getProperty(codex.propertyNames.getId(name));
      property.setNumberWithoutEvents(property.def.range?.max ?? 0);
    }
  }

  /**
   * 今居る海区から本土まで、見張って渡ることを繰り返す。渡った海区の名前を順に返す。
   *
   * 回数の上限は、鎖の長さ（十数個）より十分に大きい値。
   */
  function voyageToMainland(game: StartedGame, raft: WorldObject): string[] {
    const visited: string[] = [];
    for (let i = 0; i < 40 && raft.parent?.def.name !== 'mainland'; i++) {
      const zone = raft.parent!;
      visited.push(zone.def.name);
      keepAlive(game);
      expect(watchAndCross(game, zone), `${zone.def.name} から渡れる`).toBe(true);
    }
    return visited;
  }

  /** 筏に載っているもの（乗り手を除く直の子）の名前。積荷が減っていないかを見るのに使う。 */
  function cargoNames(raft: WorldObject): string[] {
    return [...raft.children()]
      .filter((object) => !object.def.hasTag(codex.tagNames.getId('character')))
      .map((object) => object.def.name)
      .sort();
  }

  it('出航すると、プレイヤーごと筏が島に最も近い海区へ移る', () => {
    const { game, raft } = ready();

    expect(raft.tryGetAction('set_sail', game.player.instance)?.tryExecute() === true, '出航できる').toBe(
      true,
    );

    expect(raft.parent?.def.name, '筏は島影の海に居る').toBe('coastal_waters');
    expect(game.player.location?.instance.instanceId, 'プレイヤーは筏の中に居る').toBe(raft.instanceId);
    // 積荷は筏の中に居るので、筏が動けば一緒に動く（親子関係だけで表す、Voyage.md 2節）。
    expect(
      [...raft.descendants()].some((object) => object.def.name === 'golden_chalice'),
      '積荷も一緒に運ばれる',
    ).toBe(true);
  });

  it('海に面していない土地からは出航できない', () => {
    const { game, raft } = ready();
    const inland = game.map.sites.find((site) => site.type!.name === 'grassland');
    expect(inland, 'シード3の島に草原がある').toBeDefined();

    const landing = game.world.instance.findSelfOrDescendantByInstanceId(
      game.map.siteInstanceIds[inland!.index],
    );
    expect(
      raft.moveToSlotOrRejection(landing!.getSlot(codex.slotNames.getId('fixtures'))),
      '筏を内陸へ運ぶ',
    ).toBeUndefined();

    expect(raft.tryGetAction('set_sail', game.player.instance)?.tryExecute() === true, '出航できない').toBe(
      false,
    );
    expect(raft.parent?.instanceId, '筏は内陸に残る').toBe(landing!.instanceId);
  });

  it('海区には物を置く枠が無いので、積荷を海面へ置けない', () => {
    // **確定した仕様（GameEndings.md 12.7節）そのもの。** 置ける枠を作るかどうかは、置いてほしい物
    // ではなく置けてしまう物で決まる——枠を作れば、漂流物だけでなく積荷の石も置ける。
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    const zone = singletonPlace(game, 'coastal_waters');

    const cargo = [...raft.children()].find((object) => object.def.hasTag(codex.tagNames.getId('item')));
    expect(cargo, 'シナリオが筏に積荷を載せている').toBeDefined();

    expect(zone.slotForPutIn(cargo!), '手で置く先が無い').toBeUndefined();

    // こぼれ落ちる経路（spawnの行き先が塞がったとき、9.4節）でも海面には残らない。海区が受け取らず、
    // その上のworldも物を受け取らないので、その物は手に入らないまま失われる（12.7節）。
    cargo!.spillTo(zone);
    expect(
      zone.findSelfOrDescendantByInstanceId(cargo!.instanceId),
      'こぼれても海面には残らない',
    ).toBeUndefined();
  });

  it('時間を進めるだけでは1海区も進まない', () => {
    // **確定した仕様（GameEndings.md 12節）そのもの。** 漂っているだけでは航路も現れず、
    // 次の海区へも移らない——進みを運ぶのは時間ではなく見張りと横断という行為。
    //
    // **荒天だけが例外**（同12.4節）なので、天気を据えて外しておく——進みを運ばないことと、
    // 荒天が位置を動かすことは別の話で、混ざると片方の検査にならない。
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    const first = singletonPlace(game, 'coastal_waters');

    holdWeather(game, 'clear', 'tailwind');
    for (let i = 0; i < 96; i++) tick(game);

    expect(raft.parent?.def.name, '丸1日流されても最初の海区に居る').toBe('coastal_waters');
    expect(
      sightedRoutes(first).map((route) => route.def.name),
      '次の海区への航路も現れない（出航が立てた帰り道だけが在る）',
    ).toEqual(['route_to_shore']);
    expect(propertyOf(first, 'exploration_progress'), '見張っていないので進捗も動かない').toBe(0);
  });

  it('見張りを続けると航路が現れ、渡ると別の海区に居る', () => {
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    const first = singletonPlace(game, 'coastal_waters');

    expect(keepWatch(game, first), '1回目の見張り').toBe(true);
    expect(
      sightedRoutes(first).map((fixture) => fixture.def.name),
      '1回では次の海区への航路は見えない',
    ).toEqual(['route_to_shore']);

    expect(keepWatch(game, first), '2回目の見張り').toBe(true);
    expect(
      sightedRoutes(first).map((fixture) => fixture.def.name),
      '2回目で海藻の帯への航路が、出航が立てた帰り道と並ぶ',
    ).toEqual(['route_to_shore', 'route_to_kelp_belt']);

    expect(cross(game, first, 'route_to_kelp_belt'), '渡れる').toBe(true);
    expect(raft.parent?.def.name, '次の海区へ移っている').toBe('kelp_belt');
    expect(game.player.location?.instance.instanceId, '乗り手は筏ごと渡る').toBe(raft.instanceId);
  });

  it('航路が現れた後も見張りは続けられ、同じ航路は2本目が湧かない', () => {
    // **待つことは、その海区を探索し続けること**（GameEndings.md 12.3節）。航路が1本見えても拾い物と
    // 魚の群れは続くので、見張りを打ち切ってはならない（同12.1節）。一方、上限へ達した進捗は書き込みの
    // たびにon_maxを呼び直すので、湧かせる側が「もう立っている」を見て自分で止まる必要がある。
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    const first = singletonPlace(game, 'coastal_waters');

    for (let i = 0; i < 10; i++) expect(keepWatch(game, first), `${i + 1}回目の見張り`).toBe(true);

    expect(
      sightedRoutes(first).map((route) => route.def.name),
      '上限を超えて見張り続けても、航路は進む先と戻る先が1本ずつ',
    ).toEqual(['route_to_shore', 'route_to_kelp_belt']);
    expect(
      sightedRoutes(singletonPlace(game, 'kelp_belt')).map((route) => route.def.name),
      '辺の向こう端も1本のまま',
    ).toEqual(['route_to_coastal_waters']);
    expect(propertyOf(first, 'exploration_progress'), '探索率は100%のまま張り付く（地上と同じ）').toBe(
      new Location(first, codex).explorationProgressMax,
    );
  });

  it('筏の無い海区からは渡れない', () => {
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    const first = singletonPlace(game, 'coastal_waters');
    keepWatch(game, first);
    keepWatch(game, first);

    // 筏だけを次の海区へ先に移す（乗り手は取り残される）。
    raft.moveToSlotOrRejection(singletonPlace(game, 'kelp_belt').getSlot(codex.slotNames.getId('fixtures')));

    expect(cross(game, first, 'route_to_kelp_belt'), '渡る手は成立しない').toBe(false);
  });

  it('引き返す航路は、進む航路と同じ型（航路は向きを持たない）', () => {
    // **島の側へ戻る航路に別の仕組みは無い**（GameEndings.md 12.5節）。航路が持つのは行き先だけなので、
    // 潮目から海藻の帯へ戻る航路は、島影の海が海藻の帯へ進むのに使うのとまったく同じ型になる。
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();

    for (const zoneName of ['coastal_waters', 'kelp_belt'])
      expect(watchAndCross(game, singletonPlace(game, zoneName)), `${zoneName} から進む`).toBe(true);
    for (let i = 0; i < 20 && keepWatch(game, singletonPlace(game, 'tide_rip')); i++);

    expect(
      sightedRoutes(singletonPlace(game, 'tide_rip')).map((route) => route.def.name),
      '潮目には、戻る先と進む先の航路が1本ずつ立つ',
    ).toEqual(['route_to_kelp_belt', 'route_to_reef_shallows']);
    expect(
      sightedRoutes(singletonPlace(game, 'coastal_waters')).map((route) => route.def.name),
      '島影の海が進む先に使う型と、潮目が戻る先に使う型は同じ',
    ).toContain('route_to_kelp_belt');
  });

  it('渡り着いたばかりの海区から、1回も見張らずに来た航路を戻れる', () => {
    // **確定した仕様（GameEndings.md 12.5節）そのもの。** 引き返しは航海のどこからでも選べ、代償は
    // 来た航路を戻るぶんの時間だけ——渡り着いた先で見張り（3〜5回＝45〜75分）を済ませるまで待つ、は
    // そこに無い。航路は辺なので、見つけた側の見張りが**両端へ1本ずつ**立てる（voyage.yaml）。
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    expect(watchAndCross(game, singletonPlace(game, 'coastal_waters')), '島影の海から渡る').toBe(true);

    const arrived = singletonPlace(game, 'kelp_belt');
    expect(raft.parent?.instanceId, '海藻の帯へ渡り着いている').toBe(arrived.instanceId);
    expect(propertyOf(arrived, 'exploration_progress'), 'まだ1回も見張っていない').toBe(0);
    expect(
      sightedRoutes(arrived).map((route) => route.def.name),
      '渡り着いた海区には、来た航路が立っている',
    ).toEqual(['route_to_coastal_waters']);

    expect(cross(game, arrived, 'route_to_coastal_waters'), '見張らずに引き返せる').toBe(true);
    expect(raft.parent?.def.name, '来た海区へ戻っている').toBe('coastal_waters');
    expect(propertyOf(arrived, 'exploration_progress'), '戻るのに見張りは要らなかった').toBe(0);
  });

  it('渡り着いた先で見張っても、来た航路は二重にならない', () => {
    // 辺の両端を立てるのは**見つけた側の見張りだけ**。渡り着いた側の見張りも戻る航路を立てると、
    // 同じ航路が2本並ぶ。
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    expect(watchAndCross(game, singletonPlace(game, 'coastal_waters')), '島影の海から渡る').toBe(true);

    const arrived = singletonPlace(game, 'kelp_belt');
    expect(
      watchUntilSighted(game, arrived).map((route) => route.def.name),
      '見張りが立てるのは、次の海区への1本だけ',
    ).toEqual(['route_to_tide_rip']);
    expect(
      sightedRoutes(arrived).map((route) => route.def.name),
      '来た航路と進む航路が1本ずつ',
    ).toEqual(['route_to_coastal_waters', 'route_to_tide_rip']);
  });

  it('出航した直後、1回も見張らずに島へ引き返せる', () => {
    // **確定した仕様（GameEndings.md 12.5節）そのもの。** 引き返しは航海のどこからでも選べ、出航した
    // 直後もそこに含まれる。島と島影の海を繋ぐ辺を渡る手は見張りではなく出航なので、向こう端の航路
    // （route_to_shore）を立てるのも出航（voyage.yamlのset_sail）。
    const { game, raft } = ready();
    const departure = raft.parent!;
    expect(raft.tryGetAction('set_sail', game.player.instance)?.tryExecute(), '出航できる').toBe(true);

    const first = singletonPlace(game, 'coastal_waters');
    expect(propertyOf(first, 'exploration_progress'), 'まだ1回も見張っていない').toBe(0);
    expect(
      sightedRoutes(first).map((route) => route.def.name),
      '出航が島へ戻る航路を立てている',
    ).toEqual(['route_to_shore']);

    expect(cross(game, first, 'route_to_shore'), '見張らずに引き返せる').toBe(true);
    expect(raft.parent?.instanceId, '出た海岸へ戻り着く').toBe(departure.instanceId);
    expect(propertyOf(first, 'exploration_progress'), '戻るのに見張りは要らなかった').toBe(0);
  });

  it('何度出航しても、島へ戻る航路は二重にならない', () => {
    // 出航は何度でもできるので、立てるだけでは周回のたびに積み上がる。**岸へ渡れば消える**
    // （voyage.yamlのroute_to_shore）ことが、島影の海に並ぶ本数を1本に保つ。
    const { game, raft } = ready();
    const first = singletonPlace(game, 'coastal_waters');
    const shoreRoutes = (): number =>
      sightedRoutes(first).filter((route) => route.def.name === 'route_to_shore').length;

    for (let voyage = 1; voyage <= 3; voyage++) {
      keepAlive(game);
      expect(raft.tryGetAction('set_sail', game.player.instance)?.tryExecute(), `${voyage}度目の出航`).toBe(
        true,
      );
      expect(shoreRoutes(), `${voyage}度目の出航でも、島へ戻る航路は1本`).toBe(1);

      // 1度目だけ島影の海を見張り切る（見張りが立てるのは進む先だけなので、帰り道は増えない）。
      if (voyage === 1) for (let i = 0; i < 20 && keepWatch(game, first); i++);

      expect(cross(game, first, 'route_to_shore'), `${voyage}度目の引き返し`).toBe(true);
      expect(shoreRoutes(), '岸へ戻れば、その航路は消える').toBe(0);
    }

    expect(
      sightedRoutes(first).map((route) => route.def.name),
      '残るのは見張りが立てた進む先だけ',
    ).toEqual(['route_to_kelp_belt']);
  });

  it('航海の途中から島へ引き返せて、積荷は1つも減らない', () => {
    // **確定した仕様（GameEndings.md 12.5節）そのもの。** 引き返しの代償は来た航路を戻るぶんの時間だけで、
    // 積荷を代償にしない。戻りに要るのは渡ってきた航路と同じ本数の横断で、**新しい見張りは1度も要らない**
    // ——一度航路を見定めた海区では、進む先と戻る先の両方が立ったままになる。
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();

    // 島影の海 → 海藻の帯 → 潮目。渡った航路は2本。
    for (const zoneName of ['coastal_waters', 'kelp_belt']) {
      keepAlive(game);
      expect(watchAndCross(game, singletonPlace(game, zoneName)), `${zoneName} から進む`).toBe(true);
    }
    for (let i = 0; i < 20 && keepWatch(game, singletonPlace(game, 'tide_rip')); i++);
    expect(raft.parent?.def.name, '外洋の海区に居る').toBe('tide_rip');

    const cargoBefore = cargoNames(raft);
    const progressBefore = ['kelp_belt', 'coastal_waters'].map((zoneName) =>
      propertyOf(singletonPlace(game, zoneName), 'exploration_progress'),
    );

    // 来た航路をそのまま戻り、最後に島の浜へ上がる（出航の1手と対になる横断）。
    const homeward: readonly (readonly [string, string])[] = [
      ['tide_rip', 'route_to_kelp_belt'],
      ['kelp_belt', 'route_to_coastal_waters'],
      ['coastal_waters', 'route_to_shore'],
    ];
    for (const [zoneName, routeName] of homeward) {
      keepAlive(game);
      expect(cross(game, singletonPlace(game, zoneName), routeName), `${zoneName} から戻る`).toBe(true);
    }

    expect(raft.parent?.def.hasTag(codex.tagNames.getId('coast')), '島の海岸へ戻り着く').toBe(true);
    expect(cargoNames(raft), '積荷は1つも減らない').toEqual(cargoBefore);
    expect(
      ['kelp_belt', 'coastal_waters'].map((zoneName) =>
        propertyOf(singletonPlace(game, zoneName), 'exploration_progress'),
      ),
      '戻り道の海区を見張り直してはいない',
    ).toEqual(progressBefore);
    expect(
      raft.tryGetAction('disembark', game.player.instance)?.tryExecute(),
      '戻りきれば筏から降りられる',
    ).toBe(true);
    expect(game.player.ending.kind, '島へ戻っただけなので周回は終わらない').not.toBe('escape');
  });

  /** 島の海岸すべて（世界の木を深さ優先で辿った順）。`to_object`が引くのはこの並びの先頭だった。 */
  function coasts(game: StartedGame): readonly WorldObject[] {
    const coastTag = codex.tagNames.getId('coast');
    return [...game.world.instance.descendants()].filter((object) => object.def.hasTag(coastTag));
  }

  /** 筏を乗り手ごとその海岸へ移す（出航前のしたく）。 */
  function beachRaftAt(game: StartedGame, raft: WorldObject, coast: WorldObject): void {
    expect(raft.moveToSlotOrRejection(coast.getSlot(codex.slotNames.getId('fixtures')))).toBeUndefined();
    expect(
      game.player.instance.moveToSlotOrRejection(coast.getSlot(codex.slotNames.getId('characters'))),
    ).toBeUndefined();
  }

  /** その海岸から出航する。**筏が立った海区**を返す（海岸ごとに違う、OFFSHORE）。 */
  function sailFrom(game: StartedGame, raft: WorldObject, coast: WorldObject): WorldObject {
    beachRaftAt(game, raft, coast);
    expect(raft.tryGetAction('set_sail', game.player.instance)?.tryExecute(), '出航できる').toBe(true);
    return raft.parent!;
  }

  /** その海岸から出航し、立った海区を見張って、島へ戻る航路を渡る。着いた場所を返す。 */
  function sailAndTurnBack(game: StartedGame, raft: WorldObject, coast: WorldObject): WorldObject {
    const first = sailFrom(game, raft, coast);
    for (let i = 0; i < 20 && keepWatch(game, first); i++);
    expect(cross(game, first, 'route_to_shore'), '島へ引き返せる').toBe(true);
    return raft.parent!;
  }

  it('どの海岸から漕ぎ出したかで、最初に立つ海区が変わる', () => {
    // **地点差を持たせる仕組みは無い**（GameEndings.md 5節）。海岸ごとに違うのは面している海区だけで、
    // 距離（本土までの残り海区数）も危険度（通ることになる海区の顔ぶれ）もそこからの帰結になる。
    const coastNames = [...new Set(coasts(ready().game).map((coast) => coast.def.name))];
    expect(coastNames.length, 'シード3の島には2種類以上の海岸がある').toBeGreaterThan(1);

    const reached = new Set<string>();
    for (const coastName of coastNames) {
      const { game, raft } = ready();
      const departure = coasts(game).find((coast) => coast.def.name === coastName)!;
      const first = sailFrom(game, raft, departure).def.name;
      expect(first, `${coastName} が面している海区`).toBe(OFFSHORE.get(coastName));
      reached.add(first);
    }

    expect(reached.size, '海岸が違えば立つ海区も違う').toBe(coastNames.length);
  });

  it('海岸はどれも、面した海区をちょうど1つ名乗る', () => {
    // **名乗らない海岸は、どこにも赤を出さないまま「どこから出ても同じ」に戻る。** 出航の卓は重みが
    // 全部0になると先頭の候補を選ぶ（PickEffect）ので、島影の海へ黙って流れるだけになる。
    const { game } = ready();
    const coastTag = codex.tagNames.getId('coast');
    const offshoreOf = (defName: string): readonly string[] => {
      const def = codex.objects.get(codex.objectNames.getId(defName));
      const instance = game.session.createObject(def.globalId);
      return def
        .enumeratePropertyDefs()
        .filter((property) => property.name.startsWith(OFFSHORE_PREFIX))
        .filter((property) => propertyOf(instance, property.name) > 0)
        .map((property) => property.name.slice(OFFSHORE_PREFIX.length));
    };

    const coastDefs: string[] = [];
    for (let id = 0; id < codex.objects.count; id++) {
      const def = codex.objects.tryGet(id);
      if (def?.tags.includes(coastTag) === true) coastDefs.push(def.name);
    }

    expect(coastDefs.sort(), '海岸の型は表と過不足なく対応する').toEqual([...OFFSHORE.keys()].sort());
    for (const coastName of coastDefs)
      expect(offshoreOf(coastName), `${coastName} が面している海区`).toEqual([OFFSHORE.get(coastName)]);
  });

  it('出航地点が変われば、本土まで渡る海区の数も変わる', () => {
    // **これが「地点によって航海の距離が変わる」そのもの**（GameEndings.md 5節）。距離は地点が持つ
    // パラメータではなく、そこから鎖のどこへ繋がるかの帰結として出る。
    const zoneCountFrom = (coastName: string): number => {
      const { game, raft } = ready();
      sailFrom(
        game,
        raft,
        coasts(game).find((coast) => coast.def.name === coastName)!,
      );
      return voyageToMainland(game, raft).length;
    };

    expect(zoneCountFrom('sandy_beach'), '砂浜からは最短で12の海区を渡る').toBe(12);
    expect(zoneCountFrom('rocky_coast'), '岩だらけの海岸からは10の海区で済む').toBe(10);
  });

  it('引き返して着くのは、出航したその海岸', () => {
    // **島で最初の砂浜ではない。** 行き先を型で指していた頃は、どの海岸から出ても木を深さ優先で
    // 辿った最初の砂浜へ着いていた——積んだ物を降ろす場所と拠点がずれる。
    const { game, raft } = ready();
    const beaches = coasts(game).filter((coast) => coast.def.name === 'sandy_beach');
    expect(beaches.length, 'シード3の島には砂浜が複数ある').toBeGreaterThan(1);

    const departure = beaches[beaches.length - 1];
    expect(sailAndTurnBack(game, raft, departure).instanceId, '出た砂浜へ戻り着く').toBe(
      departure.instanceId,
    );
  });

  it('砂浜でない海岸から出ても、その海岸へ戻れる', () => {
    // 出航は `{tag: coast}` なので岩の海岸からもできる。**砂浜が1つも無い島（60シードに1つ）でも
    // 戻れる**のは、行き先が砂浜という型ではなく、出た当の海岸だから。
    const { game, raft } = ready();
    const departure = coasts(game).find((coast) => coast.def.name !== 'sandy_beach');
    expect(departure, 'シード3の島に砂浜でない海岸がある').toBeDefined();

    const arrival = sailAndTurnBack(game, raft, departure!);
    expect(arrival.instanceId, '出た岩の海岸へ戻り着く').toBe(departure!.instanceId);
    expect(arrival.def.name, '砂浜へ引き寄せられてはいない').not.toBe('sandy_beach');
  });

  /** 帆を1枚作って、筏の構造スロットへ組み込む。 */
  function rigSail(game: StartedGame, raft: WorldObject): WorldObject {
    const sail = game.session.createObject(codex.objectNames.getId('rawhide_sail'));
    const failure = sail.moveToSlotOrRejection(raft.getSlot(codex.slotNames.getId('structure')));
    if (failure !== undefined) throw new Error(`帆を組み込めません: ${failure}`);
    return sail;
  }

  it('帆は浮いている間だけ効く（浜に置いたままでは立たない）', () => {
    const { game, raft } = ready();
    rigSail(game, raft);
    setWind(game, 'tailwind');

    tick(game);

    // **帆に条件を付けないとここが2になり、陸に繋いだままの筏が横断時間を縮め始める。**
    expect(propertyOf(raft, 'sail_speed'), '浜では帆も効かない').toBe(0);
  });

  it('帆を張ると、渡る速さの段が1つ上がる', () => {
    // **積荷は降ろす。** 出航のしたくの積荷（ヤシの実70個）とプレイヤーの体重では段がheavyまで
    // 落ちていて、帆を張っても下限0に張り付いたまま差が出ない。
    const afloatWith = (withSail: boolean): { speed: number; crossing: number } => {
      const { game, raft } = ready();
      if (withSail) rigSail(game, raft);
      raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
      for (const cargo of [...raft.children()]) {
        if (cargo !== game.player.instance && cargo.def.name !== 'rawhide_sail') cargo.destroy();
      }
      tick(game);
      return {
        speed: propertyOf(raft, 'sail_speed'),
        crossing: propertyOf(singletonPlace(game, 'coastal_waters'), 'crossing_minutes'),
      };
    };

    // **風はもう速さに入らない**（GameEndings.md 12.3節）ので、素の筏に効くのは海流の+3だけ。
    const bare = afloatWith(false);
    const rigged = afloatWith(true);
    expect(bare.speed, '素の筏は海流だけで進む').toBe(3);
    expect(rigged.speed, '帆の寄与は2').toBe(5);
    // 2という値の意味は、段がちょうど1つ上がること（slow→moderate。段が引く量は30分刻み）。
    expect(bare.crossing - rigged.crossing, '段が1つ上がるぶん短く渡れる').toBe(30);
  });

  it('陸に居る間は、渡る速さが立たない（海流も帆も効かない）', () => {
    const { game, raft } = ready();
    rigSail(game, raft);

    tick(game);

    expect(propertyOf(raft, 'sail_speed'), '陸の上では速さが立たない').toBe(0);
  });

  /**
   * 出航して最初の海区（島影の海）を見張り切り、**そこに並ぶ航路それぞれが今いくらで渡れるか**を返す。
   * 並ぶのは2本——本土へ進む `route_to_kelp_belt` と、島へ戻る `route_to_shore`（出航が立てる）。
   */
  function crossingMinutesAtFirstZone(wind: string): ReadonlyMap<string, number> {
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    // 積載の効きは別の検査で見るので、ここでは降ろして風だけを残す。
    for (const cargo of [...raft.children()]) {
      if (cargo !== game.player.instance) cargo.destroy();
    }

    const zone = singletonPlace(game, 'coastal_waters');
    watchUntilSighted(game, zone);
    setWind(game, wind);
    tick(game);

    return new Map(
      sightedRoutes(zone).map((route) => [route.def.name, propertyOf(route, 'crossing_minutes')]),
    );
  }

  it('風向きが、その航路を渡るのにかかる時間を決める（追い風＜横風＜向かい風）', () => {
    const onward = (wind: string): number => crossingMinutesAtFirstZone(wind).get('route_to_kelp_belt') ?? 0;

    expect(onward('tailwind'), '追い風なら最も短く渡れる').toBeLessThan(onward('crosswind'));
    expect(onward('crosswind'), '横風でも向かい風よりは短い').toBeLessThan(onward('headwind'));
  });

  it('同じ辺を逆に渡れば、追い風は向かい風になる', () => {
    // **行きが順調だったぶんだけ戻りが高くつく**（GameEndings.md 12.5節）。島影の海に並ぶ2本
    // ——本土へ進む航路と島へ戻る航路——は、同じ風を反対から受ける。
    const tail = crossingMinutesAtFirstZone('tailwind');
    expect(tail.get('route_to_kelp_belt'), '追い風では進むほうが短い').toBeLessThan(
      tail.get('route_to_shore') as number,
    );

    const head = crossingMinutesAtFirstZone('headwind');
    expect(head.get('route_to_shore'), '向かい風では戻るほうが短い').toBeLessThan(
      head.get('route_to_kelp_belt') as number,
    );
  });

  it('横断にかかる時間は漕ぎ出すときに読み切る（途中で風が変わっても伸び縮みしない）', () => {
    // **選んだ時点で結果が確定するので、針路の判断が博打にならない**（GameEndings.md 12.3節・
    // Voyage.md 3.2節）。渡り終える前に必ず風が変わるようにして、経過した時間が漕ぎ出す前に
    // 読んだ値と一致することを見る。
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();

    const zone = singletonPlace(game, 'coastal_waters');
    watchUntilSighted(game, zone);
    setWind(game, 'headwind');
    tick(game);

    const route = sightedRoutes(zone).find((fixture) => fixture.def.name === 'route_to_kelp_belt');
    expect(route, '進む航路が立っている').toBeDefined();
    const expected = propertyOf(route!, 'crossing_minutes');

    // 次のtickで風を引き直させ、引き直しが追い風になるようにする（重みは実効値なので、素の値を
    // 大きくすれば季節の配る重みごと押し切れる）。
    const world = game.world.instance;
    world.getProperty(codex.propertyNames.getId('wind_remaining')).setNumberWithoutEvents(1);
    world.getProperty(codex.propertyNames.getId('tailwind_weight')).setNumberWithoutEvents(100000);

    const departedAt = game.world.totalMinutes;
    expect(route!.tryGetAction('cross', game.player.instance)?.tryExecute(), '渡れる').toBe(true);

    expect(propertyOf(world, 'wind'), '渡っている最中に風が変わった').not.toBe(
      codex.symbolNames.getId('headwind'),
    );
    expect(game.world.totalMinutes - departedAt, '向かい風のまま読み切った時間で渡り終える').toBe(expected);
  });

  /** 荒天を据える（holdWeather）。 */
  function setStorm(game: StartedGame, wind: string): void {
    holdWeather(game, 'storm', wind);
  }

  /**
   * 荒天の中で、押し流されるまで海区に留まる。押し流されるまでのtick数（`limit` 以内に動かなければ
   * undefined）を返す。**見張りも渡りもしない**——動かすのが行為ではなく荒天であることを見るため。
   */
  function ticksUntilSwept(game: StartedGame, raft: WorldObject, limit = 60): number | undefined {
    const from = raft.parent;
    for (let elapsed = 1; elapsed <= limit; elapsed++) {
      keepAlive(game);
      tick(game);
      if (raft.parent !== from) return elapsed;
    }
    return undefined;
  }

  /** 見張って渡ることを繰り返し、名指しした海区まで進む。 */
  function sailTo(game: StartedGame, raft: WorldObject, zoneName: string): void {
    for (let i = 0; i < 20 && raft.parent?.def.name !== zoneName; i++) {
      keepAlive(game);
      expect(watchAndCross(game, raft.parent!), `${raft.parent!.def.name} から渡れる`).toBe(true);
    }
    expect(raft.parent?.def.name, `${zoneName} まで来た`).toBe(zoneName);
  }

  it('荒天の中で海区に留まり続けると、追い風では本土の側の海区へ押し流される', () => {
    // **荒天は進みを止めるのではなく押し流す**（GameEndings.md 12.4節）。罰が時間の損ではなく位置の
    // 変化になるので、止められて手が無くなるのではなく、盤面を組み直すことになる。
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    setStorm(game, 'tailwind');

    expect(ticksUntilSwept(game, raft), '押し流される').toBeDefined();
    expect(raft.parent?.def.name, '風下＝本土の側の隣の海区へ移る').toBe('kelp_belt');
    expect(game.player.location?.instance.instanceId, '乗り手は筏ごと流される').toBe(raft.instanceId);
  });

  it('向かい風の荒天では、島の側の海区へ押し流される', () => {
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    sailTo(game, raft, 'kelp_belt');
    setStorm(game, 'headwind');

    expect(ticksUntilSwept(game, raft), '押し流される').toBeDefined();
    expect(raft.parent?.def.name, '風下＝島の側の隣の海区へ移る').toBe('coastal_waters');
  });

  it('横風の荒天では押し流されない（横風の風下に、辺で繋がった海区が無い）', () => {
    // 分岐が入っても、辺で繋がった隣はどれも本土の側か島の側のどちらか（voyage.yaml）。分かれ道で
    // 隣が2つになるのは「本土の側が2つ」であって、横風の行き先ができたわけではない。
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    setStorm(game, 'crosswind');

    expect(ticksUntilSwept(game, raft), '流されないまま留まる').toBeUndefined();
    expect(raft.parent?.def.name, '出た海区に居る').toBe('coastal_waters');
  });

  it('島側の端では、向かい風の荒天でも岸へ乗り上げない', () => {
    // **押し流す先は隣の海区だけ。** 島影の海の風下（島の側）に海区は無いので、荒天が筏を岸へ
    // 戻すことはない——引き返すのは来た航路を渡ることそのもの（GameEndings.md 12.5節）。
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    setStorm(game, 'headwind');

    expect(ticksUntilSwept(game, raft), '島影の海から岸へは流されない').toBeUndefined();
    expect(raft.parent?.def.name, '島側の端に留まる').toBe('coastal_waters');
  });

  it('本土側の端では、追い風の荒天でも本土へ着かない', () => {
    // **到達は本土へ移ることそのもの**（Voyage.md 4節）なので、そこへ渡らせるのは航路であって
    // 荒天ではない。荒天で周回が終わることはない。
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    sailTo(game, raft, 'mainland_shallows');
    setStorm(game, 'tailwind');

    expect(ticksUntilSwept(game, raft), '本土の島影から本土へは流されない').toBeUndefined();
    expect(raft.parent?.def.name, '最後の海区に留まる').toBe('mainland_shallows');
  });

  it('押し流された先が未知の海区なら、そこが海図に入る', () => {
    // **記入するのは海区自身**（Voyage.md 3.7節）なので、渡って着いたか流されて着いたかを問わない。
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    const kelpBelt = singletonPlace(game, 'kelp_belt');
    expect(charted(kelpBelt), '流される前は幅を持ったまま').toEqual([6, 16]);

    setStorm(game, 'tailwind');
    expect(ticksUntilSwept(game, raft), '押し流される').toBeDefined();
    tick(game);

    expect(charted(kelpBelt), '流れ着いた海区も幅無しで海図に残る').toEqual([11, 11]);
  });

  it('海岸に繋いだ筏は、荒天でも流されない', () => {
    const { game, raft } = ready();
    const coast = raft.parent!;
    setStorm(game, 'tailwind');

    expect(ticksUntilSwept(game, raft), '浜に置いたままの筏は動かない').toBeUndefined();
    expect(raft.parent?.instanceId, '出航した海岸に在る').toBe(coast.instanceId);
  });

  it('岩礁の海は、他の海区より早く押し流される', () => {
    // ContentSkeleton.md 7節の表が岩礁に与えている役割（**荒天で押し流されやすい**）そのもの。
    const sweptIn = (zoneName: string): number | undefined => {
      const { game, raft } = ready();
      raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
      sailTo(game, raft, zoneName);
      setStorm(game, 'tailwind');
      return ticksUntilSwept(game, raft);
    };

    const reef = sweptIn('reef_shallows');
    const kelp = sweptIn('kelp_belt');
    expect(reef, '岩礁でも押し流される').toBeDefined();
    expect(kelp, '海藻の帯でも押し流される').toBeDefined();
    expect(reef!, '岩礁のほうが早い').toBeLessThan(kelp!);
  });

  it('据えた炉の中身も、乗員が手に持った物も、筏の重さに効く', () => {
    // 中身の重さは**直接の親へ**積み上がるので、間に居る物が重さを名乗っていないとそこで消える
    // （ContainerSystem.md 1節）。炉と乗員が名乗っていなかった頃は、荷物を手に持って乗るだけで
    // 積載が0になり、「積むほど遅い」（GameEndings.md 4節）を素通りできた。
    const { game, raft } = ready();
    // 出航すると乗員は筏の中へ入る（この検査が見たいのはそこから先）。
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    const weightOfRaft = (): number => propertyOf(raft, 'weight');
    const put = (objectName: string, into: WorldObject, slotName: string): WorldObject => {
      const spawned = game.session.createObject(codex.objectNames.getId(objectName));
      expect(spawned.moveToSlotOrRejection(into.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
      return spawned;
    };

    const beforeHearth = weightOfRaft();
    const hearth = put('campfire', raft, 'fixtures');
    put('roasted_meat', hearth, 'fire');
    expect(weightOfRaft() - beforeHearth, '炉とその中身のぶん重くなる').toBe(propertyOf(hearth, 'weight'));

    const beforeCarrying = weightOfRaft();
    const log = put('log', game.player.instance, 'hand');
    expect(weightOfRaft() - beforeCarrying, '手に持った丸太のぶん重くなる').toBe(propertyOf(log, 'weight'));
  });

  it('積荷が重いほど横断が長い（捨てれば短くなる）', () => {
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    setWind(game, 'crosswind');
    const zone = singletonPlace(game, 'coastal_waters');

    // **段をまたぐまで積む。** 出航のしたくの積荷（ヤシの実70個）だけでは段がladen止まりで、
    // 横風では帆の寄与と同じ段に収まってしまい、捨てても盤面に差が出ない。
    for (let i = 0; i < 4; i++) {
      game.session
        .createObject(codex.objectNames.getId('log'))
        .moveToSlotOrRejection(raft.getSlot(codex.slotNames.getId('items')));
    }
    const laden = propertyOf(zone, 'crossing_minutes');

    // 積荷を海へ捨てる（筏から出せば、そのぶん軽くなる）。
    for (const cargo of [...raft.children()]) {
      if (cargo !== game.player.instance) cargo.destroy();
    }
    const empty = propertyOf(zone, 'crossing_minutes');

    expect(empty, '軽くなれば短く渡れる').toBeLessThan(laden);
  });

  /** 銛を1本、乗り手の手に持たせる。 */
  function giveHarpoon(game: StartedGame): WorldObject {
    const harpoon = game.session.createObject(codex.objectNames.getId('fishing_harpoon'));
    const failure = harpoon.moveToSlotOrRejection(
      game.player.instance.getSlot(codex.slotNames.getId('hand')),
    );
    if (failure !== undefined) throw new Error(`銛を持てません: ${failure}`);
    return harpoon;
  }

  /** その海区に魚の群れを1つ立てる（見張りの卓を引き当てるのを待たずに、突く相手だけを置く）。 */
  function raiseShoal(game: StartedGame, zone: WorldObject): WorldObject {
    const shoal = game.session.createObject(codex.objectNames.getId('fish_shoal'));
    expect(shoal.moveToSlotOrRejection(zone.getSlot(codex.slotNames.getId('fixtures')))).toBeUndefined();
    return shoal;
  }

  /**
   * 銛で`tries`回突いて、**返った生肉の数と銛を失った回数**を数える。突く相手が違うだけの同じ手順で
   * 群れと海面の両方を数える——見たいのは当たりの落差そのもの（Voyage.md 3.9.2節）。
   *
   * 銛は失うたびに持ち直し、群れは立ち去りまでの残りを毎回戻して留める。数えたいのは1回あたりの
   * 当たりなので、銛の在庫も群れの寿命も混ぜない。獲れた生肉はその場で捨てる——手も積荷も詰まると、
   * 湧いた生肉が黙って手に入らなくなる（`into: agent`、9.4節）。
   */
  function spearRepeatedly(target: 'shoal' | 'sea', tries: number): { meat: number; lost: number } {
    const { game, raft } = ready();
    // 荒天で押し流されると、立てた群れと筏の居る海区がずれる。見たいのは卓だけなので天気を止める。
    holdWeather(game, 'clear', 'crosswind');
    expect(raft.tryGetAction('set_sail', game.player.instance)?.tryExecute()).toBe(true);
    // 出航のしたくの積荷（ヤシの実70個）を降ろす。枠が空いていないと獲れた生肉が置けない。
    for (const cargo of [...raft.children()]) {
      if (cargo !== game.player.instance) cargo.destroy();
    }

    let harpoon = giveHarpoon(game);
    let shoal: WorldObject | undefined;
    let meat = 0;
    let lost = 0;

    for (let i = 0; i < tries; i++) {
      keepAlive(game);
      if (harpoon.parent === undefined) harpoon = giveHarpoon(game);
      if (target === 'shoal') {
        shoal ??= raiseShoal(game, raft.parent!);
        // 突いている最中に群れが去ると、そのぶんが空振りとして数に混ざる（立ち去りは6時間、
        // 突くのは1回30分）。残りを毎回満たして、数えるのを卓だけにする。
        const staying = shoal.getProperty(codex.propertyNames.getId('stay_remaining'));
        staying.setNumberWithoutEvents(staying.def.range?.max ?? 0);
      }

      const name = target === 'shoal' ? 'spear_shoal' : 'spear_sea';
      const spear = (target === 'shoal' ? shoal! : raft)
        .combinationsWith(harpoon, game.player.instance)
        .find((candidate) => candidate.name === name);
      expect(spear, `${name} が成立する`).toBeDefined();
      expect(spear?.tryExecute(), `${name} を突く`).toBe(true);

      if (harpoon.parent === undefined) lost++;
      for (const object of [...raft.descendants()]) {
        if (object.def.name === 'raw_meat') {
          meat++;
          object.destroy();
        }
      }
    }

    return { meat, lost };
  }

  it('魚を突くには銛が要る（手では獲れない）', () => {
    const { game, raft } = ready();
    expect(raft.tryGetAction('set_sail', game.player.instance)?.tryExecute()).toBe(true);
    const shoal = raiseShoal(game, raft.parent!);
    const branch = game.session.createObject(codex.objectNames.getId('thick_branch'));
    expect(
      branch.moveToSlotOrRejection(game.player.instance.getSlot(codex.slotNames.getId('hand'))),
    ).toBeUndefined();

    expect(
      shoal.tryGetAction('spear_shoal', game.player.instance),
      '道具なしで押せる手は無い',
    ).toBeUndefined();
    expect(shoal.combinationsWith(branch, game.player.instance), '銛でない物を当てても成立しない').toEqual(
      [],
    );
  });

  it('群れへ突くほうが、群れの居ない海面へ突くよりよく獲れる', () => {
    const tries = 120;
    const shoal = spearRepeatedly('shoal', tries);
    const sea = spearRepeatedly('sea', tries);

    // 30分に0.78切れと、60分に0.15切れ（Voyage.md 3.9.2節）。**この落差が「積むか釣るか」の判断を
    // 作っている**ので、見るのは平均ではなく差のほう。幅は試行回数ぶんの揺れ（標準誤差は0.04ほど）
    // より広く、卓の差（0.78/0.15）より狭く取る。
    expect(shoal.meat / tries, '群れは30分に0.78切れ').toBeGreaterThan(0.6);
    expect(sea.meat / tries, '群れの居ない海面は60分に0.15切れ').toBeLessThan(0.3);
  });

  it('突いた魚に銛を持って行かれることがある', () => {
    // 50回に1回（Voyage.md 3.9.4節）。**だから積むのは銛1本ではなく、穂先と紐の予備**になる。
    const tries = 200;
    const { lost } = spearRepeatedly('shoal', tries);

    expect(lost, '突き続ければ失う').toBeGreaterThan(0);
    expect(lost / tries, '失うのは稀（50回に1回）').toBeLessThan(0.1);
  });

  it('海へ突く手は、浮いている間だけ（浜に繋いだ筏では突けない）', () => {
    const { game, raft } = ready();
    const harpoon = giveHarpoon(game);
    const spears = (): string[] =>
      raft.combinationsWith(harpoon, game.player.instance).map((candidate) => candidate.name);

    // **条件を落とすと、浜に繋いだままの筏の下から魚が獲れる**（帆が浮いている間だけ効くのと同じ形）。
    expect(spears(), '浜では成立しない').not.toContain('spear_sea');

    expect(raft.tryGetAction('set_sail', game.player.instance)?.tryExecute()).toBe(true);
    tick(game);

    expect(spears(), '海の上でだけ突ける').toContain('spear_sea');
  });

  /**
   * その海区を繰り返し見張り、**手に入った物の名前・海区に湧いた物の名前・何かが返った割合**を返す。
   *
   * 見張りの進捗が上限へ達すると航路（と小島）が現れる。**ここで見たいのは卓のほうだけ**なので、
   * 毎回進捗を戻して上限へ届かせず、航路も小島も数に混ぜない。湧いた物は立ち去る（fish_shoalの
   * stay_remaining）ので、今そこに居るかではなく**居たことがあるか**を個体で数える。
   */
  function watchRepeatedly(
    zoneName: string,
    times: number,
  ): { picked: ReadonlySet<string>; spawned: ReadonlySet<string>; yieldRate: number } {
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    const zone = singletonPlace(game, zoneName);
    expect(raft.moveToSlotOrRejection(zone.getSlot(codex.slotNames.getId('fixtures')))).toBeUndefined();

    const seaRouteTag = codex.tagNames.getId('sea_route');
    // 出航のしたくの積荷（ヤシの実・聖杯）と乗り手は、見張りが返した物ではない。
    const cargoAtStart = new Set([...raft.descendants()].map((object) => object.instanceId));
    const spawned = new Map<number, string>();
    const picked = new Map<number, string>();
    let returned = 0;

    for (let i = 0; i < times; i++) {
      zone.getProperty(codex.propertyNames.getId('exploration_progress')).setNumberWithoutEvents(0);

      const before = picked.size + spawned.size;
      expect(keepWatch(game, zone), `${zoneName}: 見張りは成立する`).toBe(true);
      for (const fixture of new Location(zone, codex).fixtures)
        if (fixture !== raft && !fixture.def.hasTag(seaRouteTag))
          spawned.set(fixture.instanceId, fixture.def.name);
      for (const object of raft.descendants())
        if (!cargoAtStart.has(object.instanceId)) picked.set(object.instanceId, object.def.name);
      if (picked.size + spawned.size > before) returned++;
    }

    return {
      picked: new Set(picked.values()),
      spawned: new Set(spawned.values()),
      yieldRate: returned / times,
    };
  }

  it('島から本土まで、8種類の顔ぶれから配った十数個の海区の網を渡る', () => {
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();

    const visited = voyageToMainland(game, raft);

    expect(raft.parent?.def.name, '網を辿り切れば本土に着く').toBe('mainland');
    // **盤面の海区は十数個（14個）で、最短の経路がそのうち12個を通る**（残り2つは遠回りの側、
    // GameEndings.md 12節）。近道を選んでも、8種類の顔ぶれはすべて道中に出る。
    expect(SEA_CHART.zones.length, '盤面の海区は十数個').toBe(14);
    expect(visited.length, '最短の経路が通るのは12個').toBe(12);
    expect(new Set(visited).size, '同じ海区は二度通らない').toBe(visited.length);
    for (const [face, zones] of FACES)
      expect(
        zones.some((zoneName) => visited.includes(zoneName)),
        `${face} を通る`,
      ).toBe(true);
    const known = new Set([...FACES.values()].flat());
    expect(
      visited.filter((zoneName) => !known.has(zoneName)),
      '顔ぶれの分からない海区は無い',
    ).toEqual([]);
  });

  it('分かれ道では航路が2本現れ、どちらを渡っても本土へ着く', () => {
    // **針路の選択（GameEndings.md 12.3節）が盤面に出ているか。** 同じ海区から本土へ向かう経路が
    // 2つあり、通る海区の数が違い、**どちらも行き止まりにならない**ことを、実データで確かめる。
    const beyondFork = (routeName: string): readonly string[] => {
      const { game, raft } = ready();
      raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
      sailTo(game, raft, FORK);

      const fork = singletonPlace(game, FORK);
      expect(
        watchUntilSighted(game, fork)
          .map((route) => route.def.name)
          .sort(),
        '見張り切ると、進む先の航路が2本とも現れる',
      ).toEqual([DETOUR_ONWARD, SHORTCUT_ONWARD].sort());

      keepAlive(game);
      expect(cross(game, fork, routeName), `${routeName} を渡る`).toBe(true);
      const beyond = voyageToMainland(game, raft);
      expect(raft.parent?.def.name, `${routeName} を選んでも本土に着く`).toBe('mainland');
      return beyond;
    };

    const shortcut = beyondFork(SHORTCUT_ONWARD);
    const detour = beyondFork(DETOUR_ONWARD);

    expect(shortcut, '近道は3区間で本土へ出る').toEqual(['drifting_kelp', 'white_rock', 'mainland_shallows']);
    expect(detour, '遠回りは5区間').toEqual([
      'outer_tide_rip',
      'black_reef',
      'drifting_kelp',
      'white_rock',
      'mainland_shallows',
    ]);
  });

  /**
   * 分かれ道まで進み、見張り切って2本の航路を出したうえで風を据え、**そこに並ぶ航路それぞれが
   * 今いくらで渡れるか**を返す。
   */
  function crossingMinutesAtFork(wind: string): ReadonlyMap<string, number> {
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    sailTo(game, raft, FORK);

    const fork = singletonPlace(game, FORK);
    watchUntilSighted(game, fork);
    setWind(game, wind);
    tick(game);

    return new Map(
      sightedRoutes(fork).map((route) => [route.def.name, propertyOf(route, 'crossing_minutes')]),
    );
  }

  it('分かれ道では、風向きによってどちらの航路が短く渡れるかが入れ替わる', () => {
    // **GameEndings.md 12.3節（確定）の眼目。**「遠回りだが今なら短く渡れる航路」と「最短だが今は
    // 長くかかる航路」が、同じ海区の盤面へ**同時に**出ること。近道は本土へ真っ直ぐ向かう辺、遠回りは
    // 一度沖へ出る辺なので、同じ風でも受け方が分かれる（Voyage.md 3.2節）。
    const head = crossingMinutesAtFork('headwind');
    expect(head.get(DETOUR_ONWARD), '向かい風では遠回りのほうが短く渡れる').toBeLessThan(
      head.get(SHORTCUT_ONWARD) as number,
    );

    const tail = crossingMinutesAtFork('tailwind');
    expect(tail.get(SHORTCUT_ONWARD), '追い風では近道のほうが短く渡れる').toBeLessThan(
      tail.get(DETOUR_ONWARD) as number,
    );
  });

  it('近道が飛ばす2区間は、どちらも見張りが何かを返す海区', () => {
    // **「最短の航路が最も実りが薄い」**（GameEndings.md 12.1節）。近道は独自の海区を持たず、遠回りが
    // 通る海区のうち2つを飛ばすだけ——飛ばす相手が何も返さない海区なら、近道は損をしない。
    const { game } = ready();
    const skipped = ['outer_tide_rip', 'black_reef'];

    for (const zoneName of skipped) {
      const zone = singletonPlace(game, zoneName);
      // 素の重みの合計に対するハズレの割合が、そのまま「何も返さない見張り」の割合（Voyage.md 3.3節）。
      const total = KNOBS.reduce((sum, knob) => sum + propertyOf(zone, knob), 0);
      expect(total, `${zoneName}: 見張りの卓がある`).toBeGreaterThan(0);
      expect(propertyOf(zone, 'barren_find') / total, `${zoneName}: ハズレばかりではない`).toBeLessThan(0.5);
    }
  });

  it('同じ顔ぶれの海区は、同じつまみの配り方を持つ', () => {
    // **顔ぶれは型でもタグでもなく、つまみの配り方そのもの**（voyage.yamlのsea_zone）。同じ顔ぶれの
    // 海区が別の配り方を持ち始めたら、それは表に無い9種類目ができたということ。
    const { game } = ready();
    const knobsOf = (zoneName: string): string =>
      KNOBS.map((knob) =>
        propertyOf(game.session.createObject(codex.objectNames.getId(zoneName)), knob),
      ).join('/');

    for (const [face, zones] of FACES)
      expect(new Set(zones.map(knobsOf)).size, `${face} の海区は同じ配り方`).toBe(1);
  });

  it.each(YIELDS)(
    '%s の見張りは、その海区の顔ぶれのものだけを返す',
    (zoneName, pickable, spawnable, low, high) => {
      const watched = watchRepeatedly(zoneName, WATCHES);

      expect([...watched.picked].sort(), `${zoneName}: 拾えるもの`).toEqual([...pickable].sort());
      expect([...watched.spawned].sort(), `${zoneName}: 湧くもの`).toEqual([...spawnable].sort());
      expect(watched.yieldRate, `${zoneName}: 実りの濃さ`).toBeGreaterThanOrEqual(low);
      expect(watched.yieldRate, `${zoneName}: 実りの濃さ`).toBeLessThanOrEqual(high);
    },
  );

  it('小島は、降りて探索でき、漕ぎ出せば海へ戻る', () => {
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    const zone = singletonPlace(game, 'islet_waters');
    expect(raft.moveToSlotOrRejection(zone.getSlot(codex.slotNames.getId('fixtures')))).toBeUndefined();

    for (let i = 0; i < 20 && keepWatch(game, zone); i++);
    const islet = new Location(zone, codex).fixtures.find((fixture) => fixture.def.name === 'offshore_islet');
    expect(islet, '見張りを終えると、航路と一緒に小島が見つかる').toBeDefined();

    makeBrightEnoughForAnyAction(game.player.instance, codex);
    expect(
      islet!.tryGetAction('explore', game.player.instance)?.tryExecute(),
      '筏に乗ったままでは調べられない',
    ).toBe(false);

    expect(islet!.tryGetAction('land', game.player.instance)?.tryExecute(), '上陸できる').toBe(true);
    expect(raft.parent?.instanceId, '筏ごと小島へ寄る').toBe(islet!.instanceId);
    expect(raft.tryGetAction('disembark', game.player.instance)?.tryExecute(), '小島へは降りられる').toBe(
      true,
    );

    makeBrightEnoughForAnyAction(game.player.instance, codex);
    expect(new Location(islet!, codex).explore(game.player.instance), '降りれば探索できる').toBe(true);

    expect(islet!.tryGetAction('launch', game.player.instance)?.tryExecute(), '漕ぎ出せる').toBe(true);
    expect(raft.parent?.instanceId, '筏は海区へ戻る').toBe(zone.instanceId);
    expect(game.player.location?.instance.instanceId, '乗り手も乗り込んで戻る').toBe(raft.instanceId);
  });

  /** その海区に立っている小島（見張りを終えていなければundefined）。 */
  function isletIn(zone: WorldObject): WorldObject | undefined {
    return new Location(zone, codex).fixtures.find((fixture) => fixture.def.name === 'offshore_islet');
  }

  it('小島が立つのは、小島の海と海鳥の岩だけ', () => {
    // **小島は顔ぶれの一部**（ContentSkeleton.md 7節）。どの海区に立つかを持つのは on_max の spawn
    // だけなので、顔ぶれの表とずれても他のどの検査も赤くならない。
    const found: string[] = [];
    for (const zoneName of [...FACES.values()].flat()) {
      const { game, raft } = ready();
      raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
      const zone = singletonPlace(game, zoneName);
      expect(raft.moveToSlotOrRejection(zone.getSlot(codex.slotNames.getId('fixtures')))).toBeUndefined();

      for (let i = 0; i < 20 && keepWatch(game, zone); i++);
      if (isletIn(zone) !== undefined) found.push(zoneName);
    }

    expect(found.sort(), '小島を伴う海区').toEqual([...ISLET_ZONES].sort());
  });

  /**
   * 小島を、名指しした物が見つかるまで歩く。見つけた1個を返す。
   *
   * **回数に上限を置く。** 錫は6回に1回ほど返る候補（voyage.yamlのoffshore_islet）なので素の宣言では
   * すぐ見つかるが、卓から落ちたときに赤くなる代わりに止まらなくなるのでは、この検査が何も言わない。
   */
  function exploreIsletFor(game: StartedGame, islet: WorldObject, objectName: string): WorldObject {
    const ashore = new Location(islet, codex);
    for (let i = 0; i < 80; i++) {
      keepAlive(game);
      makeBrightEnoughForAnyAction(game.player.instance, codex);
      expect(ashore.explore(game.player.instance), '小島を歩ける').toBe(true);

      const found = ashore.items.find((item) => item.def.name === objectName);
      if (found !== undefined) return found;
    }
    throw new Error(`小島を80回歩いても ${objectName} が見つかりません。`);
  }

  it('中盤の沿岸航海——近い海区の小島で錫を採り、積んだまま出た海岸へ戻る', () => {
    // **最終航海より前に、戻ってこられる範囲の航海を経験する**（GameEndings.md 11節）。仕組みは
    // 最終航海と同じで、行き先が近いだけ——足したのは航海の側ではなく、渡った先で得られるもの
    // （錫は遠征先の小島にしか無い、ContentSkeleton.md 7.1節）。
    //
    // 砂浜から最寄りの小島（海鳥の岩）までは4区間。岸壁はその海区に面している（Voyage.md 3.6節）ので、
    // 岸壁から出れば1区間も渡らずに同じ小島へ着く。
    const { game, raft } = ready();
    const departure = raft.parent!;
    expect(raft.tryGetAction('set_sail', game.player.instance)?.tryExecute(), '出航できる').toBe(true);

    for (const zoneName of TO_NEAREST_ISLET) {
      keepAlive(game);
      expect(watchAndCross(game, singletonPlace(game, zoneName)), `${zoneName} から進む`).toBe(true);
    }

    const zone = singletonPlace(game, 'gull_rock');
    expect(raft.parent?.instanceId, '海鳥の岩へ渡り着いている').toBe(zone.instanceId);
    for (let i = 0; i < 20 && keepWatch(game, zone); i++);

    const islet = isletIn(zone);
    expect(islet, '見張りを終えると小島が見つかる').toBeDefined();
    expect(islet!.tryGetAction('land', game.player.instance)?.tryExecute(), '上陸できる').toBe(true);
    expect(raft.tryGetAction('disembark', game.player.instance)?.tryExecute(), '小島へ降りられる').toBe(true);

    const ore = exploreIsletFor(game, islet!, 'tin_ore');
    expect(
      ore.moveToSlotOrRejection(raft.getSlot(codex.slotNames.getId('items'))),
      '採った錫を筏へ積める',
    ).toBeUndefined();

    expect(islet!.tryGetAction('launch', game.player.instance)?.tryExecute(), '漕ぎ出せる').toBe(true);
    for (const [zoneName, routeName] of BACK_TO_SHORE) {
      keepAlive(game);
      expect(cross(game, singletonPlace(game, zoneName), routeName), `${zoneName} から戻る`).toBe(true);
    }

    expect(raft.parent?.instanceId, '出た海岸へ戻り着く').toBe(departure.instanceId);
    expect(cargoNames(raft), '錫は積んだまま').toContain('tin_ore');
    expect(game.player.ending.kind, '島へ戻っただけなので周回は終わらない').not.toBe('escape');
  });

  it('錫を湧かせるのは、小島の探索だけ', () => {
    // **「遠征先の小島にしかない」は、湧かせる場所が1つであること**（ContentSkeleton.md 7.1節）。
    // 見るのは spawn の側だけ——使い道（製錬・青銅の道具、同4節）が入れば錫を**要求する**定義は
    // 増えるが、それは出どころが増えたことではない。
    const owners: string[] = [];
    for (const path of worldCodexYamlPaths()) {
      const file: unknown = parse(readFileSync(path, 'utf8'));
      for (const [section, entries] of namedEntries(file))
        for (const [name, body] of namedEntries(entries))
          if (spawnedObjectNames(body).has('tin_ore')) owners.push(`${section}.${name}`);
    }

    expect(owners, '錫を湧かせる定義').toEqual(['object_defs.offshore_islet']);
  });

  /** 海図が今その海区について言っている「本土まであと何海区か」の下限と上限。 */
  function charted(zone: WorldObject): readonly [number, number] {
    return [propertyOf(zone, 'zones_to_mainland_min'), propertyOf(zone, 'zones_to_mainland_max')];
  }

  /** 世界に在る海区すべて（宣言順ではなく、世界の木を辿った順）。 */
  function seaZones(game: StartedGame): readonly WorldObject[] {
    const seaTag = codex.tagNames.getId('sea');
    return [...game.world.instance.descendants()].filter((object) => object.def.hasTag(seaTag));
  }

  /**
   * 島の山頂で `times` 回探索する。**探索率が上限へ達した後の1回ごとに、海図の一区画が埋まる**
   * （locations.yamlの山頂の on_max）。
   */
  function surveyFromPeak(game: StartedGame, times: number): void {
    const peak = game.map.sites.find((site) => site.type!.name === 'mountain_peak');
    expect(peak, 'シード3の島に山頂がある').toBeDefined();
    const summit = game.world.instance.findSelfOrDescendantByInstanceId(
      game.map.siteInstanceIds[peak!.index],
    )!;

    makeBrightEnoughForAnyAction(game.player.instance, codex);
    for (let i = 0; i < times; i++) {
      keepAlive(game);
      expect(new Location(summit, codex).explore(game.player.instance), '山頂を見渡せる').toBe(true);
    }
  }

  it('渡っていない海区は、幅を持って海図に載る', () => {
    // **海図が持つべき精度は本土までの残り海区数**（GameEndings.md 12.6節）。真値は海区の側の事実で、
    // 海図が言うのはその上下に幅を取った範囲——幅を狭めていくのが9.1節の段階になる。
    const { game } = ready();

    const zones = seaZones(game);
    expect(zones.length, '海区は14個').toBe(14);
    // **分岐があるので、1から14まで1つずつではない**——遠回りの2区間（沖の潮目5・黒い岩礁4）は、
    // 近道の側の同じ数（うねりの海4・沈船の海5）と並ぶ。何区間か言えるのは最短についてだけ。
    expect(
      zones.map((zone) => propertyOf(zone, 'zones_to_mainland')).sort((a, b) => a - b),
      '本土まで最短で何区間かが、海区ごとに立っている',
    ).toEqual([1, 2, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 11, 12]);

    for (const zone of zones) {
      const truth = propertyOf(zone, 'zones_to_mainland');
      expect(charted(zone), `${zone.def.name}: 方角しか分からない海区の幅`).toEqual([
        Math.max(0, truth - 5),
        truth + 5,
      ]);
    }
  });

  it('山頂から見渡すと、海図の幅が狭まる', () => {
    // **山頂へ登ることが9.1節の段階の1つ**（GameEndings.md 9.1節）。見渡した海区は幅が狭まるだけで、
    // 真値そのものは動かない——狭まっていくのは推定の幅（同12.6節）。
    const { game } = ready();
    const zones = seaZones(game);
    const truths = new Map(zones.map((zone) => [zone.def.name, propertyOf(zone, 'zones_to_mainland')]));
    const sightedNames = (): readonly string[] =>
      zones.filter((zone) => propertyOf(zone, 'chart_sighted') > 0).map((zone) => zone.def.name);

    // 探索率が上限（10回）へ達するまでは海図が動かない。**山頂に着いただけでは書けない。**
    surveyFromPeak(game, 9);
    expect(sightedNames(), '歩き尽くすまでは1区画も埋まらない').toEqual([]);

    // 上限へ達した1回と、その先の1回ごとに1区画。**同じ区画を見直すこともある**ので、14個が
    // 埋まるには回数が要る。
    surveyFromPeak(game, 1);
    expect(sightedNames(), '歩き尽くした1回で1区画が埋まる').toHaveLength(1);

    surveyFromPeak(game, 150);
    expect(sightedNames(), '見渡し続ければ海図が埋まる').toHaveLength(zones.length);
    for (const zone of zones) {
      const truth = truths.get(zone.def.name)!;
      expect(propertyOf(zone, 'chart_sighted'), `${zone.def.name}: 見定めた`).toBe(1);
      expect(propertyOf(zone, 'zones_to_mainland'), `${zone.def.name}: 真値は動かない`).toBe(truth);
      expect(charted(zone), `${zone.def.name}: 見定めた海区の幅`).toEqual([
        Math.max(0, truth - 2),
        truth + 2,
      ]);
    }
  });

  it('渡った海区は海図に残り、幅が無くなる', () => {
    // **沿岸航海で海に出るほど、最終航海の見通しが良くなる**（GameEndings.md 12.6節）。島へ引き返しても
    // 記入は残るので、次に出るときには渡ったぶんだけ海図が確かになっている。
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    tick(game);

    const first = singletonPlace(game, 'coastal_waters');
    expect(charted(first), '立った海区は幅無しで海図に残る').toEqual([12, 12]);
    expect(charted(singletonPlace(game, 'kelp_belt')), 'まだ渡っていない先は幅のまま').toEqual([6, 16]);

    keepAlive(game);
    expect(watchAndCross(game, first), '海藻の帯へ渡る').toBe(true);
    tick(game);
    expect(charted(singletonPlace(game, 'kelp_belt')), '渡り着いた海区も海図に残る').toEqual([11, 11]);

    // 引き返しても記入は消えない（海図は持ち帰る）。
    keepAlive(game);
    expect(cross(game, singletonPlace(game, 'kelp_belt'), 'route_to_coastal_waters'), '戻る').toBe(true);
    keepAlive(game);
    expect(cross(game, first, 'route_to_shore'), '島へ戻る').toBe(true);
    expect(charted(singletonPlace(game, 'kelp_belt')), '島へ戻っても記入は残る').toEqual([11, 11]);
  });

  it('海図が言う残り海区数は、実際に残っている海区の数と合う', () => {
    // **嘘を書かない海図であること。** 幅の中心（真値）が実際の鎖とずれていれば、狭めるほど確信を持って
    // 間違えることになる。渡り終えた海区は幅が無いので、そのまま実際の残り数と突き合わせられる。
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();

    const visited = voyageToMainland(game, raft);

    visited.forEach((zoneName, index) => {
      const remaining = visited.length - index;
      expect(charted(singletonPlace(game, zoneName)), `${zoneName}: 本土まであと${remaining}海区`).toEqual([
        remaining,
        remaining,
      ]);
    });
  });

  it('最後の海区から渡ると本土に着き、持ち帰った物ごと周回が終わる', () => {
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();

    expect(voyageToMainland(game, raft).length, '島から本土まで海区を渡り切る').toBeGreaterThan(0);

    expect(raft.parent?.def.name, '筏は本土に着く').toBe('mainland');
    expect(game.player.ending.kind, 'プレイヤーは島を出た').toBe('escape');
    // **数ではなく種類で見る。** 沈船の海でも同じ杯が拾えるので、道中で増えうる。
    expect([...new Set(game.player.ending.broughtArtifacts)], '積んでいたアーティファクトを持ち帰る').toEqual(
      ['golden_chalice'],
    );

    // 本土は鎖の端なので、折り返しの航路が立たない（着けば周回が終わり、そこから先も戻りも無い）。
    expect(sightedRoutes(singletonPlace(game, 'mainland')), '本土に航路は無い').toHaveLength(0);

    // 着いた後は風も海流も効かないので、速さは立たない（同じ到達が二度起きない）。
    tick(game);
    expect(propertyOf(raft, 'sail_speed'), '本土では速さが立たない').toBe(0);
    expect(raft.parent?.def.name, '本土に留まる').toBe('mainland');
  });

  it('海図が言う真値は、航路の辺から数えた最短の残り海区数', () => {
    // **海図の土台は海の側の事実**（Voyage.md 3.7節）で、事実とは辺の繋がり方そのもの。海区ごとに
    // 手で書いた数が航路の繋がりとずれれば、幅を狭めるほど確信を持って間違えることになる。
    //
    // **分岐が入ると、この数は隣どうしで1違うとは限らない**（遠回りの側の隣は自分より遠い）ので、
    // 隣を1つずつ突き合わせるのではなく、辺を辿った最短距離と突き合わせる。
    const chart = readSeaChart();
    expect(chart.zones.length, '海区は14個').toBe(14);

    for (const zone of chart.zones)
      expect(
        nodeAt(chart.bodies.get(zone), 'props', 'zones_to_mainland', 'value'),
        `${zone}: 本土まで最短で何区間か`,
      ).toBe(chart.distanceToMainland.get(zone));
  });

  it('航路が名乗る行き先の残り海区数は、行き先そのものが名乗る数と合う', () => {
    // **風の受け方は、この数と今いる海区の同じ数との差から出る**（voyage.yaml の sea_route）。行き先の
    // 型ごとに写した数なので、写し間違えれば、その航路だけが向きを取り違えたまま盤面に出る。
    const chart = readSeaChart();
    const declared = (routeName: string): unknown =>
      nodeAt(chart.routeBodies.get(routeName), 'props', 'destination_zones_to_mainland', 'value');
    const zoneDistance = (zoneName: string): number =>
      // 本土は海区ではないので zones_to_mainland を持たない。本土まで0海区はそのまま事実。
      (nodeAt(chart.bodies.get(zoneName), 'props', 'zones_to_mainland', 'value') as number | undefined) ?? 0;

    for (const [routeName, destination] of chart.routeDestinations)
      expect(declared(routeName), `${routeName}: 行き先（${destination}）までの残り海区数`).toBe(
        zoneDistance(destination),
      );

    // 島へ戻る航路だけは行き先が海区ではない。**島は鎖の外**なので、どの海区から見ても本土から
    // 遠い側でなければ、引き返しが追い風になってしまう。
    const farthest = Math.max(...chart.zones.map(zoneDistance));
    expect(declared('route_to_shore'), '島は鎖の島側の端より遠い').toBeGreaterThan(farthest);
  });

  it('行き先を型で持たない航路は、島へ戻る1本だけ', () => {
    // **渡す手は sea_route trait が1本だけ持ち、そこが引くのは `destination_zone`**（voyage.yaml）。
    // 名乗り忘れた航路は行き先を解決できず、渡っても何も起きない札になる——盤面には出るので、
    // 宣言の側で数え上げておく。島へ戻る1本だけは行き先が個体（筏が覚えている海岸）なので持たない。
    const chart = readSeaChart();
    const withoutDestination = [...chart.routeBodies.keys()].filter(
      (routeName) => !chart.routeDestinations.has(routeName),
    );

    expect(withoutDestination, '行き先の型を名乗らない航路').toEqual(['route_to_shore']);
  });

  it('辺の両端は、本土までの残り海区数が違う', () => {
    // **同じ数の海区どうしが繋がると、その辺は本土へ近づきも遠ざかりもしない**——航路の風の受け方
    // （voyage.yaml の sea_route）がどちらの条件にも当たらず、追い風でも向かい風でも横風と同じに
    // なる。盤面に出ないまま風が効かない辺ができるので、繋ぎ方の側で塞いでおく。
    const chart = readSeaChart();
    const distance = (zoneName: string): number =>
      (nodeAt(chart.bodies.get(zoneName), 'props', 'zones_to_mainland', 'value') as number | undefined) ?? 0;

    for (const zone of chart.zones)
      for (const neighbour of chart.neighbours.get(zone) ?? [])
        expect(distance(neighbour), `${zone} と ${neighbour} は残り海区数が違う`).not.toBe(distance(zone));
  });

  it('押し流す先は、航路で繋がった隣の海区（追い風なら本土の側、向かい風なら島の側）', () => {
    // **隣は海区が `zone_toward_*` に1度だけ書く**（6.9節）が、1箇所へ集まったことと、その1箇所が
    // 正しいことは別。取り違えはその海区で荒天に遭うまで表に出ないので、航路の辺から組み立てた隣と
    // 突き合わせる。
    //
    // 向きは**辺の側の事実で、残り海区数からは出せない**（遠回りの側の隣は自分より遠い）。だから
    // 見るのは3つ——隣の顔ぶれが辺と一致すること、本土の側と島の側が重なりなくそれを二分すること、
    // そして辺の両端が向きを反対に名乗ること。
    //
    // **卓そのものは sea_zone trait が1つだけ持つ**ので、海区が書き直していなければそちらを読む
    // （分かれ道と合流点だけが、遠回りの側の1本を足すために書き直している）。行き先はプロパティ名で
    // 書かれているので、そのプロパティが名乗る型まで辿って初めて隣の名前になる。
    const chart = readSeaChart();
    const stormPick = (zone: string): readonly unknown[] => {
      const own = nodeAt(chart.bodies.get(zone), 'props', 'storm_drift', 'on_max', 'pick');
      const shared = nodeAt(chart.traitBodies.get('sea_zone'), 'props', 'storm_drift', 'on_max', 'pick');
      const pick = Array.isArray(own) ? own : shared;
      expect(Array.isArray(pick), `${zone}: 押し流しの卓がある`).toBe(true);
      return pick as readonly unknown[];
    };
    const driftTargets = (zone: string, weightProp: string): readonly string[] =>
      stormPick(zone)
        .filter((candidate) => nodeAt(candidate, 'weight', 'prop') === weightProp)
        .map((candidate) => nodeAt(candidate, 'move', 'to_object', 'prop'))
        .filter((prop): prop is string => typeof prop === 'string')
        .map((prop) => objectValueAt(chart.bodies.get(zone), 'props', prop))
        .filter((name): name is string => name !== undefined);

    const toMainland = new Map(
      chart.zones.map((zone) => [zone, driftTargets(zone, 'drift_to_mainland_weight')]),
    );
    const toIsland = new Map(chart.zones.map((zone) => [zone, driftTargets(zone, 'drift_to_island_weight')]));

    for (const zone of chart.zones) {
      const both = [...toMainland.get(zone)!, ...toIsland.get(zone)!];
      // 本土は海区ではないので、押し流しの相手にならない（到達は航路を渡ること、Voyage.md 4節）。
      const neighbours = (chart.neighbours.get(zone) ?? []).filter((name) => name !== 'mainland');
      expect([...both].sort(), `${zone}: 押し流す先は航路で繋がった隣だけ`).toEqual([...neighbours].sort());
      expect(new Set(both).size, `${zone}: 同じ隣を両方の風下に置かない`).toBe(both.length);

      for (const neighbour of toMainland.get(zone)!)
        expect(toIsland.get(neighbour), `${neighbour}から見て${zone}は島の側`).toContain(zone);
      for (const neighbour of toIsland.get(zone)!)
        expect(toMainland.get(neighbour), `${neighbour}から見て${zone}は本土の側`).toContain(zone);
    }

    // 本土の側を辿り続ければ必ず本土の手前へ出る（島の側なら島側の端へ）。向きが局所的に噛み合って
    // いても、網の全体として前後が入れ替わっていれば、ここで出口が見つからない。
    const endOfChain = (zone: string, sides: ReadonlyMap<string, readonly string[]>): string => {
      let current = zone;
      for (let steps = 0; steps <= chart.zones.length; steps++) {
        const onward = sides.get(current)!;
        if (onward.length === 0) return current;
        current = onward[0];
      }
      throw new Error(`${zone} から辿ると端に着かない（向きが輪になっている）`);
    };

    for (const zone of chart.zones) {
      expect(endOfChain(zone, toMainland), `${zone}: 本土の側を辿った先`).toBe('mainland_shallows');
      expect(endOfChain(zone, toIsland), `${zone}: 島の側を辿った先`).toBe('coastal_waters');
    }
  });
});

/**
 * その節の下の `spawn`（9.4節）が湧かせる型の名前。**`spawn` の下へ入ったら、そこから先はすべて
 * 湧かせる側**——`pick` の候補ごとにも、物の並びとしても書けるので、形で数え分けない。
 */
function spawnedObjectNames(node: unknown, underSpawn = false, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) spawnedObjectNames(item, underSpawn, found);
    return found;
  }
  if (node === null || typeof node !== 'object') return found;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (underSpawn && key === 'object' && typeof value === 'string') found.add(value);
    spawnedObjectNames(value, underSpawn || key === 'spawn', found);
  }
  return found;
}
