/**
 * セーブデータの形式バージョン（SaveDataManagement.md セーブデータのスキーマ節）。
 * 2でpinnedStatusesを足した（toSaveData参照）。
 */
export const SAVE_SCHEMA_VERSION = 2;

/** 島の名前の長さ制限。 */
export const ISLAND_NAME_MAX_LENGTH = 20;

/** 乱数シードの値域。地形生成が消費するPcg32が`seed >>> 0`で扱うため符号なし32bit整数。 */
export const SEED_MAX = 4294967295;

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
   * （ScreenLayout.md ステータスエリア節）。
   */
  readonly pinnedStatuses: readonly string[];
}

/**
 * 保存された任意の値をSaveDataとして読む（読めない値はundefined）。localStorageの中身は他のタブ・
 * 旧バージョン・手動編集で壊れうるため、読み出し側で必ず通す。
 *
 * pinnedStatusesを持たない古いセーブ（形式バージョン1）は「固定表示なし」として読む。判定ではなく
 * 変換を返すのは、こうした欠けたフィールドの補完をここ1か所で済ませるため。
 */
export function toSaveData(value: unknown): SaveData | undefined {
  if (typeof value !== 'object' || value === null) return undefined;

  const { schemaVersion, islandName, seed, characterId, createdAt, elapsedDays, pinnedStatuses } =
    value as Record<string, unknown>;
  if (
    typeof schemaVersion !== 'number' ||
    typeof islandName !== 'string' ||
    typeof seed !== 'number' ||
    typeof characterId !== 'string' ||
    typeof createdAt !== 'number' ||
    typeof elapsedDays !== 'number'
  )
    return undefined;

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
  };
}
