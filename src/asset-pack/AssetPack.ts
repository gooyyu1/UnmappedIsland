import { readZip } from './zip';

/**
 * 読み込み済みのアセットパック1つ（AssetPack.md）。
 *
 * 中身の置き方は同梱ぶん（`src/assets/`）と同じで、ZIPのトップがそこに相当する（同3節）。
 * このクラスは**在庫表**——何が入っているかへの問い合わせ窓口であり、絵のURLもYAMLの中身も
 * ここから引く。読み込みに成功した時点で全エントリの在処が分かっているので、
 * 「あるかどうか」を取得しに行って確かめる必要はない（同4節）。
 */
export class AssetPack {
  /** 出所の表示（エラーメッセージと、定義の出所に使う）。 */
  readonly name: string;

  private readonly files: ReadonlyMap<string, Uint8Array>;

  /** 作ったBlobのURL。同じ絵を2度要求されても1つで済ませる。 */
  private readonly urls = new Map<string, string>();

  constructor(name: string, files: ReadonlyMap<string, Uint8Array>) {
    this.name = name;
    this.files = files;
  }

  /** 定義YAML（`world-codex/` 以下）の中身。キーは出所として出すファイル名。 */
  worldCodexTexts(): ReadonlyMap<string, string> {
    const texts = new Map<string, string>();
    for (const path of this.pathsUnder('world-codex/'))
      if (path.endsWith('.yaml') || path.endsWith('.yml')) texts.set(`${this.name}:${path}`, this.text(path));
    return texts;
  }

  /** 表示文字列（`locale/<言語>.yaml`）の中身。持っていなければundefined。 */
  localeText(language: string): string | undefined {
    const path = `locale/${language}.yaml`;
    return this.files.has(path) ? this.text(path) : undefined;
  }

  /** 型ごとの絵。object_defの識別子 → URL（`objects/<識別子>.png`）。 */
  objectArt(): ReadonlyMap<string, string> {
    return this.artUnder('objects/');
  }

  /** 背景の絵。ファイル名（拡張子なし） → URL（`backgrounds/<持ち主>_<スロット>_<用途>.png`）。 */
  backgroundArt(): ReadonlyMap<string, string> {
    return this.artUnder('backgrounds/');
  }

  /** 1つの絵のURL。実体はBlobで、パックを読み込んだ時点のバイト列を指す。 */
  private url(path: string): string {
    const known = this.urls.get(path);
    if (known !== undefined) return known;

    const bytes = this.files.get(path) as Uint8Array;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mediaType(path) }));
    this.urls.set(path, url);
    return url;
  }

  private text(path: string): string {
    return new TextDecoder().decode(this.files.get(path));
  }

  private pathsUnder(prefix: string): readonly string[] {
    return [...this.files.keys()].filter((path) => path.startsWith(prefix)).sort();
  }

  /** 1つのフォルダ直下の絵。名前は拡張子を落としたファイル名で、同梱ぶんの規約と同じ。 */
  private artUnder(prefix: string): ReadonlyMap<string, string> {
    const art = new Map<string, string>();
    for (const path of this.pathsUnder(prefix)) {
      const name = /^[^/]+\/([^/]+)\.(?:png|webp)$/.exec(path)?.[1];
      if (name !== undefined) art.set(name, this.url(path));
    }
    return art;
  }
}

/** アセットパックを取得して読む。取得も展開も失敗はそのまま投げ、呼び出し側が画面に出す。 */
export async function fetchAssetPack(url: string): Promise<AssetPack> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`アセットパック '${url}' を取得できませんでした（status ${response.status}）。`);

  return new AssetPack(packName(url), await readZip(await response.arrayBuffer()));
}

/** URLの末尾のファイル名（拡張子なし）をパックの名前にする。 */
function packName(url: string): string {
  return /([^/]+?)(?:\.zip)?$/i.exec(url)?.[1] ?? url;
}

function mediaType(path: string): string {
  return path.endsWith('.webp') ? 'image/webp' : 'image/png';
}
