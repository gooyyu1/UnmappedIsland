import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * サンプルアセットパックに入るファイルと、ZIPへ入るバイト列。
 *
 * 固める側（`packSample.mjs`）と、固め直し忘れを見る側（`tests/assetPack/samplePack.test.ts`）が
 * ここを共有する。走査の規約（パス区切り・並び順）も正規化も両方が持つと、規約を変えたときに
 * 片方だけが古くなる。
 */

/** 元のファイルの置き場。ここのトップがそのままZIPのトップになる（AssetPack.md 3節）。 */
export const SAMPLE_PACK_DIR = join(fileURLToPath(new URL('..', import.meta.url)), 'sample-pack');

/**
 * 拡張子ごとの扱い。表に無い拡張子は、縮めて入れるバイト列として扱う。
 *
 * **テキストは改行をLFへ揃えてから入れる。** 作業ツリーの改行は取り出し方（gitの`core.autocrlf`）で
 * 変わるので、読んだままを入れると、中身が同じでも**固めた人によってZIPのバイト列が変わる**。
 *
 * 絵はZIPで縮まない（既に圧縮済み）ので無圧縮で入れる。読む側は切り出すだけで済む。
 */
const HANDLING = {
  '.yaml': { text: true, stored: false },
  '.yml': { text: true, stored: false },
  '.png': { text: false, stored: true },
  '.webp': { text: false, stored: true },
};

const DEFAULT_HANDLING = { text: false, stored: false };

/**
 * ZIPに入るファイル（ZIP内のパス順）。
 *
 * @returns {{name: string, content: Uint8Array, stored: boolean}[]}
 *   nameはZIP内のパス、contentはZIPへそのまま入るバイト列、storedは無圧縮で入れるか。
 */
export function samplePackFiles() {
  return readdirSync(SAMPLE_PACK_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .map((path) => {
      const name = relative(SAMPLE_PACK_DIR, path).split(sep).join('/');
      const handling = HANDLING[extname(name)] ?? DEFAULT_HANDLING;
      return { name, content: contentOf(path, handling.text), stored: handling.stored };
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** 1ファイルのZIPへ入るバイト列。テキストならCRLFもCRもLFへ均す。 */
function contentOf(path, isText) {
  const bytes = readFileSync(path);
  if (!isText) return new Uint8Array(bytes);
  return new TextEncoder().encode(bytes.toString('utf-8').replace(/\r\n?/g, '\n'));
}
