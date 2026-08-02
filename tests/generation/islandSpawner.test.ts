import { beforeAll, describe, expect, it } from 'vitest';
import { start as startNewGame } from '../../src/domain/generation/NewGame';
import type { WorldObject } from '../../src/domain/runtime/WorldObject';
import { Location } from '../../src/domain/runtime/views/Location';
import { Path } from '../../src/domain/runtime/views/Path';
import type { World } from '../../src/domain/runtime/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';
import { SeededRng } from '../support/SeededRng';
import { pathsIn } from '../support/paths';

describe('IslandSpawner/NewGame(生成結果の世界への実体化)', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  it('全サイトが土地として実体化され、辺1本につき両端へ1個ずつ道が作られる', () => {
    const game = startNewGame(codex, 3, new SeededRng(99));
    const map = game.map;

    const locationsSlotId = codex.slotNames.getId('locations');
    const locations = game.world.instance.tryGetSlot(locationsSlotId);
    expect(locations).toBeDefined();
    expect(locations!.contents.length, '全サイトが土地として実体化される').toBe(map.sites.length);

    let totalPaths = 0;
    for (const site of map.sites) {
      const location = game.world.instance.findDescendantByInstanceId(map.siteInstanceIds[site.index]);
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
    const game = startNewGame(codex, 5, new SeededRng(99));
    const map = game.map;
    const progressId = codex.propertyNames.getId('exploration_progress');

    for (const site of map.sites) {
      const location = game.world.instance.findDescendantByInstanceId(map.siteInstanceIds[site.index])!;
      const progressMax = location.def.getPropertyDef(progressId)!.range!.max;
      const hidden = location.tryGetSlot(codex.slotNames.getId('undiscovered_fixtures'))!;

      const neighborInstanceIds = new Set(
        map.edges
          .filter((e) => e.a === site.index || e.b === site.index)
          .map((e) => map.siteInstanceIds[e.a === site.index ? e.b : e.a]),
      );

      for (const pathInstance of hidden.contents) {
        const path = new Path(pathInstance, codex.propertyNames);
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
    const game = startNewGame(codex, 5, new SeededRng(99));
    const map = game.map;
    const hiddenSlotId = codex.slotNames.getId('undiscovered_fixtures');

    for (const site of map.sites) {
      const location = game.world.instance.findDescendantByInstanceId(map.siteInstanceIds[site.index])!;

      for (const pathInstance of location.tryGetSlot(hiddenSlotId)!.contents) {
        const path = new Path(pathInstance, codex.propertyNames);
        const returnInstance = game.world.instance.findDescendantByInstanceId(path.returnPathInstanceId);
        expect(returnInstance, `サイト${site.index}: 帰り道が世界に居る`).toBeDefined();

        const back = new Path(returnInstance!, codex.propertyNames);
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
      const game = startNewGame(codex, seed, new SeededRng(99));
      const start = game.startLocation;

      // 開始地点の道が1本見つかるまで探索する。
      let discovered: readonly WorldObject[] = [];
      for (let i = 0; i < start.explorationProgressMax && discovered.length === 0; i++) {
        game.player.explore(game.session);
        discovered = pathsIn(start, codex);
      }
      expect(discovered.length, `シード${seed}: 探索で道が見つかる`).toBeGreaterThan(0);

      const outbound = new Path(discovered[0], codex.propertyNames);
      expect(outbound.travel(game.player.instance, game.session), `シード${seed}: 渡れる`).toBe(true);

      const arrived = game.player.location!;
      expect(arrived.explorationProgress, `シード${seed}: 渡った先はまだ未探索`).toBe(0);
      const back = pathsIn(arrived, codex).map((p) => new Path(p, codex.propertyNames));
      const home = back.find((p) => p.destinationInstanceId === start.instance.instanceId);
      expect(home, `シード${seed}: 未探索でも帰り道は見つかっている`).toBeDefined();

      expect(home!.travel(game.player.instance, game.session), `シード${seed}: 帰れる`).toBe(true);
      expect(game.player.location!.instance.instanceId, `シード${seed}: 元の土地へ戻る`).toBe(
        start.instance.instanceId,
      );
    }
  });

  it('プレイヤーは海岸の土地（漂着地点）に配置される', () => {
    const game = startNewGame(codex, 8, new SeededRng(99));

    expect(game.startLocation.characters, 'プレイヤーは開始地点のcharactersスロットに居る').toContain(
      game.player.instance,
    );

    const startIndex = game.map.siteInstanceIds.indexOf(game.startLocation.instance.instanceId);
    expect(game.map.sites[startIndex].onCoastRing, '漂着地点は海岸（外周リング）の土地').toBe(true);
  });

  it('探索ですべての道が見つかり、その後の移動でプレイヤーと時間が進む', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const session = game.session;
    const start = game.startLocation;
    const actor = game.player.instance;

    const startIndex = game.map.siteInstanceIds.indexOf(start.instance.instanceId);
    const degree = game.map.edges.filter((e) => e.a === startIndex || e.b === startIndex).length;
    expect(degree, '開始地点にも必ず道がある(MSTの連結性)').toBeGreaterThanOrEqual(1);

    // 探索率100%まで繰り返す。途中(上限-1以前)ですべての道が見つかる。
    for (let i = 0; i < start.explorationProgressMax; i++)
      expect(start.explore(actor, session), '探索できる土地なので毎回成立する').toBe(true);

    expect(start.explorationProgress, '探索率100%に達している').toBe(start.explorationProgressMax);
    expect(pathsIn(start, codex).length, '探索でこの土地のすべての道が見つかる').toBe(degree);

    // 見つかった道で移動する。
    const path = new Path(pathsIn(start, codex)[0], codex.propertyNames);
    const minutesBefore = totalMinutes(game.world);

    expect(path.travel(actor, session)).toBe(true);

    expect(actor.parent!.instanceId, 'プレイヤーは道の行き先の土地へ移る').toBe(path.destinationInstanceId);
    expect(new Location(actor.parent!, codex).characters, '移動先ではcharactersスロットに入る').toContain(
      actor,
    );
    expect(totalMinutes(game.world) - minutesBefore, '移動時間の分だけゲーム内時間が進む').toBe(
      path.travelMinutes,
    );
  });

  it('IslandMapは実体化された土地のinstanceIdから命名処理の付けた名前を引ける', () => {
    const game = startNewGame(codex, 13, new SeededRng(99));

    for (const site of game.map.sites)
      expect(game.map.nameOfInstance(game.map.siteInstanceIds[site.index])).toBe(site.name);

    expect(game.map.nameOfInstance(0), '未実体化を表す0は該当なし').toBeUndefined();
    expect(game.map.nameOfInstance(-1), '未知のinstanceIdは該当なし').toBeUndefined();
  });

  it('同じシードなら、WorldSession.rngのシードが異なっても同じ島レイアウトになる', () => {
    // 地形レイアウト(IslandMap)はシードのみに依存し、WorldSession.rng（pick抽選など）には
    // 依存しない: rngのシードを変えても同じ島になる。
    const first = startNewGame(codex, 21, new SeededRng(1));
    const second = startNewGame(codex, 21, new SeededRng(2));

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
