/**
 * この製品がブラウザに持つ保存領域（SaveDataManagement.md 保存先節）。**これで全部**で、
 * 新しく持つならここへ足す。
 *
 * 名前はキーそのものの一部なので、変えると既に保存されているものが読めなくなる。
 */
export type StorageAreaName = 'save' | 'settings' | 'shelf';

/** どのキーにも付く、この製品ぶんの名前空間。 */
const NAMESPACE = 'unmapped-island';

/**
 * 保存領域1つ。領域の中は名前で分けられ（`save`のスロット番号、`settings`の項目ごと）、
 * 分けないなら名前を省く（`shelf`）。
 *
 * **壊れた値は未設定として読む。** 他のタブや手動編集で壊れうるので、読み手は両者を区別しない。
 *
 * 保存先はコンストラクタで受け取る。ブラウザではlocalStorage、テストではメモリ上の実装を渡す。
 */
export class StorageArea {
  private readonly storage: Storage;

  private readonly prefix: string;

  constructor(storage: Storage, name: StorageAreaName) {
    this.storage = storage;
    this.prefix = `${NAMESPACE}:${name}`;
  }

  /** 文字列としてそのまま読む。未設定はundefined。 */
  readText(name?: string): string | undefined {
    return this.storage.getItem(this.keyOf(name)) ?? undefined;
  }

  writeText(value: string, name?: string): void {
    this.storage.setItem(this.keyOf(name), value);
  }

  /** JSONとして読む。未設定も壊れた値もundefined。 */
  readJson(name?: string): unknown {
    const raw = this.storage.getItem(this.keyOf(name));
    if (raw === null) return undefined;

    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  writeJson(value: unknown, name?: string): void {
    this.storage.setItem(this.keyOf(name), JSON.stringify(value));
  }

  remove(name?: string): void {
    this.storage.removeItem(this.keyOf(name));
  }

  private keyOf(name: string | undefined): string {
    return name === undefined ? this.prefix : `${this.prefix}:${name}`;
  }
}
