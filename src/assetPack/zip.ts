/**
 * ZIPの読み取り（アセットパックの受け取り口、AssetPack.md 2節）。
 *
 * 読むのは中央ディレクトリ（末尾にある全エントリの一覧）だけで、これがそのままパックの在庫表に
 * なる。解凍は標準の`DecompressionStream('deflate-raw')`が行うため、外部ライブラリは要らない。
 *
 * 暗号化・分割・ZIP64は扱わない。パックに必要な機能ではなく、当たったらエラーで返す。
 */

/** ZIPを読めなかったときのエラー。呼び出し側は出所（URL）を添えて画面に出す。 */
export class ZipReadError extends Error {}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/** 中央ディレクトリの終端レコードの固定長部分。これより後ろはコメント（最大65535バイト）。 */
const END_RECORD_SIZE = 22;

/** ZIP64を使っているファイルでは、32ビットに収まらない値がこの番兵で埋められている。 */
const ZIP64_MARKER = 0xffffffff;

/** 圧縮方式。無圧縮（store）とdeflateだけを扱う。 */
const STORED = 0;
const DEFLATED = 8;

/** 汎用フラグのビット0。立っていれば暗号化されている。 */
const ENCRYPTED_FLAG = 1;

/**
 * ZIPの中身を、エントリ名（ZIP内のパス）からバイト列への対応として返す。ディレクトリの項目は
 * 除く。名前はUTF-8として読む（ZIPの仕様上は他の符号化もありうるが、パックはUTF-8で作る）。
 */
export async function readZip(archive: ArrayBuffer): Promise<ReadonlyMap<string, Uint8Array>> {
  const view = new DataView(archive);
  const bytes = new Uint8Array(archive);
  const endOffset = findEndRecord(view);

  const entryCount = view.getUint16(endOffset + 10, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  if (directoryOffset === ZIP64_MARKER || entryCount === 0xffff)
    throw new ZipReadError('ZIP64のアーカイブには対応していません。');

  const files = new Map<string, Uint8Array>();
  let at = directoryOffset;
  for (let index = 0; index < entryCount; index++) {
    if (view.getUint32(at, true) !== CENTRAL_FILE_HEADER)
      throw new ZipReadError(`中央ディレクトリの${index + 1}件目が壊れています。`);

    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const uncompressedSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));

    if ((flags & ENCRYPTED_FLAG) !== 0) throw new ZipReadError(`'${name}' は暗号化されています。`);
    if (compressedSize === ZIP64_MARKER || uncompressedSize === ZIP64_MARKER || localOffset === ZIP64_MARKER)
      throw new ZipReadError(`'${name}' がZIP64の形式です。対応していません。`);

    // ディレクトリの項目は中身を持たない（名前が`/`で終わる）。在庫表は実ファイルだけでよい。
    if (!name.endsWith('/'))
      files.set(
        name,
        await contentOf(view, bytes, name, localOffset, method, compressedSize, uncompressedSize),
      );

    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/** 1エントリの中身。無圧縮ならアーカイブの一部をそのまま指し、deflateなら展開して返す。 */
async function contentOf(
  view: DataView,
  bytes: Uint8Array,
  name: string,
  localOffset: number,
  method: number,
  compressedSize: number,
  uncompressedSize: number,
): Promise<Uint8Array> {
  if (view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER)
    throw new ZipReadError(`'${name}' の位置が中央ディレクトリの記載と合いません。`);

  // ローカルヘッダの拡張フィールドは、中央ディレクトリのものと長さが違うことがある。ここで読み直す。
  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const start = localOffset + 30 + nameLength + extraLength;
  const compressed = bytes.subarray(start, start + compressedSize);

  if (method === STORED) return compressed;
  if (method !== DEFLATED) throw new ZipReadError(`'${name}' の圧縮方式（${method}）に対応していません。`);

  const inflated = await inflateRaw(compressed);
  if (inflated.length !== uncompressedSize)
    throw new ZipReadError(`'${name}' の展開後の大きさが記載と合いません。`);
  return inflated;
}

/** deflateの展開。ZIPが使うのはヘッダの無い生のdeflateなので`deflate-raw`。 */
async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([compressed as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * 末尾から中央ディレクトリの終端レコードを探す。コメントが付いていると末尾ぴったりには無いため、
 * コメントの最大長ぶんだけ遡って署名を探す。
 */
function findEndRecord(view: DataView): number {
  const earliest = Math.max(0, view.byteLength - END_RECORD_SIZE - 0xffff);
  for (let at = view.byteLength - END_RECORD_SIZE; at >= earliest; at--)
    if (view.getUint32(at, true) === END_OF_CENTRAL_DIRECTORY) return at;
  throw new ZipReadError('ZIPファイルではありません（中央ディレクトリが見つかりません）。');
}
