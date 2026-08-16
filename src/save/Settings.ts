const KEY_PREFIX = 'unmapped-island:settings:';

/** アセットパックを読むかどうかの記憶先。 */
const ASSET_PACK = 'asset-pack';

/**
 * ゲームを始める前にだけ変えられる設定（StartScreen.md 画面構成 4）。
 *
 * 保存先はコンストラクタで受け取る。ブラウザではlocalStorage、テストではメモリ上の実装を渡す
 * （SaveSlotsと同じ）。
 */
export class Settings {
  private readonly storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
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

  /** 未設定も、他タブや手動編集で壊れた値も、既定側（false）として読む。 */
  private readFlag(name: string): boolean {
    return this.storage.getItem(KEY_PREFIX + name) === 'true';
  }

  private writeFlag(name: string, value: boolean): void {
    this.storage.setItem(KEY_PREFIX + name, String(value));
  }
}
