import type { SaveData } from './SaveData';
import { toSaveData } from './SaveData';
import { SaveSlotIndexError } from './SaveSlotIndexError';

/** スロット数は4固定（SaveDataManagement.md スロットの空き・削除節）。 */
export const SLOT_COUNT = 4;

const KEY_PREFIX = 'unmapped-island:save:';

/**
 * 4スロット固定のセーブデータ置き場。
 *
 * 一覧表示用のサマリーはスロット本体と別に持たない。持つと「本体を更新したらサマリーも更新する」
 * 手順を呼び出し側が覚える必要が生じるため（SaveDataManagement.md 保存先節）。
 * 空き判定はキーの不在だけで行い、別途「空きフラグ」は持たない。
 *
 * 保存先はコンストラクタで受け取る。ブラウザではlocalStorage、テストではメモリ上の実装を渡す。
 */
export class SaveSlots {
  private readonly storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  /** 全スロットを添字順に読む。空きスロット・壊れたデータはundefinedになる。 */
  readAll(): readonly (SaveData | undefined)[] {
    const slots: (SaveData | undefined)[] = [];
    for (let index = 0; index < SLOT_COUNT; index++) slots.push(this.read(index));
    return slots;
  }

  /** スロットを読む。空き・壊れたデータ（他タブや手動編集で壊れうる）はundefined。 */
  read(slotIndex: number): SaveData | undefined {
    const raw = this.storage.getItem(SaveSlots.keyOf(slotIndex));
    if (raw === null) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    return toSaveData(parsed);
  }

  write(slotIndex: number, data: SaveData): void {
    this.storage.setItem(SaveSlots.keyOf(slotIndex), JSON.stringify(data));
  }

  /** 削除は該当スロットのキーを消すだけで、他スロットに影響しない。 */
  delete(slotIndex: number): void {
    this.storage.removeItem(SaveSlots.keyOf(slotIndex));
  }

  private static keyOf(slotIndex: number): string {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= SLOT_COUNT) {
      throw new SaveSlotIndexError(`スロット番号 ${slotIndex} は 0〜${SLOT_COUNT - 1} の範囲外です。`);
    }
    return `${KEY_PREFIX}${slotIndex}`;
  }
}
