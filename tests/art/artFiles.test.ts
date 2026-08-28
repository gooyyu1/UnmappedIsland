import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { BACKGROUND_ART } from '../../src/art/backgroundArt';
import { ART_BY_NAME } from '../../src/art/objectArt';
import {
  commonArtFiles,
  locationArtFiles,
  locationCardArtFiles,
  locationNamesWithBackgroundArt,
} from '../../src/art/artFiles';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 遅延ロードの単位分け（artFiles）の検査。土地の絵と起動時の絵は、重複せず・漏れなく全アセットを
 * 覆っていなければならない——漏れた絵は誰にもロードされないまま黙って使われなくなるため。
 */
describe('土地の絵の単位分け', () => {
  let codex: WorldCodex;
  let locations: readonly string[];

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    locations = locationNamesWithBackgroundArt(codex);
  });

  it('locationDefNamesは土地だけを返す（道・アイテムは含まない）', () => {
    expect(locations).toContain('sandy_beach');
    expect(locations).toContain('jungle');
    expect(locations).not.toContain('path');
    expect(locations).not.toContain('coconut');
    expect(locations).not.toContain('medic');
  });

  it('土地の絵は、その土地のカードの絵と背景だけを含む', () => {
    const files = locationArtFiles(codex, 'sandy_beach');
    const keys = files.map((file) => file.key);
    expect(keys).toContain('object:sandy_beach');
    expect(keys).toContain('background:sandy_beach_fixtures_lane');
    expect(keys).toContain('background:sandy_beach_items_lane');
    expect(keys).toContain('background:sandy_beach_fixtures_card');
    expect(keys).toHaveLength(4);
  });

  it('絵が1枚も無い土地では空になる（ロード待ちが即座に成立する）', () => {
    expect(locationArtFiles(codex, 'no_such_location')).toHaveLength(0);
    expect(locationCardArtFiles(codex, 'no_such_location')).toHaveLength(0);
  });

  it('土地カードの絵は、土地の絵の一部として数えられている（先読みしても二重ロードにならない）', () => {
    const cardArt = locationCardArtFiles(codex, 'sandy_beach');
    expect(cardArt.map((file) => file.key)).toEqual(['object:sandy_beach']);

    const allKeys = locationArtFiles(codex, 'sandy_beach').map((file) => file.key);
    for (const { key } of cardArt) expect(allKeys).toContain(key);
  });

  it('起動時の絵と全土地の絵は、重複せず全アセットを覆う', () => {
    const common = commonArtFiles(codex, locations).map((file) => file.key);
    const perLocation = locations.flatMap((l) => locationArtFiles(codex, l).map((file) => file.key));

    const all = [...common, ...perLocation];
    expect(new Set(all).size, '同じ絵が両方に入っている').toBe(all.length);

    const covered = new Set(all);
    for (const name of ART_BY_NAME.keys()) {
      expect(covered.has(`object:${name}`), `'${name}' の絵がどちらにも入っていない`).toBe(true);
    }
    for (const key of BACKGROUND_ART.keys()) {
      expect(covered.has(key), `'${key}' がどちらにも入っていない`).toBe(true);
    }
  });

  it('キャラクターと手持ちレーンの背景は起動時に読まれる', () => {
    const common = commonArtFiles(codex, locations).map((file) => file.key);
    expect(common).toContain('object:medic');
    expect(common).toContain('background:hand_lane');
  });
});

/**
 * 1枚の絵を複数の型で共有する宣言（`art`、GameElementDefinition.md 4.3節）を土地が使ったときの
 * 単位分け。同梱の土地はどれも`art`を宣言していないので、ここだけ合成のcodexで見る。
 */
describe('artを宣言した土地の絵', () => {
  /**
   * 借りるのは在庫の名前だけ（`src/assets/objects/<絵の名前>.png`）。絵の有無で出し分ける規約を
   * 確かめるには実在するファイル名が要る。土地の識別子（LAND）とは別の名前であることだけが要る。
   */
  const [SHARED_ART] = [...ART_BY_NAME.keys()].sort();

  /** 背景の在庫（`src/assets/backgrounds/`）を借りるため、識別子は同梱の土地から取る。 */
  const LAND = 'sandy_beach';

  const codex = new WorldCodexYamlLoader()
    .load(
      'land.yaml',
      `
object_defs:
  ${LAND}:
    tags: [location]
    art: ${SHARED_ART}
`,
    )
    .buildAndReset();

  it('土地カードの絵は、識別子ではなく絵の名前で引かれる', () => {
    expect(locationCardArtFiles(codex, LAND).map((file) => file.key)).toEqual([`object:${SHARED_ART}`]);
  });

  it('その絵は起動時ではなく、土地の絵として読まれる', () => {
    const perLocation = locationArtFiles(codex, LAND).map((file) => file.key);
    expect(perLocation).toContain(`object:${SHARED_ART}`);
    expect(perLocation).toContain(`background:${LAND}_fixtures_lane`);

    const common = commonArtFiles(codex, [LAND]).map((file) => file.key);
    expect(common).not.toContain(`object:${SHARED_ART}`);
  });
});
