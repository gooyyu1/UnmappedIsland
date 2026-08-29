/**
 * セーブデータの形式バージョン（SaveDataManagement.md セーブデータのスキーマ節）。
 * 2でpinnedStatuses、3でmapCardPositions、4でassetPacksを足した（toSaveData参照）。
 */
export const SAVE_SCHEMA_VERSION = 4;

/** 島の名前の長さ制限。 */
export const ISLAND_NAME_MAX_LENGTH = 20;

/** 乱数シードの値域。地形生成が消費するPcg32が`seed >>> 0`で扱うため符号なし32bit整数。 */
export const SEED_MAX = 4294967295;

/**
 * 地図画面でユーザが置いた土地カード1枚の位置。siteは地形生成のサイトindex
 * （IslandMap.sites。同じシードなら同じ土地を指し続ける恒久キー）で、
 * x/yは画面に対する0〜1の正規化座標（カード中心）。
 */
export interface MapCardPosition {
  readonly site: number;
  readonly x: number;
  readonly y: number;
}

/**
 * セーブを作ったときに入っていたアセットパック1つ（AssetPack.md 6.4節）。`id`・`version` は
 * パック自身の名乗り（`pack.yaml`）で、版まで見るのは、版が上がれば定義が変わりうるため。
 */
export interface SavedAssetPack {
  readonly id: string;
  readonly version: string;
}

/** 1スロット分のセーブデータ。 */
export interface SaveData {
  readonly schemaVersion: number;
  readonly islandName: string;
  readonly seed: number;
  readonly characterId: string;
  /** 作成日時（UNIX時間・ミリ秒）。 */
  readonly createdAt: number;
  /** 生存日数。ワールド状態の経過時間から求まる値で、表示専用の複製ではない。 */
  readonly elapsedDays: number;

  /**
   * ユーザが固定表示にしたステータス（プロパティの識別子）。安全域でもステータスエリアへ出し続ける
   * （StatusArea.md）。
   */
  readonly pinnedStatuses: readonly string[];

  /** ユーザが地図画面で置いた土地カードの位置（Windows.md 7節 地図ウィンドウ）。 */
  readonly mapCardPositions: readonly MapCardPosition[];

  /**
   * 作ったときに入っていたアセットパック（読み込んだ順。同梱ぶんだけで作ったセーブは空）。
   * 今入っているものと食い違うスロットは開かない（AssetPack.md 6.4節、savedAssetPacks.ts）。
   */
  readonly assetPacks: readonly SavedAssetPack[];
}

/**
 * 保存された任意の値をSaveDataとして読む（読めない値はundefined）。localStorageの中身は他のタブ・
 * 旧バージョン・手動編集で壊れうるため、読み出し側で必ず通す。
 *
 * pinnedStatuses・mapCardPositions・assetPacksを持たない古いセーブ（形式バージョン1〜3）は
 * 「無し」として読む。判定ではなく変換を返すのは、こうした欠けたフィールドの補完をここ1か所で
 * 済ませるため。
 */
export function toSaveData(value: unknown): SaveData | undefined {
  if (typeof value !== 'object' || value === null) return undefined;

  const {
    schemaVersion,
    islandName,
    seed,
    characterId,
    createdAt,
    elapsedDays,
    pinnedStatuses,
    mapCardPositions,
    assetPacks,
  } = value as Record<string, unknown>;
  if (
    typeof schemaVersion !== 'number' ||
    typeof islandName !== 'string' ||
    typeof seed !== 'number' ||
    typeof characterId !== 'string' ||
    typeof createdAt !== 'number' ||
    typeof elapsedDays !== 'number'
  )
    return undefined;

  const packs = toSavedAssetPacks(assetPacks);
  if (packs === undefined) return undefined;

  return {
    schemaVersion,
    islandName,
    seed,
    characterId,
    createdAt,
    elapsedDays,
    pinnedStatuses: Array.isArray(pinnedStatuses)
      ? pinnedStatuses.filter((key): key is string => typeof key === 'string')
      : [],
    mapCardPositions: Array.isArray(mapCardPositions) ? mapCardPositions.filter(isMapCardPosition) : [],
    assetPacks: packs,
  };
}

/**
 * assetPacksを読む。欄が無い古いセーブ（形式バージョン3まで）は「同梱ぶんだけで作られた」＝空。
 *
 * **壊れた要素が1つでもあれば、そのセーブごと読めないものとして扱う**（undefined）。この欄だけは
 * 開いてよいかの判定に使う（AssetPack.md 6.4節）ので、読めた分だけを残すと、実際とは違う並びと
 * 一致して、別の島が出るスロットが開いてしまう。
 */
function toSavedAssetPacks(value: unknown): readonly SavedAssetPack[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  return value.every(isSavedAssetPack) ? (value as readonly SavedAssetPack[]) : undefined;
}

function isSavedAssetPack(value: unknown): value is SavedAssetPack {
  if (typeof value !== 'object' || value === null) return false;

  const { id, version } = value as Record<string, unknown>;
  return typeof id === 'string' && typeof version === 'string';
}

function isMapCardPosition(value: unknown): value is MapCardPosition {
  if (typeof value !== 'object' || value === null) return false;

  const { site, x, y } = value as Record<string, unknown>;
  return typeof site === 'number' && typeof x === 'number' && typeof y === 'number';
}
