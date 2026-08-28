import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { StartedGame } from '../../src/domain/generation/NewGame';
import { startNewGame } from '../../src/domain/generation/NewGame';
import { randomRng, seededRng } from '../../src/domain/Rng';
import { initialSeed, parseLaunchSeed, setLaunchSeed } from '../../src/game/launchSeed';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 起動URL（`?seed=`）から島が決まるまでの通し試験。
 *
 * 変更前と変更後のスクリーンショットを並べられるのは、**同じURLで開けば画面に出るものが
 * 全部同じになる**ときだけなので、地形だけでなく開始時刻・漂着地まで一致することを見る
 * （実データに依存する。開始時刻はcore.yamlのminutes_per_tick刻みで抽選される）。
 */
describe('起動URLで固定した種から始めるゲーム（通し）', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  });

  /** 新規ゲーム作成画面と同じ経路（初期値の種をそのまま使う）で1ゲーム始める。 */
  function startFromLaunchUrl(search: string): StartedGame {
    setLaunchSeed(parseLaunchSeed(search));
    try {
      const seed = initialSeed(randomRng());
      return startNewGame(codex, SAMPLE_CHARACTER, seed, seededRng(seed));
    } finally {
      // モジュールに残した値は次のテストファイルにも見える（vitest.config.tsのisolate: false）。
      setLaunchSeed(undefined);
    }
  }

  it('同じURLで2回始めると、島も開始時刻も漂着地も同じになる', () => {
    const first = startFromLaunchUrl('?seed=12345');
    const second = startFromLaunchUrl('?seed=12345');

    expect(fingerprint(second)).toBe(fingerprint(first));
  });

  it('URLで種を渡さなければ、始めるたびに違う島になる', () => {
    const islands = new Set<string>();
    for (let i = 0; i < 8; i++) islands.add(fingerprint(startFromLaunchUrl('')));

    expect(islands.size, 'URLの指定が無いときは今までどおり毎回引き直す').toBeGreaterThan(1);
  });
});

/** 開始直後の状態のうち、画面に出るもの（島・時刻・漂着地）の指紋。 */
function fingerprint(game: StartedGame): string {
  const world = game.world;
  const sites = game.map.sites.map(
    (site) => `${site.index}:(${site.x.toFixed(6)},${site.y.toFixed(6)})${site.type!.name}/${site.name!.key}`,
  );
  const edges = game.map.edges.map((edge) => `${edge.a}-${edge.b}:${edge.travelMinutes.toFixed(3)}`);
  return [
    `seed=${game.map.seed}`,
    `time=${world.day}/${world.hour}:${world.minute}`,
    `start=site${game.map.siteInstanceIds.indexOf(game.startLocation.instance.instanceId)}`,
    ...sites,
    ...edges,
  ].join('\n');
}
