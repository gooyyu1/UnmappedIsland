import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { startNewGame } from '../../src/domain/generation/NewGame';
import type { StartedGame } from '../../src/domain/generation/NewGame';
import type { WorldObject } from '../../src/domain/WorldObject';
import { Location } from '../../src/domain/wrappers/Location';
import { applyScenario, bundledScenario } from '../../src/scenario/Scenario';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction } from '../support/illumination';
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
   * **回数に上限を置く。** 見張りは航路が見えた時点で止まる（voyage.yamlのexploreのconditions）ので
   * 素の宣言では有限回で抜けるが、そこが壊れたときに**赤くなる代わりに止まらなくなる**のでは、
   * この検査が何も言わなくなる。上限は、どの海区の必要回数（最大5）よりも十分に大きい値。
   */
  function watchUntilSighted(game: StartedGame, zone: WorldObject): readonly WorldObject[] {
    const before = new Set(sightedRoutes(zone).map((route) => route.instanceId));
    for (let i = 0; i < 20 && keepWatch(game, zone); i++);
    return sightedRoutes(zone).filter((route) => !before.has(route.instanceId));
  }

  /** その海区の航路が見えるまで見張り、本土の側へ進む航路を渡る。渡れなければfalse。 */
  function watchAndCross(game: StartedGame, zone: WorldObject): boolean {
    // 見張りが立てるのは、その海区に立つ航路のうち進む先の1本だけ（voyage.yaml）。
    const onward = watchUntilSighted(game, zone).at(0);
    return onward?.tryGetAction('cross', game.player.instance)?.tryExecute() === true;
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
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    const first = singletonPlace(game, 'coastal_waters');

    setWind(game, 'tailwind');
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

  it('航路が見えたら、その海区の見張りは終わる', () => {
    // 上限へ達した進捗は書き込みのたびにon_maxを呼び直すので、止めないと同じ航路が湧き続ける。
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    const first = singletonPlace(game, 'coastal_waters');

    keepWatch(game, first);
    keepWatch(game, first);
    expect(keepWatch(game, first), '航路が見えた後は見張れない').toBe(false);
    expect(sightedRoutes(first), '航路は進む先と戻る先の2本だけ').toHaveLength(2);
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

  /** その海岸から出航し、島影の海を見張って、島へ戻る航路を渡る。着いた場所を返す。 */
  function sailAndTurnBack(game: StartedGame, raft: WorldObject, coast: WorldObject): WorldObject {
    beachRaftAt(game, raft, coast);
    expect(raft.tryGetAction('set_sail', game.player.instance)?.tryExecute(), '出航できる').toBe(true);

    const first = singletonPlace(game, 'coastal_waters');
    for (let i = 0; i < 20 && keepWatch(game, first); i++);
    expect(cross(game, first, 'route_to_shore'), '島へ引き返せる').toBe(true);
    return raft.parent!;
  }

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

  it('帆を張ると、同じ風でも段が1つ上がる', () => {
    // **積荷は降ろす。** 出航のしたくの積荷（ヤシの実70個）とプレイヤーの体重では段がheavyまで
    // 落ちていて、向かい風では帆を張っても下限0に張り付いたまま差が出ない。
    const sailSpeedIn = (wind: string, withSail: boolean): number => {
      const { game, raft } = ready();
      if (withSail) rigSail(game, raft);
      raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
      for (const cargo of [...raft.children()]) {
        if (cargo !== game.player.instance && cargo.def.name !== 'rawhide_sail') cargo.destroy();
      }
      setWind(game, wind);
      tick(game);
      return propertyOf(raft, 'sail_speed');
    };

    // 向かい風（海流+3、風-3）は帆が無ければ0。帆の+2でslowへ届く。
    expect(sailSpeedIn('headwind', false), '帆が無ければ向かい風では止まる').toBe(0);
    expect(sailSpeedIn('headwind', true), '帆があれば向かい風でも進む').toBe(2);
    // 追い風でも同じだけ足される。
    expect(sailSpeedIn('tailwind', true) - sailSpeedIn('tailwind', false), '寄与は2').toBe(2);
  });

  it('陸に居る間は、渡る速さが立たない（風も海流も効かない）', () => {
    const { game, raft } = ready();
    setWind(game, 'tailwind');

    tick(game);

    expect(propertyOf(raft, 'sail_speed'), '陸の上では速さが立たない').toBe(0);
  });

  it('風向きが横断にかかる時間を決める（追い風＜横風＜向かい風）', () => {
    const crossingMinutesIn = (wind: string): number => {
      const { game, raft } = ready();
      raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
      // 積載の効きは別の検査で見るので、ここでは降ろして風だけを残す。
      for (const cargo of [...raft.children()]) {
        if (cargo !== game.player.instance) cargo.destroy();
      }
      setWind(game, wind);
      tick(game);
      return propertyOf(singletonPlace(game, 'coastal_waters'), 'crossing_minutes');
    };

    const tail = crossingMinutesIn('tailwind');
    const cross = crossingMinutesIn('crosswind');
    const head = crossingMinutesIn('headwind');

    expect(tail, '追い風なら最も短く渡れる').toBeLessThan(cross);
    expect(cross, '横風でも向かい風よりは短い').toBeLessThan(head);
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

  /**
   * その海区を繰り返し見張り、**手に入った物の名前・海区に湧いた物の名前・何かが返った割合**を返す。
   *
   * 見張りの進捗が上限へ達すると航路（と小島）が現れ、そこで見張りは終わる。**ここで見たいのは卓の
   * ほうだけ**なので、毎回進捗を戻して上限へ届かせない。湧いた物は立ち去る（fish_shoalの
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

  it('島から本土まで、8種類の顔ぶれから配った十数個の海区を渡る', () => {
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();

    const visited = voyageToMainland(game, raft);

    expect(raft.parent?.def.name, '鎖を辿り切れば本土に着く').toBe('mainland');
    expect(visited.length, '本土までは十数個の海区').toBeGreaterThanOrEqual(13);
    expect(visited.length, '本土までは十数個の海区').toBeLessThanOrEqual(19);
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
});
