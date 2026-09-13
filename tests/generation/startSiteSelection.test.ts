import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { startupNeedSourcesOf } from '../../src/analysis/startupReach';
import type { IslandMap, Site } from '../../src/domain/generation/IslandMap';
import { startNewGame } from '../../src/domain/generation/NewGame';
import type { SiteStartupReach } from '../../src/domain/generation/StartSiteSelection';
import {
  islandStartupReachOf,
  selectStartSite,
  startupNeedSuppliersOf,
} from '../../src/domain/generation/StartSiteSelection';
import { generateIsland } from '../../src/domain/generation/TerrainGenerator';
import { seededRng } from '../../src/domain/Rng';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import {
  bundledCodex,
  SAMPLE_CHARACTER,
  worldCodexPath,
  worldCodexYamlPaths,
} from '../support/worldCodexFiles';

/**
 * 開始地点の選抜（ContentSkeleton.md 2.3節）。**見るのは「並び順ではなく歩数で選んでいるか」**で、
 * 歩数そのものの分布は `tests/diagnostics/startupReachStatsReport.test.ts` が測る。
 */
describe('開始地点の選抜', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = bundledCodex();
  });

  const SEED_COUNT = 200;
  const BEACH = 'sandy_beach';

  function islandOf(seed: number): IslandMap {
    return generateIsland(codex.generation, 'island', seed);
  }

  function beachesOf(map: IslandMap): readonly Site[] {
    return map.sites.filter((site) => site.type!.name === BEACH);
  }

  /** 開始地点に選ぶなら、こちらの方が良いと言える形。選抜が並べる順そのもの。 */
  function isBetterStart(candidate: SiteStartupReach, incumbent: SiteStartupReach): boolean {
    if (candidate.unreachableNeedCount !== incumbent.unreachableNeedCount)
      return candidate.unreachableNeedCount < incumbent.unreachableNeedCount;

    const a = candidate.farthestNeed;
    const b = incumbent.farthestNeed;
    if (a === undefined || b === undefined) return a !== undefined;
    if (a.hops !== b.hops) return a.hops < b.hops;
    return a.travelMinutes < b.travelMinutes;
  }

  it('砂浜のうち、要るものが最も近いところから始まる', () => {
    const suppliers = startupNeedSuppliersOf(codex);
    const beaten: string[] = [];

    for (let seed = 0; seed < SEED_COUNT; seed++) {
      const map = islandOf(seed);
      const beaches = beachesOf(map);
      if (beaches.length === 0) continue;

      const reach = islandStartupReachOf(suppliers, map);
      const chosen = reach.sites[selectStartSite(codex, map).index];
      expect(chosen.locationDefName, `種${seed}: 砂浜が在るなら砂浜から始まる`).toBe(BEACH);

      for (const beach of beaches)
        if (isBetterStart(reach.sites[beach.index], chosen))
          beaten.push(`種${seed}: サイト${beach.index}の方が近い`);
    }

    expect(beaten, 'この砂浜の方が要るものへ近いのに、選ばれていない').toEqual([]);
  });

  it('砂浜の並び順の先頭を採っているのではない', () => {
    // **並び順で採る実装へ戻すとここが落ちる。** 上の検査は「最も近いものが選ばれている」を見るが、
    // 並び順の先頭がたまたま最も近い島だけを並べても通ってしまう。
    let differed = 0;
    let compared = 0;

    for (let seed = 0; seed < SEED_COUNT; seed++) {
      const map = islandOf(seed);
      const beaches = beachesOf(map);
      if (beaches.length < 2) continue;

      compared++;
      if (selectStartSite(codex, map).index !== beaches[0].index) differed++;
    }

    expect(compared, '砂浜が2つ以上ある島が比べる対象になる').toBeGreaterThan(0);
    expect(differed, '並び順の先頭とは違う砂浜を選んだ島が1つも無い').toBeGreaterThan(0);
  });

  it('砂浜の無い島では、外周リング（海岸）から始まる', () => {
    const seed = Array.from({ length: SEED_COUNT }, (_, i) => i).find(
      (candidate) => beachesOf(islandOf(candidate)).length === 0,
    );
    expect(seed, '砂浜の無い島が標本に無い（この検査が何も見ていない）').toBeDefined();

    const start = selectStartSite(codex, islandOf(seed!));
    expect(start.onCoastRing, `種${seed}: 漂着地は海岸の土地`).toBe(true);
  });

  it('実体化したゲームのプレイヤーは、選抜が選んだ土地に居る', () => {
    for (const seed of [3, 8, 11]) {
      const game = startNewGame(codex, SAMPLE_CHARACTER, seed, seededRng(99));
      const start = game.island.siteOf(game.startLocation.instance.instanceId);

      expect(start?.index, `種${seed}: placePlayerは選抜が選んだサイトへ置く`).toBe(
        selectStartSite(codex, game.island.map).index,
      );
    }
  });
});

/**
 * 要るものの表（ContentSkeleton.md 2.3節）と locations.yaml の突き合わせ。**選抜と測定は別の面から
 * 同じ表を読む**ので、見張りも両側に要る——選抜は宣言（何が生まれうるか）を、測定は重み（1回あたり
 * 何個か）を見ており、どちらか片方だけが食い違うことがありうる。
 */
describe('要るものの出どころ', () => {
  /** locations.yamlの字面だけを差し替えたコーデックス。 */
  function codexWithLocations(edit: (text: string) => string): WorldCodex {
    const locations = worldCodexPath('locations.yaml');
    const loader = new WorldCodexYamlLoader();
    for (const path of worldCodexYamlPaths()) {
      const text = readFileSync(path, 'utf8');
      loader.load(path, path === locations ? edit(text) : text);
    }
    return loader.buildAndReset();
  }

  it('採れる土地が1つも無ければ、島を測る前に投げる', () => {
    // 選抜は「ここで採れる」を宣言から読むので、宣言が消えたことに気づかないまま別の物を見て
    // 選ぶことになる。
    const codex = codexWithLocations((text) => text.replaceAll('object: dry_grass', 'object: twig'));

    expect(() => startupNeedSuppliersOf(codex)).toThrow('火口');
  });

  it('採れると宣言している土地の期待個数が0なら投げる', () => {
    // 宣言は残っているので選抜はそこを数えるが、実際には引けない。**宣言と重みが食い違ったことに
    // 気づけるのは、両方を見ている解析側だけ**（重みを確率へ直すのは近似なので、ドメインには
    // 置けない。CodeStructure.md 5節）。
    const codex = codexWithLocations((text) =>
      text.replace('      spring_find:\n        value: 10', '      spring_find:\n        value: 0'),
    );

    expect(() => startupNeedSourcesOf(codex)).toThrow('期待個数が0');
  });
});
