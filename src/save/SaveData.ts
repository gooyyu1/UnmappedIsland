/** セーブデータの形式バージョン（SaveDataManagement.md セーブデータのスキーマ節）。 */
export const SAVE_SCHEMA_VERSION = 1;

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
}

/**
 * 保存された任意の値をSaveDataとして読めるか検査する。localStorageの中身は他のタブ・
 * 旧バージョン・手動編集で壊れうるため、読み出し側で必ず通す。
 */
export function isSaveData(value: unknown): value is SaveData {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.schemaVersion === 'number' &&
    typeof candidate.islandName === 'string' &&
    typeof candidate.seed === 'number' &&
    typeof candidate.characterId === 'string' &&
    typeof candidate.createdAt === 'number' &&
    typeof candidate.elapsedDays === 'number'
  );
}
