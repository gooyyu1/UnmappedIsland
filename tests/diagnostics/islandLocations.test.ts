import { describe, expect, it } from 'vitest';
import { activityHoursOf } from '../../src/analysis/activityHours';
import { buildBalanceTables } from '../../src/analysis/balanceTables';
import { islandLocationsOf } from '../../src/analysis/islandLocations';
import { SEASON_CLIMATE } from '../../src/analysis/seasonalRain';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 診断レポートが数える土地の検査（`src/analysis/islandLocations.ts`）。
 *
 * 海区（`voyage.yaml`）は探索できる土地の条件（`location`タグ＋`exploration_progress`）をそのまま
 * 満たすので、**外し損ねても表は正しい形のまま出る**——行が増えるだけで、例外も空の節も起きない
 * （issue #877）。レポートの再生成は `RUN_BALANCE_STATS` の下でしか走らないため、ここで常時見張る。
 *
 * 見るのは**どの場所が行になったかだけ**で、値は見ない。値の妥当性は各解析の単体試験と、再生成した
 * レポートの差分が持つ。
 */
describe('診断レポートが数える土地', () => {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  const { island, excludedSea } = islandLocationsOf(codex);

  // **海かどうかは定義から直に引く**——外した一覧から作ると、線が何も外さなくなったときに
  // 突き合わせる相手ごと空になり、下の表の検査が素通しになる。
  const seaNames = new Set(
    [...codex.objects].filter((def) => def.hasTag(codex.vocabulary.world.seaTagId)).map((def) => def.name),
  );

  it('外した海の場所を挙げている', () => {
    expect(excludedSea.map(({ def }) => def.name)).toEqual([...seaNames]);
  });

  it('島の土地に海が混ざらない', () => {
    expect(island.map((def) => def.name).filter((name) => seaNames.has(name))).toEqual([]);
  });

  it('地形生成が島へ置く土地は、1つも落ちていない', () => {
    // 線を引きすぎたときに気づく側。島を組み立てる型が表から消えたら、分母のほうが欠ける。
    const islandNames = new Set(island.map((def) => def.name));
    const generated = codex.generation!.locationTypes.map(
      (type) => codex.objects.get(type.objectDefGlobalId).name,
    );

    expect(generated.filter((name) => !islandNames.has(name))).toEqual([]);
  });

  it('収支表の土地にも工程にも、海区が現れない', () => {
    const tables = buildBalanceTables(codex, SAMPLE_CHARACTER);

    expect(tables.places.map((place) => place.name).filter((name) => seaNames.has(name))).toEqual([]);
    expect(tables.supply.map((row) => row.ownerName).filter((name) => seaNames.has(name))).toEqual([]);
  }, 600_000);

  it('活動時間表に、海区の行が現れない', () => {
    const rows = activityHoursOf(
      codex,
      SEASON_CLIMATE.map((season) => ({
        seasonName: season.name,
        durationDays: season.durationDays,
        hoursByWeather: new Map(Object.entries(season.hoursByWeather)),
      })),
    );

    expect(rows.map((row) => row.locationName).filter((name) => seaNames.has(name))).toEqual([]);
  });
});
