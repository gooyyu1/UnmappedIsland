import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { start as startNewGame } from '../../src/domain/generation/NewGame';
import type { NewGameSession } from '../../src/domain/generation/NewGame';
import type { WorldObject } from '../../src/domain/WorldObject';
import { applyScenario, bundledScenario } from '../../src/scenario/Scenario';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';
import { seededRng } from '../../src/domain/Rng';

/**
 * 島からの脱出（voyage.yaml、docs/world/Voyage.md）の検証。
 *
 * 出航（筏ごと外洋へ移る）・航海の進み（風・海流・積載）・到達（本土へ移る）の3つを、
 * 出航のしたくシナリオ（voyage_ready.yaml）の状態から実際に動かして確かめる。
 */
describe('筏と航海', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  /** 出航のしたくシナリオの状態から始める（砂浜に積荷入りの筏があり、聖杯も積んである）。 */
  function ready(): { game: NewGameSession; raft: WorldObject } {
    const scenario = bundledScenario('voyage_ready');
    if (scenario === undefined) throw new Error('同梱シナリオ voyage_ready がありません。');

    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, seededRng(scenario.seed));
    applyScenario(game, scenario, codex);

    const raft = game.startLocation.fixtures.find((fixture) => fixture.def.name === 'raft');
    if (raft === undefined) throw new Error('シナリオが筏を置いていません。');
    return { game, raft };
  }

  /** 風向きを直接置く（8時間ごとの引き直しは天気と同じ仕組みなので、ここでは向きだけを固定する）。 */
  function setWind(game: NewGameSession, wind: string): void {
    game.world.instance.getProperty(codex.propertyNames.getId('wind')).init(codex.symbolNames.getId(wind));
  }

  function propertyOf(object: WorldObject, name: string): number {
    return object.tryGetProperty(codex.propertyNames.getId(name))?.getEffectiveValue() ?? 0;
  }

  /** 1tick（15分）進める。 */
  function tick(game: NewGameSession): void {
    game.session.advanceWorldTime(game.world.minutesPerTick);
  }

  it('出航すると、プレイヤーごと筏が外洋へ移る', () => {
    const { game, raft } = ready();

    expect(raft.tryGetAction('set_sail', game.player.instance)?.tryExecute() === true, '出航できる').toBe(
      true,
    );

    expect(raft.parent?.def.name, '筏は外洋に居る').toBe('open_sea');
    expect(game.player.location?.instance, 'プレイヤーは筏の中に居る').toBe(raft);
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

    const landing = game.world.instance.findDescendantByInstanceId(game.map.siteInstanceIds[inland!.index]);
    expect(
      raft.moveToSlot(landing!.getSlot(codex.slotNames.getId('fixtures'))),
      '筏を内陸へ運ぶ',
    ).toBeUndefined();

    expect(raft.tryGetAction('set_sail', game.player.instance)?.tryExecute() === true, '出航できない').toBe(
      false,
    );
    expect(raft.parent, '筏は内陸に残る').toBe(landing);
  });

  /** 帆を1枚作って、筏の構造スロットへ組み込む。 */
  function rigSail(game: NewGameSession, raft: WorldObject): WorldObject {
    const sail = game.session.spawn(codex.objectNames.getId('rawhide_sail'));
    const failure = sail.moveToSlot(raft.getSlot(codex.slotNames.getId('structure')));
    if (failure !== undefined) throw new Error(`帆を組み込めません: ${failure}`);
    return sail;
  }

  it('帆は浮いている間だけ効く（浜に置いたままでは進まない）', () => {
    const { game, raft } = ready();
    rigSail(game, raft);
    setWind(game, 'tailwind');

    tick(game);

    // **帆に条件を付けないとここが2になり、段がslowへ上がって浜のまま本土へ着く。**
    expect(propertyOf(raft, 'sail_speed'), '浜では帆も効かない').toBe(0);
    expect(propertyOf(raft, 'voyage_progress'), '浜では進まない').toBe(0);
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

  it('陸に居る間は進まない（風も海流も効かない）', () => {
    const { game, raft } = ready();
    setWind(game, 'tailwind');

    tick(game);

    expect(propertyOf(raft, 'sail_speed'), '陸の上では速さが立たない').toBe(0);
    expect(propertyOf(raft, 'voyage_progress'), '進みもしない').toBe(0);
  });

  it('風向きが1tickあたりの進みを決める（追い風＞横風＞向かい風）', () => {
    const advancePerTick = (wind: string): number => {
      const { game, raft } = ready();
      raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
      setWind(game, wind);

      const before = propertyOf(raft, 'voyage_progress');
      tick(game);
      return propertyOf(raft, 'voyage_progress') - before;
    };

    const tail = advancePerTick('tailwind');
    const cross = advancePerTick('crosswind');
    const head = advancePerTick('headwind');

    expect(tail, '追い風は最も速い').toBeGreaterThan(cross);
    expect(cross, '横風でも進む').toBeGreaterThan(head);
    expect(head, '向かい風では進まない').toBe(0);
  });

  it('積荷が重いほど遅い（捨てれば速くなる）', () => {
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    setWind(game, 'crosswind');

    const laden = propertyOf(raft, 'sail_speed');
    // 積荷を海へ捨てる（筏から出せば、そのぶん軽くなる）。
    for (const cargo of [...raft.children()]) {
      if (cargo !== game.player.instance) cargo.destroy();
    }
    const empty = propertyOf(raft, 'sail_speed');

    expect(empty, '軽くなれば速くなる').toBeGreaterThan(laden);
  });

  it('本土へ着くと、持ち帰った物ごと周回が終わる', () => {
    const { game, raft } = ready();
    raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();
    setWind(game, 'tailwind');

    // 距離の残り1つ手前まで詰めて、あと1tickで着く状態にする（航海そのものの長さは別の検査）。
    const progressId = codex.propertyNames.getId('voyage_progress');
    const distance = raft.def.tryGetPropertyDef(progressId)!.range!.max;
    raft.getProperty(progressId).init(distance - 1);

    tick(game);

    expect(raft.parent?.def.name, '筏は本土に着く').toBe('mainland');
    expect(game.player.hasReachedMainland, 'プレイヤーは島を出た').toBe(true);
    expect(game.player.broughtArtifacts, '積んでいたアーティファクトを持ち帰る').toEqual(['golden_chalice']);

    // 着いた後は風も海流も効かないので、進みは止まったまま（同じ到達が二度起きない）。
    tick(game);
    expect(propertyOf(raft, 'sail_speed'), '本土では速さが立たない').toBe(0);
    expect(raft.parent?.def.name, '本土に留まる').toBe('mainland');
  });

  it('追い風が続けば10日以内、向かい風が続けば着かない', () => {
    // ここで見るのは距離と速さの釣り合いだけなので、飲み食いはさせない（プレイヤーは途中で
    // 渇きで死ぬが、筏はそのまま流されていく）。着いたかどうかは筏の居場所で読む。
    const sail = (wind: string, days: number): boolean => {
      const { game, raft } = ready();
      raft.tryGetAction('set_sail', game.player.instance)?.tryExecute();

      const ticksPerDay = (24 * 60) / game.world.minutesPerTick;
      for (let i = 0; i < days * ticksPerDay; i++) {
        // 風は8時間ごとに引き直されるので、毎tick置き直して向きを固定する。
        setWind(game, wind);
        tick(game);
      }
      return raft.parent?.def.name === 'mainland';
    };

    expect(sail('tailwind', 10), '追い風続きなら10日で着く').toBe(true);
    expect(sail('headwind', 30), '向かい風続きでは30日かけても着かない').toBe(false);
  });
});
