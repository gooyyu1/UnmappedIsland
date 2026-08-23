import { StorageArea } from './StorageArea';

/** アセットパックを読むかどうかの記憶先。 */
const ASSET_PACK = 'asset-pack';

/** 子ウィンドウで最後に開いていたタブの記憶先。型名を後ろに繋げて1件ずつ持つ。 */
const OPENED_TAB = 'opened-tab:';

/**
 * ゲームを始める前にだけ変えられる設定（StartScreen.md 画面構成 4）。
 *
 * 保存先はコンストラクタで受け取る。ブラウザではlocalStorage、テストではメモリ上の実装を渡す
 * （SaveSlotsと同じ）。
 */
export class Settings {
  private readonly area: StorageArea;

  constructor(storage: Storage) {
    this.area = new StorageArea(storage, 'settings');
  }

  /**
   * アセットパックを読むか（AssetPack.md）。**既定は読まない**——同梱の世界がそのまま出るのを
   * 既定にし、パックの物が混ざるのは選んだときだけにする。
   */
  get loadsAssetPack(): boolean {
    return this.readFlag(ASSET_PACK);
  }

  set loadsAssetPack(value: boolean) {
    this.writeFlag(ASSET_PACK, value);
  }

  /**
   * その型の子ウィンドウで最後に開いていたタブ（一度も開いていなければundefined、Windows.md 1.2節）。
   *
   * **覚えるのは型ごと**——個体ごとに覚えても、拾い直した物も新しく作った物も別の個体なので、
   * 次に開いたときには効かない。「かごを一度開いて中身を見たら、以後どのかごも中身から」を狙う。
   *
   * セーブデータではなく設定に置くのは、これがプレイヤーの好みであってこの島の出来事ではないため。
   */
  openedTab(defName: string): string | undefined {
    return this.area.readText(OPENED_TAB + defName);
  }

  rememberOpenedTab(defName: string, tab: string): void {
    this.area.writeText(tab, OPENED_TAB + defName);
  }

  /** 未設定も、他タブや手動編集で壊れた値も、既定側（false）として読む。 */
  private readFlag(name: string): boolean {
    return this.area.readText(name) === 'true';
  }

  private writeFlag(name: string, value: boolean): void {
    this.area.writeText(String(value), name);
  }
}
