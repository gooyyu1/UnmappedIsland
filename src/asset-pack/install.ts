import { installPackBackgroundArt } from '../art/backgroundArt';
import { installPackObjectArt } from '../art/objectArt';
import type { AssetPack } from './AssetPack';
import { fetchAssetPack } from './AssetPack';

/**
 * サンプルアセットパックのURL（AssetPack.md）。読めるパックは当面この1つだけ。
 *
 * **ページからの相対で書く。** 公開ビルドは相対ベース（`--base=./`）で、ゲームは`/game/`、
 * ビューアは`/codex/`の下に出る。先頭に`/`を付けるとドメイン直下を見に行って取得できない。
 */
const SAMPLE_PACK_URL = 'sample-pack.zip';

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
function installAssetPack(pack: AssetPack): void {
  if (installed !== undefined)
    throw new Error(
      `アセットパックは1つしか入れられません（識別子 '${installed.name}' のパックが入っています）。`,
    );

  installPackObjectArt(pack.objectArt(), pack.name);
  installPackBackgroundArt(pack.backgroundArt(), pack.name);
  installed = pack;
}

/**
 * サンプルアセットパックを取得して入れる。読むかどうかを決めるのは呼び出し側。
 *
 * 失敗はそのまま投げる——パックが入らないまま起動すると、あるはずの物が無い世界で遊ぶことになり、
 * 定義の欠落と同じく黙って進めてよい状態ではない。
 */
export async function installSampleAssetPack(): Promise<void> {
  installAssetPack(await fetchAssetPack(SAMPLE_PACK_URL));
}

/**
 * 今入っているものが、設定の言う通りか。
 *
 * 食い違っているなら、設定を反映する手はページを読み込み直すことしかない——絵の在庫表もWorldCodexも
 * 起動時に1回だけ組み立てて以後不変（AssetPack.md 4節）だから。
 */
export function assetPackInstallMatchesSetting(loadsAssetPack: boolean): boolean {
  return (installed !== undefined) === loadsAssetPack;
}
