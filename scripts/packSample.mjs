import { deflateRawSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { samplePackFiles } from './samplePackFiles.mjs';

/**
 * サンプルアセットパックをZIPへ固める（`npm run pack:sample`）。
 *
 * 中身の元は `sample-pack/` で、そのトップがそのままZIPのトップになる（AssetPack.md 3節）。
 * 出力先の `public/` はビルドで素通しに配られるため、ゲームからは同じ相対URLで取得できる。
 * 何をどんなバイト列で入れるかは `samplePackFiles.mjs` が決め、ここはZIPの形に組むだけ。
 *
 * **出力は入力だけで決まる**（時刻を書かない・並び順はパス順・テキストの改行はLF）。同じ中身なら
 * どの環境で固めても同じバイト列になり、中身を変えていないのに差分が出ることがない。ZIPが
 * `sample-pack/` と食い違っていないかは `tests/asset-pack/samplePack.test.ts` が検査する。
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT = join(ROOT, 'public', 'sample-pack.zip');

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;

const files = samplePackFiles();
writeFileSync(OUTPUT, zipOf(files));
console.log(`${relative(ROOT, OUTPUT)} を作りました（${files.length}ファイル）。`);

function zipOf(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const content = file.content;
    const packed = file.stored ? content : new Uint8Array(deflateRawSync(content));

    const local = new Uint8Array(30 + name.length + packed.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, LOCAL_HEADER, true);
    localView.setUint16(8, file.stored ? 0 : 8, true);
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
    centralView.setUint16(10, file.stored ? 0 : 8, true);
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
