import { installPackBackgroundArt } from '../art/backgroundArt';
import { installPackObjectArt } from '../art/objectArt';
import { messageOf } from '../loader/errorMessage';
import type { LoadReport } from '../loader/LoadReport';
import { AssetPack } from './AssetPack';

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

  /** 配布物を1つでも取りに行ったか。読めずに外したぶんも数える（matchesSetting）。 */
  private requested = false;

  get all(): readonly AssetPack[] {
    return this.packs;
  }

  /**
   * 取りに行った配布物1つを受け取る。読めたなら並びへ加わり、読めなかった（undefined）なら
   * 取りに行った事実だけが残る（AssetPack.md 6.1節）。
   */
  receive(pack: AssetPack | undefined): void {
    this.requested = true;
    if (pack === undefined) return;
    if (this.packs.some((other) => other.name === pack.name))
      throw new Error(`アセットパック '${pack.name}' は既に入っています（同じ識別子は2つ入れられません）。`);
    this.packs.push(pack);
  }

  /**
   * 設定の言う通りに読んだか。**並びが空かどうかでは代えられない**——読めなかった配布物は外れて
   * 並びが空のままになるが（AssetPack.md 6.1節）、それは設定どおりに読んだ結果であって、
   * 読み込み直しても変わらない。
   */
  matchesSetting(loadsAssetPack: boolean): boolean {
    return this.requested === loadsAssetPack;
  }
}

/**
 * インストール済みのアセットパック。
 *
 * **起動時に入り、以後は変わらない**（AssetPack.md 4節）。ここに並ぶのは配布物を読めたパックで、
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
 * **取得と読み込みでは失敗の扱いが違う。** 何も届かないのは設定の誤りなので投げて起動を止める
 * （AssetPack.md 2節）。届いた配布物が読めないのはパック1つの失敗なので、並びへ加えずに理由を
 * 記録して続ける（同6.1節）——記録の出所はURLで、名乗れなかったパックには名前が無い。
 */
export async function installSampleAssetPack(report: LoadReport): Promise<void> {
  const archive = await fetchPackArchive(SAMPLE_PACK_URL);
  installed.receive(await readPack(archive, SAMPLE_PACK_URL, report));
}

/**
 * 届いた配布物を読む。読めなければ、そのパックを外した理由を記録してundefinedを返す
 * （AssetPack.md 6.1節）。
 *
 * **受けるのは配布物を読めなかったぶんだけ。** 読めたパックが定義や絵で落ちるのは別の失敗で、
 * そちらは読み込み側が同じ単位で外す（loadDefinitions）。
 */
async function readPack(
  archive: ArrayBuffer,
  url: string,
  report: LoadReport,
): Promise<AssetPack | undefined> {
  try {
    return await AssetPack.read(archive);
  } catch (error) {
    report.addDiscarded(url, undefined, `配布物を読めないので、このパックを外しました: ${messageOf(error)}`);
    return undefined;
  }
}

/**
 * 配布物を取得する。届かなければ投げる——パックを指定したのに何も届いていない状態は、パックの
 * 中身の問題ではなく設定の誤り（AssetPack.md 2節）。
 */
async function fetchPackArchive(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`アセットパック '${url}' を取得できませんでした（status ${response.status}）。`);
  return response.arrayBuffer();
}

/**
 * この起動が、設定の言う通りに読んだか（AssetPacks.matchesSetting）。
 *
 * 食い違っているなら、設定を反映する手はページを読み込み直すことしかない——絵の在庫表もWorldCodexも
 * 起動時に1回だけ組み立てて以後不変（AssetPack.md 4節）だから。
 */
export function assetPackInstallMatchesSetting(loadsAssetPack: boolean): boolean {
  return installed.matchesSetting(loadsAssetPack);
}
