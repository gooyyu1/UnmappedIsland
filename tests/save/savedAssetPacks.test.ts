import { describe, expect, it } from 'vitest';
import { createSaveData } from '../../src/save/newGameInput';
import type { SavedAssetPack } from '../../src/save/SaveData';
import { opensWithAssetPacks } from '../../src/save/savedAssetPacks';
import { SaveSlots } from '../../src/save/SaveSlots';
import { MemoryStorage } from '../support/MemoryStorage';

/** パックの並びを刻んだセーブ。刻むのはcreateSaveDataなので、ここでは並びだけ差し替える。 */
function saveWithPacks(packs: readonly SavedAssetPack[]) {
  return { ...createSaveData('霧深い孤島', 12345, 'farmer', 1700000000000), assetPacks: packs };
}

const POTIONS: SavedAssetPack = { id: 'potions', version: '1.0.0' };
const HERBS: SavedAssetPack = { id: 'herbs', version: '1.0.0' };

describe('セーブが指すアセットパックの並び（AssetPack.md 6.4節）', () => {
  it('同じ並びなら開ける', () => {
    expect(opensWithAssetPacks(saveWithPacks([POTIONS, HERBS]), [POTIONS, HERBS])).toBe(true);
  });

  it('同梱ぶんだけで作ったセーブは、パックが1つも入っていないときだけ開ける', () => {
    expect(opensWithAssetPacks(saveWithPacks([]), [])).toBe(true);
    expect(opensWithAssetPacks(saveWithPacks([]), [POTIONS])).toBe(false);
  });

  it('パックが外れている・増えていると開けない', () => {
    expect(opensWithAssetPacks(saveWithPacks([POTIONS]), [])).toBe(false);
    expect(opensWithAssetPacks(saveWithPacks([POTIONS]), [POTIONS, HERBS])).toBe(false);
  });

  it('版が違うだけでも開けない（版が上がれば定義が変わりうる）', () => {
    expect(opensWithAssetPacks(saveWithPacks([POTIONS]), [{ id: 'potions', version: '1.1.0' }])).toBe(false);
  });

  it('同じ顔ぶれでも並びが違えば開けない', () => {
    expect(opensWithAssetPacks(saveWithPacks([POTIONS, HERBS]), [HERBS, POTIONS])).toBe(false);
  });

  it('新しく作ったセーブは、そのとき入っている並びで開ける', () => {
    const storage = new MemoryStorage();
    const slots = new SaveSlots(storage);
    slots.write(0, createSaveData('霧深い孤島', 12345, 'farmer', 1700000000000));

    const save = slots.read(0);
    expect(save, '書いたものがそのまま読める').toBeDefined();
    // テストでは1つも入らない（installedAssetPacksが空）ので、同梱ぶんだけのセーブになる。
    expect(save?.assetPacks).toEqual([]);
    expect(opensWithAssetPacks(save as NonNullable<typeof save>, [])).toBe(true);
  });
});
