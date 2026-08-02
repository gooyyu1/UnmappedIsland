import type { LocationTypeDef } from '../defs/generation/LocationTypeDef';

/**
 * Site（TerrainGeneration.md 1節）: 座標と軸ベクトルを持つ、生成途中のノード。
 * パイプラインが進むにつれてLocationType・名前が確定し、最終的にIslandSpawnerが
 * Location（object_defのWorldObjectインスタンス）として実体化する。
 */
export class Site {
  readonly index: number;
  readonly x: number;
  readonly y: number;

  /** 島の外周リング（海岸帯へクランプされる配置枠）として置かれたサイトか。 */
  readonly onCoastRing: boolean;

  /** 軸名→軸値（0〜100等、AxisDef.rangeへ量子化済みの整数）。 */
  readonly axisValues = new Map<string, number>();

  /** マッチング（LocationTypeMatcher）で確定するLocationType。 */
  type?: LocationTypeDef;

  /** 命名処理（NameAssigner）で確定する表示名（例: 「草原」「花咲く草原」）。 */
  name?: string;

  constructor(index: number, x: number, y: number, onCoastRing: boolean) {
    this.index = index;
    this.x = x;
    this.y = y;
    this.onCoastRing = onCoastRing;
  }

  distanceTo(other: Site): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

/** 土地同士を繋ぐ道1本（無向辺）。travelMinutesは距離と両端の移動コストから確定済み。 */
export class IslandEdge {
  readonly a: number;
  readonly b: number;
  readonly distance: number;
  readonly travelMinutes: number;

  constructor(a: number, b: number, distance: number, travelMinutes: number) {
    this.a = a;
    this.b = b;
    this.distance = distance;
    this.travelMinutes = travelMinutes;
  }
}

/**
 * 地形生成の結果（サイト・型・命名・パスネットワーク）を表す不変のデータ。
 * TerrainGenerator.generateの出力であり、WorldObjectには一切触れない純粋な計算結果。
 * 世界への実体化（spawn）はIslandSpawnerがこのデータを読んで行い、その際に
 * siteInstanceIds（サイトindex→生成されたWorldObject.instanceId）を書き込む。
 */
export class IslandMap {
  readonly scopeName: string;
  readonly seed: number;
  readonly sites: readonly Site[];
  readonly edges: readonly IslandEdge[];

  /** サイトindex→実体化されたLocationのWorldObject.instanceId（IslandSpawnerが埋める。
   * 未実体化なら0）。 */
  readonly siteInstanceIds: number[];

  constructor(scopeName: string, seed: number, sites: readonly Site[], edges: readonly IslandEdge[]) {
    this.scopeName = scopeName;
    this.seed = seed;
    this.sites = sites;
    this.edges = edges;
    this.siteInstanceIds = new Array<number>(sites.length).fill(0);
  }

  /**
   * 実体化されたLocationのinstanceIdから、命名処理（NameAssigner）が付けた名前を引く。
   * 土地の名前はインスタンスごとに決まる（同じobject_defでも「花咲く草原」「露の草原」）ため、
   * 型側ではなくこちらが唯一の出所になる。未実体化・未知のIDならundefined。
   */
  nameOfInstance(instanceId: number): string | undefined {
    // 未実体化のsiteInstanceIdsは0のまま。instanceIdの発行は1始まりなので、0は必ず「該当なし」。
    if (instanceId === 0) return undefined;

    const index = this.siteInstanceIds.indexOf(instanceId);
    return index < 0 ? undefined : this.sites[index].name;
  }
}
