import { describe, expect, it } from 'vitest';
import { SaveSlots, SLOT_COUNT } from '../../src/save/SaveSlots';
import { SaveSlotIndexError } from '../../src/save/SaveSlotIndexError';
import { createSaveData } from '../../src/save/newGameInput';
import { MemoryStorage } from '../support/MemoryStorage';

function saveOf(islandName: string) {
  return createSaveData(islandName, 12345, 'farmer', 1700000000000);
}

describe('SaveSlots(SaveDataManagement.md)', () => {
  it('書き込んだスロットだけが読め、残りは空きのままになる', () => {
    const slots = new SaveSlots(new MemoryStorage());
    slots.write(2, saveOf('霧深い孤島'));

    expect(slots.readAll()).toHaveLength(SLOT_COUNT);
    expect(slots.read(2)?.islandName).toBe('霧深い孤島');
    expect(slots.read(0)).toBeUndefined();
  });

  it('キーはスロットごとに独立していて、削除しても他スロットに影響しない', () => {
    const storage = new MemoryStorage();
    const slots = new SaveSlots(storage);
    slots.write(0, saveOf('第一の島'));
    slots.write(1, saveOf('第二の島'));

    slots.delete(0);

    expect(slots.read(0)).toBeUndefined();
    expect(slots.read(1)?.islandName).toBe('第二の島');
    expect(storage.getItem('unmapped-island:save:1')).not.toBeNull();
  });

  it('固定表示にしたステータスはスロットごとに残る', () => {
    const slots = new SaveSlots(new MemoryStorage());
    slots.write(0, { ...saveOf('霧深い孤島'), pinnedStatuses: ['hydration', 'body_fat'] });
    slots.write(1, saveOf('第二の島'));

    expect(slots.read(0)?.pinnedStatuses).toEqual(['hydration', 'body_fat']);
    expect(slots.read(1)?.pinnedStatuses).toEqual([]);
  });

  it('固定表示を持たない古い形式のセーブは、固定表示なしとして読める', () => {
    const storage = new MemoryStorage();
    const { pinnedStatuses, ...oldFormat } = { ...saveOf('霧深い孤島'), schemaVersion: 1 };
    expect(pinnedStatuses, '古い形式には無いフィールド').toEqual([]);
    storage.setItem('unmapped-island:save:0', JSON.stringify(oldFormat));

    const save = new SaveSlots(storage).read(0);

    expect(save?.islandName, '他のフィールドはそのまま読める').toBe('霧深い孤島');
    expect(save?.pinnedStatuses).toEqual([]);
  });

  it('壊れた値が入っていても空きスロットとして扱う', () => {
    const storage = new MemoryStorage();
    storage.setItem('unmapped-island:save:0', '{壊れたJSON');
    storage.setItem('unmapped-island:save:1', '{"islandName":"島だけ"}');

    const slots = new SaveSlots(storage);
    expect(slots.read(0)).toBeUndefined();
    expect(slots.read(1)).toBeUndefined();
  });

  it('範囲外のスロット番号は例外になる', () => {
    const slots = new SaveSlots(new MemoryStorage());
    expect(() => slots.read(SLOT_COUNT)).toThrow(SaveSlotIndexError);
    expect(() => slots.read(-1)).toThrow(SaveSlotIndexError);
  });
});
