import { installPackBackgroundArt } from '../art/backgroundArt';
import { installPackObjectArt } from '../art/objectArt';
import type { AssetPack } from './AssetPack';
import { fetchAssetPack } from './AssetPack';

/**
 * サンプルアセットパックのURL（AssetPack.md）。取得元を選ぶ画面がまだ無いので、入るのはこの1つだけ。
 *
 * **ページからの相対で書く。** 公開ビルドは相対ベース（`--base=./`）で、ゲームは`/game/`、
 * ビューアは`/codex/`の下に出る。先頭に`/`を付けるとドメイン直下を見に行って取得できない。
 */
const SAMPLE_PACK_URL = 'sample-pack.zip';

/**
 * 入っているアセットパックの並び。**入れる人が並べた順**で、同梱ぶんは常にこれより先
 * （AssetPack.md 6.2節）。
 *
 * **同じ識別子のパックは2つ入れられない**（同3.2節）。出所の表示が一意でなくなり、どちらのパックの
 * 話なのかが読めなくなる。同じパックの2つの版を並べることもできないのは、版まで含めて識別子が
 * 1つだから。
 */
export class AssetPacks {
  private readonly packs: AssetPack[] = [];

  get all(): readonly AssetPack[] {
    return this.packs;
  }

  get isEmpty(): boolean {
    return this.packs.length === 0;
  }

  add(pack: AssetPack): void {
    if (this.packs.some((other) => other.name === pack.name))
      throw new Error(`アセットパック '${pack.name}' は既に入っています（同じ識別子は2つ入れられません）。`);
    this.packs.push(pack);
  }
}

/**
 * インストール済みのアセットパック。
 *
 * **起動時に入り、以後は変わらない**（AssetPack.md 4節）。絵の在庫表は入った時点で同梱ぶんと
 * 重なるので、以降は「この絵はあるか」を今まで通り在庫表へ聞ける。
 */
const installed = new AssetPacks();

/** インストール済みのアセットパック（並べた順）。定義YAML・表示文字列はここから読む。 */
export function installedAssetPacks(): readonly AssetPack[] {
  return installed.all;
}

/** アセットパックを入れる。絵は在庫表へ重ね、定義と表示文字列は読み込み側が起動時に読む。 */
function installAssetPack(pack: AssetPack): void {
  installed.add(pack);
  installPackObjectArt(pack.objectArt(), pack.name);
  installPackBackgroundArt(pack.backgroundArt(), pack.name);
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
  return !installed.isEmpty === loadsAssetPack;
}
