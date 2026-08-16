import { installPackBackgroundArt } from '../art/backgroundArt';
import { installPackObjectArt } from '../art/objectArt';
import type { AssetPack } from './AssetPack';
import { fetchAssetPack } from './AssetPack';

/**
 * 読み込むアセットパックのURL（AssetPack.md）。当面は固定の1つだけで、切り替えの入口は無い。
 * 空文字なら同梱ぶんだけで動く。
 */
export const ASSET_PACK_URL: string = '';

/**
 * インストール済みのアセットパック。
 *
 * **起動時に1回だけ入り、以後は変わらない**（AssetPack.md 4節）。絵の在庫表は入った時点で
 * 同梱ぶんと重なるので、以降は「この絵はあるか」を今まで通り在庫表へ聞ける。
 */
let installed: AssetPack | undefined;

/** インストール済みのアセットパック（無ければundefined）。定義YAML・表示文字列はここから読む。 */
export function installedAssetPack(): AssetPack | undefined {
  return installed;
}

/** アセットパックを入れる。絵は在庫表へ重ね、定義と表示文字列は読み込み側が起動時に読む。 */
export function installAssetPack(pack: AssetPack): void {
  if (installed !== undefined)
    throw new Error(`アセットパックは1つしか入れられません（'${installed.name}' が入っています）。`);

  installPackObjectArt(pack.objectArt(), pack.name);
  installPackBackgroundArt(pack.backgroundArt(), pack.name);
  installed = pack;
}

/**
 * 設定されたURLからアセットパックを取得して入れる。URLが空なら何もしない。
 *
 * 失敗はそのまま投げる——パックが入らないまま起動すると、あるはずの物が無い世界で遊ぶことになり、
 * 定義の欠落と同じく黙って進めてよい状態ではない。
 */
export async function installConfiguredAssetPack(): Promise<void> {
  if (ASSET_PACK_URL === '') return;
  installAssetPack(await fetchAssetPack(ASSET_PACK_URL));
}
