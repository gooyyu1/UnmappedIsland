import { readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/** レーンの背景画像の置き場所（src/game/ui/laneArt.ts の規約）。 */
const ART_DIR = 'src/assets/lanes';

/** 土地ごとに絵が変わるレーンのディレクトリ。laneArt.LocationLane と一致していなければならない。 */
const LOCATION_LANES = ['field_item', 'location'];

/**
 * 絵の解決は「ディレクトリ名＝レーン、ファイル名＝土地のobject_defの識別子」という規約だけで
 * 成り立っており、コード側に対応表が無い。名前を間違えた絵は黙って使われないまま残るため、
 * ここで実在の土地かどうかを検査する（objectArt.test.tsと同じ考え方）。
 */
describe('レーンの背景画像', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  function laneDirectories(): string[] {
    return readdirSync(ART_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }

  function locationNames(lane: string): string[] {
    return readdirSync(`${ART_DIR}/${lane}`)
      .filter((file) => file.endsWith('.png'))
      .map((file) => file.slice(0, -'.png'.length));
  }

  it('ディレクトリは、土地ごとに絵が変わるレーンのものだけ', () => {
    expect(laneDirectories()).toEqual(LOCATION_LANES);
  });

  it('ファイル名は、locationタグを持つ実在のobject_defの識別子である', () => {
    const locationTag = codex.tagNames.getId('location');
    let checked = 0;

    for (const lane of LOCATION_LANES) {
      for (const name of locationNames(lane)) {
        const globalId = codex.objectNames.tryGetId(name);
        expect(globalId, `'${lane}/${name}.png' に対応するobject_defが無い`).toBeDefined();
        if (globalId === undefined) continue;

        expect(
          codex.objects.get(globalId).tags,
          `'${lane}/${name}.png' のobject_defは土地ではない`,
        ).toContain(locationTag);
        checked += 1;
      }
    }
    expect(checked, '検査対象が無い（置き場所が変わっていないか）').toBeGreaterThan(0);
  });

  it('ファイル名は識別子の命名規則（3.2節）に従う', () => {
    for (const lane of LOCATION_LANES) {
      for (const name of locationNames(lane)) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});
