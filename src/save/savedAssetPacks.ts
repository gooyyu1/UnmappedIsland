import { installedAssetPacks } from '../asset-pack/install';
import type { SaveData, SavedAssetPack } from './SaveData';

/**
 * 今入っているアセットパックを、セーブへ書ける形にしたもの（読み込んだ順、AssetPack.md 6.2節）。
 * 同梱ぶんだけなら空。
 */
export function currentAssetPacks(): readonly SavedAssetPack[] {
  return installedAssetPacks().map((pack) => ({ id: pack.name, version: pack.version }));
}

/**
 * そのセーブを開けるか（AssetPack.md 6.4節）。
 *
 * パックは土地の型も生成の重みも足せるので、**同じシードでも入っているパックが違えば別の島**に
 * なる。ワールド状態は保存せずシードから作り直す以上、食い違ったまま開くと、続きのつもりで
 * 知らない島が出る。順序まで見るのは、宣言順に振られるものが並びで変わるため。
 */
export function opensWithAssetPacks(save: SaveData, installed: readonly SavedAssetPack[]): boolean {
  return (
    save.assetPacks.length === installed.length &&
    save.assetPacks.every(
      (pack, index) => pack.id === installed[index].id && pack.version === installed[index].version,
    )
  );
}
