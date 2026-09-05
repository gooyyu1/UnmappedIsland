import { beforeAll, describe, expect, it } from 'vitest';
import { startNewGame } from '../../src/domain/generation/NewGame';
import type { WorldObject } from '../../src/domain/WorldObject';
import { Location } from '../../src/domain/wrappers/Location';
import { Path } from '../../src/domain/wrappers/Path';
import type { World } from '../../src/domain/wrappers/World';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import { pathsIn } from '../support/paths';
import { seededRng } from '../../src/domain/Rng';

describe('IslandSpawner/NewGame(生成結果の世界への実体化)', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = bundledCodex();
  });

  it('全サイトが土地として実体化され、辺1本につき両端へ1個ずつ道が作られる', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 3, seededRng(99));
    const map = game.map;

    const locationsSlotId = codex.slotNames.getId('locations');
    const locations = game.world.instance.tryGetSlot(locationsSlotId);
    expect(locations).toBeDefined();
    // 島の外に最初から在る場所（海区・本土、voyage.yaml）もworldのlocationsに居るので、
    // サイトの数ぴったりにはならない（NewGame.spawnSingletonsAcceptedByWorld）。
    const locationTag = codex.tagNames.getId('location');
    const singletonLocations = codex
      .singletonGlobalIds()
      .filter((id) => codex.objects.get(id).tags.includes(locationTag)).length;
    expect(locations!.contents.length, '全サイトが土地として実体化される').toBe(
      map.sites.length + singletonLocations,
    );

    let totalPaths = 0;
    for (const site of map.sites) {
      const location = game.world.instance.findSelfOrDescendantByInstanceId(map.siteInstanceIds[site.index]);
      expect(location, `サイト${site.index}の土地が世界に居る`).toBeDefined();
      expect(
        location!.def.globalId,
        `サイト${site.index}はLocationTypeどおりのobject_defで実体化される`,
      ).toBe(site.type!.objectDefGlobalId);

      const view = new Location(location!, codex);
      const degree = map.edges.filter((e) => e.a === site.index || e.b === site.index).length;
      expect(pathsIn(view, codex), '開始直後、発見済みの道は無い').toEqual([]);

      const hidden = location!.tryGetSlot(codex.slotNames.getId('undiscovered_fixtures'));
      expect(hidden!.contents.length, `サイト${site.index}: 繋がる辺の数だけ道が隠されている`).toBe(degree);
      totalPaths += hidden!.contents.length;
    }

    expect(totalPaths, '辺1本につき両端へ1個ずつ道が作られる').toBe(map.edges.length * 2);
  });

  it('道は隣接する土地を指し、探索進捗が最大へ達する前に見つかる範囲のrequired_progressを持つ', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 5, seededRng(99));
    const map = game.map;
    const progressId = codex.propertyNames.getId('exploration_progress');

    for (const site of map.sites) {
      const location = game.world.instance.findSelfOrDescendantByInstanceId(map.siteInstanceIds[site.index])!;
      const progressMax = location.def.tryGetPropertyDef(progressId)!.range!.max;
      const hidden = location.tryGetSlot(codex.slotNames.getId('undiscovered_fixtures'))!;

      const neighborInstanceIds = new Set(
        map.edges
          .filter((e) => e.a === site.index || e.b === site.index)
          .map((e) => map.siteInstanceIds[e.a === site.index ? e.b : e.a]),
      );

      for (const pathInstance of hidden.contents) {
        const path = new Path(pathInstance, codex);
        expect(neighborInstanceIds, `サイト${site.index}: 道は隣接する土地を指す`).toContain(
          path.destinationInstanceId,
        );
        expect(path.travelMinutes).toBeGreaterThanOrEqual(15);
        expect(
          path.requiredProgress,
          `サイト${site.index}: すべての道は進捗が最大へ達する前に見つかる`,
        ).toBeGreaterThanOrEqual(2);
        expect(
          path.requiredProgress,
          `サイト${site.index}: すべての道は進捗が最大へ達する前に見つかる`,
        ).toBeLessThanOrEqual(progressMax - 1);
      }
    }
  });

  it('辺の両端の道は互いをreturn_path_idで指す', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 5, seededRng(99));
    const map = game.map;
    const hiddenSlotId = codex.slotNames.getId('undiscovered_fixtures');

    for (const site of map.sites) {
      const location = game.world.instance.findSelfOrDescendantByInstanceId(map.siteInstanceIds[site.index])!;

      for (const pathInstance of location.tryGetSlot(hiddenSlotId)!.contents) {
        const path = new Path(pathInstance, codex);
        const returnInstance = game.world.instance.findSelfOrDescendantByInstanceId(
          path.returnPathInstanceId,
        );
        expect(returnInstance, `サイト${site.index}: 帰り道が世界に居る`).toBeDefined();

        const back = new Path(returnInstance!, codex);
        expect(back.destinationInstanceId, '帰り道はこちらの土地を指す').toBe(location.instanceId);
        expect(back.returnPathInstanceId, '帰り道もこちらの道を指す（相互）').toBe(pathInstance.instanceId);
        expect(returnInstance!.parent?.instanceId, '帰り道は移動先の土地に居る').toBe(
          path.destinationInstanceId,
        );
      }
    }
  });

  it('道を1本見つけると、渡った先から戻る道も同時に見つかる', () => {
    for (const seed of [3, 5, 11, 20]) {
      const game = startNewGame(codex, SAMPLE_CHARACTER, seed, seededRng(99));
      const start = game.startLocation;

      // 開始地点の道が1本見つかるまで探索する。
      let discovered: readonly WorldObject[] = [];
      for (let i = 0; i < start.explorationProgressMax && discovered.length === 0; i++) {
        game.player.explore();
        discovered = pathsIn(start, codex);
      }
      expect(discovered.length, `シード${seed}: 探索で道が見つかる`).toBeGreaterThan(0);

      const outbound = new Path(discovered[0], codex);
      expect(outbound.travel(game.player.instance), `シード${seed}: 渡れる`).toBe(true);

      const arrived = game.player.location!;
      expect(arrived.explorationProgress, `シード${seed}: 渡った先はまだ未探索`).toBe(0);
      const back = pathsIn(arrived, codex).map((p) => new Path(p, codex));
      const home = back.find((p) => p.destinationInstanceId === start.instance.instanceId);
      expect(home, `シード${seed}: 未探索でも帰り道は見つかっている`).toBeDefined();

      expect(home!.travel(game.player.instance), `シード${seed}: 帰れる`).toBe(true);
      expect(game.player.location!.instance.instanceId, `シード${seed}: 元の土地へ戻る`).toBe(
        start.instance.instanceId,
      );
    }
  });

  it('プレイヤーは海岸の土地（漂着地点）に配置される', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 8, seededRng(99));

    expect(game.startLocation.characters, 'プレイヤーは開始地点のcharactersスロットに居る').toContain(
      game.player.instance,
    );

    const startIndex = game.map.siteInstanceIds.indexOf(game.startLocation.instance.instanceId);
    expect(game.map.sites[startIndex].onCoastRing, '漂着地点は海岸（外周リング）の土地').toBe(true);
  });

  it('探索ですべての道が見つかり、その後の移動でプレイヤーと時間が進む', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, seededRng(1234));
    const start = game.startLocation;
    const agent = game.player.instance;

    const startIndex = game.map.siteInstanceIds.indexOf(start.instance.instanceId);
    const degree = game.map.edges.filter((e) => e.a === startIndex || e.b === startIndex).length;
    expect(degree, '開始地点にも必ず道がある(MSTの連結性)').toBeGreaterThanOrEqual(1);

    // 探索率100%まで繰り返す。途中(上限-1以前)ですべての道が見つかる。
    for (let i = 0; i < start.explorationProgressMax; i++)
      expect(start.explore(agent), '探索できる土地なので毎回成立する').toBe(true);

    expect(start.explorationProgress, '探索率100%に達している').toBe(start.explorationProgressMax);
    expect(pathsIn(start, codex).length, '探索でこの土地のすべての道が見つかる').toBe(degree);

    // 見つかった道で移動する。
    const path = new Path(pathsIn(start, codex)[0], codex);
    const minutesBefore = totalMinutes(game.world);

    expect(path.travel(agent)).toBe(true);

    expect(agent.parent!.instanceId, 'プレイヤーは道の行き先の土地へ移る').toBe(path.destinationInstanceId);
    expect(new Location(agent.parent!, codex).characters, '移動先ではcharactersスロットに入る').toContain(
      agent,
    );
    expect(totalMinutes(game.world) - minutesBefore, '移動時間の分だけゲーム内時間が進む').toBe(
      path.travelMinutes,
    );
  });

  it('IslandMapは実体化された土地のinstanceIdから命名処理の付けた名前を引ける', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 13, seededRng(99));

    for (const site of game.map.sites)
      expect(game.map.nameOfInstance(game.map.siteInstanceIds[site.index])).toBe(site.name);

    expect(game.map.nameOfInstance(0), '未実体化を表す0は該当なし').toBeUndefined();
    expect(game.map.nameOfInstance(-1), '未知のinstanceIdは該当なし').toBeUndefined();
  });

  it('亜種のプロパティが、実体化した土地へ書き込まれる', () => {
    // 亜種は「その土地らしさ」を発見量のつまみ（locations.yamlのweight: {prop:...}）で表す。
    // 素の値のままでは名前だけの飾りになるので、実体へ届いていることを確かめる。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 3, seededRng(99));

    const withProps = game.map.sites.filter((site) => (site.variant?.props.size ?? 0) > 0);
    expect(withProps.length, 'propsを持つ亜種が出るシードで確かめる').toBeGreaterThan(0);

    for (const site of withProps) {
      const location = game.world.instance.findSelfOrDescendantByInstanceId(
        game.map.siteInstanceIds[site.index],
      )!;
      for (const [propertyGlobalId, value] of site.variant!.props)
        expect(location.tryGetProperty(propertyGlobalId)?.getEffectiveValue() ?? 0, `${site.name}`).toBe(
          value,
        );
    }
  });

  it('開始時刻は朝8:00〜正午12:00の間のtick刻みで決まる', () => {
    for (const seed of [3, 11, 21]) {
      const world = startNewGame(codex, SAMPLE_CHARACTER, seed, seededRng(seed)).world;
      const minutes = world.hour * 60 + world.minute;

      expect(world.day, '開始は1日目').toBe(1);
      expect(minutes, `シード${seed}の開始時刻は8:00以降`).toBeGreaterThanOrEqual(8 * 60);
      expect(minutes, `シード${seed}の開始時刻は12:00以前`).toBeLessThanOrEqual(12 * 60);
      expect(minutes % world.rawMinutesPerTick, `シード${seed}の開始時刻はtick刻み`).toBe(0);
    }
  });

  it('同じシードなら開始時刻も同じになる（開始状態はシードだけで決まる）', () => {
    const first = startNewGame(codex, SAMPLE_CHARACTER, 21, seededRng(21));
    const second = startNewGame(codex, SAMPLE_CHARACTER, 21, seededRng(21));

    expect(second.world.totalMinutes).toBe(first.world.totalMinutes);
  });

  it('同じシードなら、WorldSession.rngのシードが異なっても同じ島レイアウトになる', () => {
    // 地形レイアウト(IslandMap)はシードのみに依存し、WorldSession.rng（pick抽選など）には
    // 依存しない: rngのシードを変えても同じ島になる。
    const first = startNewGame(codex, SAMPLE_CHARACTER, 21, seededRng(1));
    const second = startNewGame(codex, SAMPLE_CHARACTER, 21, seededRng(2));

    expect(second.map.sites.map((s) => [s.x, s.y, s.type!.name, s.name])).toEqual(
      first.map.sites.map((s) => [s.x, s.y, s.type!.name, s.name]),
    );
    expect(second.map.edges.map((e) => [e.a, e.b, e.travelMinutes])).toEqual(
      first.map.edges.map((e) => [e.a, e.b, e.travelMinutes]),
    );
  });
});

function totalMinutes(world: World): number {
  return (world.day - 1) * 24 * 60 + world.hour * 60 + world.minute;
}
