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

  private readonly landsBySite: ReadonlyMap<Site, WorldObject>;
  private readonly sitesByLandInstanceId: ReadonlyMap<number, Site>;

  /** landsBySiteは、サイトとそこから湧いた土地の1対1（mapのすべてのサイトのぶんが要る）。 */
  constructor(map: IslandMap, landsBySite: ReadonlyMap<Site, WorldObject>) {
    const missing = map.sites.filter((site) => !landsBySite.has(site));
    if (missing.length > 0 || landsBySite.size !== map.sites.length)
      throw new Error(
        `実体化された島は全サイトの土地を要する: サイト${map.sites.length}件に対し土地${landsBySite.size}件` +
          `（土地の無いサイト${missing.length}件）。`,
      );

    this.map = map;
    this.lands = map.sites.map((site) => ({ site, land: landsBySite.get(site)! }));
    // 写し取る。渡した側が後から足せると、コンストラクタで確かめた1対1がそこで破れる。
    this.landsBySite = new Map(landsBySite);
    this.sitesByLandInstanceId = new Map(this.lands.map(({ site, land }) => [land.instanceId, site]));
  }

  /** そのサイトから湧いた土地。この島のサイトでなければ投げる（index が偶然合うだけの他島のSiteを含む）。 */
  landOf(site: Site): WorldObject {
    const land = this.landsBySite.get(site);
    if (land === undefined) throw new Error(`サイト${site.index}はこの島のサイトではありません。`);

    return land;
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
