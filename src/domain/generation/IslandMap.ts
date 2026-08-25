import type { LocationTypeDef, LocationVariantDef } from './LocationTypeDef';

/**
 * 土地の名前（TerrainGeneration.md 3.6節）。**表示文字列ではなく構成要素で持つ**——WorldCodexは
 * 識別子だけを持ち、画面に出す文字列はlocaleが持つという規約（Localization.md）に従うため。
 * 組み立ては `Localization.locationName` が行う。
 */
export class LocationName {
  /** 土地の型の識別子。亜種を持たない土地は、これだけで名前になる。 */
  readonly typeName: string;

  /** 同じ型が島に複数あるときの亜種の識別子。 */
  readonly variantId: string | undefined;

  /** 亜種が尽きたときだけ持つ通し番号（1始まり）。名前の重複を避けるための最後の手段。 */
  readonly ordinal: number | undefined;

  constructor(typeName: string, variantId?: string, ordinal?: number) {
    this.typeName = typeName;
    this.variantId = variantId;
    this.ordinal = ordinal;
  }

  /** 表示ではなく同一性の比較・重複検査に使うキー。 */
  get key(): string {
    return `${this.typeName}/${this.variantId ?? ''}/${this.ordinal ?? ''}`;
  }
}

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

  /** 命名処理（NameAssigner）で確定する名前。表示文字列ではなく構成要素で持つ（LocationName参照）。 */
  name?: LocationName;

  /**
   * 命名処理（NameAssigner）で確定する亜種。同じ型が島に1つだけならundefined（素の土地）。
   * 実体化のとき、IslandSpawnerがこの亜種のプロパティを土地へ書き込む。
   */
  variant?: LocationVariantDef;

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

/** 土地同士を繋ぐ道1本（無向辺）。travelMinutesは距離・両端の移動コスト・高低差から確定済み
 * （TerrainGeneration.md 3.5節）。 */
export class IslandEdge {
  readonly a: number;
  readonly b: number;
  readonly distanceMeters: number;
  readonly travelMinutes: number;

  constructor(a: number, b: number, distanceMeters: number, travelMinutes: number) {
    this.a = a;
    this.b = b;
    this.distanceMeters = distanceMeters;
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
  nameOfInstance(instanceId: number): LocationName | undefined {
    // 未実体化のsiteInstanceIdsは0のまま。instanceIdの発行は1始まりなので、0は必ず「該当なし」。
    if (instanceId === 0) return undefined;

    const index = this.siteInstanceIds.indexOf(instanceId);
    return index < 0 ? undefined : this.sites[index].name;
  }
}
