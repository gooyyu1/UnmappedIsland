import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { BACKGROUND_ART } from '../../src/game/ui/backgroundArt';
import { OBJECT_ART } from '../../src/game/ui/objectArt';
import {
  commonArtFiles,
  locationArtFiles,
  locationCardArtFiles,
  locationDefNames,
} from '../../src/game/ui/locationArt';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 遅延ロードの単位分け（locationArt）の検査。土地の絵と起動時の絵は、重複せず・漏れなく全アセットを
 * 覆っていなければならない——漏れた絵は誰にもロードされないまま黙って使われなくなるため。
 */
describe('土地の絵の単位分け', () => {
  let codex: WorldCodex;
  let locations: readonly string[];

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    locations = locationDefNames(codex);
  });

  it('locationDefNamesは土地だけを返す（道・アイテムは含まない）', () => {
    expect(locations).toContain('sandy_beach');
    expect(locations).toContain('jungle');
    expect(locations).not.toContain('path');
    expect(locations).not.toContain('coconut');
    expect(locations).not.toContain('medic');
  });

  it('土地の絵は、その土地のカードの絵と背景だけを含む', () => {
    const files = locationArtFiles('sandy_beach');
    const keys = files.map((file) => file.key);
    expect(keys).toContain('object:sandy_beach');
    expect(keys).toContain('background:sandy_beach_fixtures_lane');
    expect(keys).toContain('background:sandy_beach_items_lane');
    expect(keys).toContain('background:sandy_beach_fixtures_card');
    expect(keys).toHaveLength(4);
  });

  it('絵が1枚も無い土地では空になる（ロード待ちが即座に成立する）', () => {
    expect(locationArtFiles('no_such_location')).toHaveLength(0);
    expect(locationCardArtFiles('no_such_location')).toHaveLength(0);
  });

  it('土地カードの絵は、土地の絵の一部として数えられている（先読みしても二重ロードにならない）', () => {
    const cardArt = locationCardArtFiles('sandy_beach');
    expect(cardArt.map((file) => file.key)).toEqual(['object:sandy_beach']);

    const allKeys = locationArtFiles('sandy_beach').map((file) => file.key);
    for (const { key } of cardArt) expect(allKeys).toContain(key);
  });

  it('起動時の絵と全土地の絵は、重複せず全アセットを覆う', () => {
    const common = commonArtFiles(locations).map((file) => file.key);
    const perLocation = locations.flatMap((l) => locationArtFiles(l).map((file) => file.key));

    const all = [...common, ...perLocation];
    expect(new Set(all).size, '同じ絵が両方に入っている').toBe(all.length);

    const covered = new Set(all);
    for (const name of OBJECT_ART.keys()) {
      expect(covered.has(`object:${name}`), `'${name}' の絵がどちらにも入っていない`).toBe(true);
    }
    for (const key of BACKGROUND_ART.keys()) {
      expect(covered.has(key), `'${key}' がどちらにも入っていない`).toBe(true);
    }
  });

  it('キャラクターと手持ちレーンの背景は起動時に読まれる', () => {
    const common = commonArtFiles(locations).map((file) => file.key);
    expect(common).toContain('object:medic');
    expect(common).toContain('background:hand_lane');
  });
});
