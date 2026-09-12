import type { WorldObject } from '../WorldObject';
import type { IslandMap, LocationName, Site } from './IslandMap';

/** サイト1つと、そこから湧いた土地。 */
export interface SpawnedLand {
  readonly site: Site;
  readonly land: WorldObject;
}

/**
 * 世界へ実体化された島（spawnIslandIntoWorldの出力）。地形生成の結果（IslandMap）と、そこから
 * 湧いた土地のWorldObjectの対応を1つに束ねる。
 *
 * **対応は実体化と同時に出来上がる**——コンストラクタがサイトの数だけ土地を要求するので、
 * 「まだ実体化していないサイト」という状態が無い。読む側は「サイト→instanceId→WorldObject」を
 * 自分で辿らず、サイトの土地・土地のサイト・土地の名前をここへ訊く。
 */
export class SpawnedIsland {
  /** 実体化のもとになった地形生成の結果。 */
  readonly map: IslandMap;

  /** サイトとその土地の対を、サイトindexの順に並べたもの。 */
  readonly lands: readonly SpawnedLand[];

  private readonly sitesByLandInstanceId: ReadonlyMap<number, Site>;

  /** landsBySiteはサイトindexで引ける、実体化された土地（すべてのサイトのぶんが要る）。 */
  constructor(map: IslandMap, landsBySite: readonly WorldObject[]) {
    if (landsBySite.length !== map.sites.length)
      throw new Error(
        `実体化された島は全サイトの土地を要する: サイト${map.sites.length}件に対し土地${landsBySite.length}件。`,
      );

    this.map = map;
    this.lands = map.sites.map((site) => ({ site, land: landsBySite[site.index] }));
    this.sitesByLandInstanceId = new Map(this.lands.map(({ site, land }) => [land.instanceId, site]));
  }

  /** そのサイトから湧いた土地。 */
  landOf(site: Site): WorldObject {
    if (site.index < 0 || site.index >= this.lands.length)
      throw new Error(`サイト${site.index}はこの島のサイトではありません。`);

    return this.lands[site.index].land;
  }

  /**
   * その土地が湧いたサイト。島の外の場所——筏・海区・本土（voyage.yaml）——や土地でない物なら
   * undefined。
   */
  siteOf(landInstanceId: number): Site | undefined {
    return this.sitesByLandInstanceId.get(landInstanceId);
  }

  /**
   * 命名処理（NameAssigner）がその土地へ付けた名前。土地の名前はインスタンスごとに決まる
   * （同じobject_defでも「花咲く草原」「露の草原」）ため、型側ではなくこちらが唯一の出所になる。
   * 島の外の場所なら（siteOfと同じく）undefined。
   */
  nameOf(landInstanceId: number): LocationName | undefined {
    return this.siteOf(landInstanceId)?.name;
  }
}
