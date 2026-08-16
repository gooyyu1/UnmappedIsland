import { deflateRawSync } from 'node:zlib';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * サンプルアセットパックをZIPへ固める（`npm run pack:sample`）。
 *
 * 中身の元は `sample-pack/` で、そのトップがそのままZIPのトップになる（AssetPack.md 3節）。
 * 出力先の `public/` はビルドで素通しに配られるため、ゲームからは同じ相対URLで取得できる。
 *
 * **出力は入力だけで決まる**（時刻を書かない・並び順はパス順）。同じ中身なら同じバイト列になり、
 * 中身を変えていないのに差分が出ることがない。ZIPが `sample-pack/` と食い違っていないかは
 * `tests/assetPack/samplePack.test.ts` が検査する。
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_DIR = join(ROOT, 'sample-pack');
const OUTPUT = join(ROOT, 'public', 'sample-pack.zip');

/** ZIPで縮まない拡張子（絵は既に圧縮済み）。無圧縮で入れれば、読む側は切り出すだけで済む。 */
const STORED_EXTENSIONS = ['.png', '.webp'];

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;

writeFileSync(OUTPUT, zipOf(filesIn(SOURCE_DIR)));
console.log(`${relative(ROOT, OUTPUT)} を作りました（${filesIn(SOURCE_DIR).length}ファイル）。`);

/** ZIPに入れるファイル（ZIP内のパスはsample-pack/からの相対、区切りは常に`/`）。 */
function filesIn(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .map((path) => ({ name: relative(directory, path).split(sep).join('/'), path }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

function zipOf(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const content = new Uint8Array(readFileSync(file.path));
    const stored = STORED_EXTENSIONS.some((extension) => file.name.endsWith(extension));
    const packed = stored ? content : new Uint8Array(deflateRawSync(content));

    const local = new Uint8Array(30 + name.length + packed.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, LOCAL_HEADER, true);
    localView.setUint16(8, stored ? 0 : 8, true);
    localView.setUint32(14, crc32(content), true);
    localView.setUint32(18, packed.length, true);
    localView.setUint32(22, content.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(packed, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, CENTRAL_HEADER, true);
    centralView.setUint16(10, stored ? 0 : 8, true);
    centralView.setUint32(16, crc32(content), true);
    centralView.setUint32(20, packed.length, true);
    centralView.setUint32(24, content.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_RECORD, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, sizeOf(centrals), true);
  endView.setUint32(16, offset, true);

  return concat([...locals, ...centrals, end]);
}

/** ZIPが各エントリに持つ検査値。展開する側が壊れを検出できるよう、正しい値を書く。 */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sizeOf(parts) {
  return parts.reduce((sum, part) => sum + part.length, 0);
}

function concat(parts) {
  const all = new Uint8Array(sizeOf(parts));
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
}
