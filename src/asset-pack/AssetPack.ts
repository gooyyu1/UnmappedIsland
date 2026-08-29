import { parseDocument } from 'yaml';
import type { YAMLMap } from 'yaml';
import { asMap, requireKnownKeys, requireScalar } from '../loader/yamlMapping';
import { YamlLoadError } from '../loader/YamlLoadError';
import { readZip } from './zip';

/** パックが自分の識別子と版を名乗るファイル。ZIPのトップに1つ置く（AssetPack.md 3.2節）。 */
const MANIFEST_FILE = 'pack.yaml';

/**
 * 読み込み済みのアセットパック1つ（AssetPack.md）。
 *
 * 中身の置き方は同梱ぶん（`src/assets/`）と同じで、ZIPのトップがそこに相当する（同3節）。
 * このクラスは**在庫表**——何が入っているかへの問い合わせ窓口であり、絵のURLもYAMLの中身も
 * ここから引く。読み込みに成功した時点で全エントリの在処が分かっているので、
 * 「あるかどうか」を取得しに行って確かめる必要はない（同4節）。
 *
 * **名乗りは中身から読む。** 取得元のURLやファイル名からは採らない——ミラーやリネームで
 * 変わる名前では、同じパックが別物になる（同3.2節）。
 */
export class AssetPack {
  /** パックが名乗った識別子。出所の表示（エラーメッセージと、定義の出所に使う）。 */
  readonly name: string;

  /** パックが名乗った版。文字列で、大小の順序は持たない（AssetPack.md 3.2節）。 */
  readonly version: string;

  private readonly files: ReadonlyMap<string, Uint8Array>;

  /** 作ったBlobのURL。同じ絵を2度要求されても1つで済ませる。 */
  private readonly urls = new Map<string, string>();

  /** `pack.yaml` を名乗れないZIPはパックとして受け取らない（YamlLoadError）。 */
  constructor(files: ReadonlyMap<string, Uint8Array>) {
    const manifest = parseManifest(files);
    this.name = manifest.id;
    this.version = manifest.version;
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

  return new AssetPack(await readZip(await response.arrayBuffer()));
}

/** パックの名乗り（AssetPack.md 3.2節）。どちらも省略できない。 */
interface PackManifest {
  readonly id: string;
  readonly version: string;
}

/** `pack.yaml` を読む。無い・書式が違う・知らないキーがある、はいずれもエラー。 */
function parseManifest(files: ReadonlyMap<string, Uint8Array>): PackManifest {
  const bytes = files.get(MANIFEST_FILE);
  if (bytes === undefined)
    throw new YamlLoadError(
      `アセットパックに '${MANIFEST_FILE}' がありません（識別子と版の名乗りが要ります）。`,
    );

  const document = parseDocument(new TextDecoder().decode(bytes));
  if (document.errors.length > 0)
    throw new YamlLoadError(`${MANIFEST_FILE}: YAML構文エラー: ${document.errors[0].message}`);

  const root = asMap(document.contents, MANIFEST_FILE);
  requireKnownKeys(root, ['id', 'version'], MANIFEST_FILE);
  return { id: requireNonEmpty(root, 'id'), version: requireNonEmpty(root, 'version') };
}

function requireNonEmpty(root: YAMLMap, key: string): string {
  const value = requireScalar(root, key, MANIFEST_FILE);
  if (value === '') throw new YamlLoadError(`${MANIFEST_FILE}: '${key}' が空です。`);
  return value;
}

function mediaType(path: string): string {
  return path.endsWith('.webp') ? 'image/webp' : 'image/png';
}
