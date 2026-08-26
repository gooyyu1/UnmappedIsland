import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { startNewGame } from '../../src/domain/generation/NewGame';
import type { StartedGame } from '../../src/domain/generation/NewGame';
import type { WorldObject } from '../../src/domain/WorldObject';
import { Location } from '../../src/domain/wrappers/Location';
import { applyScenario, bundledScenario } from '../../src/scenario/Scenario';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';
import { seededRng } from '../../src/domain/Rng';

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

  /** その海区に現れている航路（まだ見えていなければundefined）。 */
  function sightedRoute(zone: WorldObject): WorldObject | undefined {
    return new Location(zone, codex).fixtures.find((fixture) =>
      fixture.def.hasTag(codex.tagNames.getId('sea_route')),
    );
  }

  /**
   * その海区の航路が見えるまで見張り、渡る。渡れなければfalse。
   *
   * **回数に上限を置く。** 見張りは航路が見えた時点で止まる（voyage.yamlのexploreのconditions）ので
   * 素の宣言では有限回で抜けるが、そこが壊れたときに**赤くなる代わりに止まらなくなる**のでは、
   * この検査が何も言わなくなる。上限は、どの海区の必要回数（最大5）よりも十分に大きい値。
   */
  function watchAndCross(game: StartedGame, zone: WorldObject): boolean {
    for (let i = 0; i < 20 && keepWatch(game, zone); i++);
    const route = sightedRoute(zone);
    return route?.tryGetAction('cross', game.player.instance)?.tryExecute() === true;
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

  it('時間を進めるだけでは1海区も進まない', () => {
    // **確定した仕様（GameEndings.md 12節）そのもの。** 漂っているだけでは航路も現れず、
    // 次の海区へも移らない——進みを運ぶのは時間ではなく見張りと横断という行為。
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    const first = singletonPlace(game, 'coastal_waters');

    setWind(game, 'tailwind');
    for (let i = 0; i < 96; i++) tick(game);

    expect(raft.parent?.def.name, '丸1日流されても最初の海区に居る').toBe('coastal_waters');
    expect(sightedRoute(first), '航路も現れない').toBeUndefined();
    expect(propertyOf(first, 'exploration_progress'), '見張っていないので進捗も動かない').toBe(0);
  });

  it('見張りを続けると航路が現れ、渡ると別の海区に居る', () => {
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    const first = singletonPlace(game, 'coastal_waters');

    expect(keepWatch(game, first), '1回目の見張り').toBe(true);
    expect(sightedRoute(first), '1回では航路は見えない').toBeUndefined();

    expect(keepWatch(game, first), '2回目の見張り').toBe(true);
    const route = sightedRoute(first);
    expect(route?.def.name, '2回目で潮目への航路が現れる').toBe('route_to_tide_rip');

    expect(route!.tryGetAction('cross', game.player.instance)?.tryExecute(), '渡れる').toBe(true);
    expect(raft.parent?.def.name, '次の海区へ移っている').toBe('tide_rip');
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
    expect(
      new Location(first, codex).fixtures.filter((fixture) =>
        fixture.def.hasTag(codex.tagNames.getId('sea_route')),
      ),
      '航路は1本だけ',
    ).toHaveLength(1);
  });

  it('筏の無い海区からは渡れない', () => {
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    const first = singletonPlace(game, 'coastal_waters');
    keepWatch(game, first);
    keepWatch(game, first);

    // 筏だけを次の海区へ先に移す（乗り手は取り残される）。
    raft.moveToSlotOrRejection(singletonPlace(game, 'tide_rip').getSlot(codex.slotNames.getId('fixtures')));

    const route = sightedRoute(first)!;
    expect(route.tryGetAction('cross', game.player.instance)?.tryExecute(), '渡る手は成立しない').toBe(false);
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

  it('最後の海区から渡ると本土に着き、持ち帰った物ごと周回が終わる', () => {
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();

    for (const zoneName of ['coastal_waters', 'tide_rip', 'open_water']) {
      const zone = singletonPlace(game, zoneName);
      expect(raft.parent?.def.name, `${zoneName} に居る`).toBe(zoneName);
      expect(watchAndCross(game, zone), `${zoneName} から渡れる`).toBe(true);
    }

    expect(raft.parent?.def.name, '筏は本土に着く').toBe('mainland');
    expect(game.player.ending.kind, 'プレイヤーは島を出た').toBe('escape');
    expect(game.player.ending.broughtArtifacts, '積んでいたアーティファクトを持ち帰る').toEqual([
      'golden_chalice',
    ]);

    // 着いた後は風も海流も効かないので、速さは立たない（同じ到達が二度起きない）。
    tick(game);
    expect(propertyOf(raft, 'sail_speed'), '本土では速さが立たない').toBe(0);
    expect(raft.parent?.def.name, '本土に留まる').toBe('mainland');
  });
});
