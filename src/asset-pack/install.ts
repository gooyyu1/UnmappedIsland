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
 * **起動時に入り、以後は変わらない**（AssetPack.md 4節）。ここに並ぶのは取得できたパックで、
 * そのうち実際に載るのは読み込みを通ったぶんだけ（同6.1節、loadDefinitions）。
 */
const installed = new AssetPacks();

/** インストール済みのアセットパック（並べた順）。定義YAML・表示文字列・絵はここから読む。 */
export function installedAssetPacks(): readonly AssetPack[] {
  return installed.all;
}

/**
 * 載せるパックの絵で在庫表を組み直す（AssetPack.md 4節）。
 *
 * **渡すのは載せると決まったパックだけ**（loadDefinitions）。定義を外したパックの絵を残すと、その
 * パックの背景が同梱の型に敷かれ、「同梱ぶん＋無事なパック」ではない世界になる（同6.1節）。
 */
export function installPackArt(packs: readonly AssetPack[]): void {
  installPackObjectArt(packs.map((pack) => ({ packName: pack.name, art: pack.objectArt() })));
  installPackBackgroundArt(packs.map((pack) => ({ packName: pack.name, art: pack.backgroundArt() })));
}

/**
 * サンプルアセットパックを取得して並びへ加える。読むかどうかを決めるのは呼び出し側で、定義も絵も
 * ここでは載せない（載せられるパックを選ぶのはloadDefinitions）。
 *
 * 取得の失敗はそのまま投げる——パックが入らないまま起動すると、あるはずの物が無い世界で遊ぶことに
 * なり、定義の欠落と同じく黙って進めてよい状態ではない（AssetPack.md 2節）。
 */
export async function installSampleAssetPack(): Promise<void> {
  installed.add(await fetchAssetPack(SAMPLE_PACK_URL));
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
