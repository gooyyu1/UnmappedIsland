import { deflateRawSync } from 'node:zlib';

/**
 * テスト用のZIPを組み立てる（src/asset-pack/zip.ts が読む側）。
 *
 * 実際のパックと同じ形——中央ディレクトリを末尾に持ち、エントリごとに無圧縮（store）と
 * deflateを選べる——にすることで、読む側の両方の経路を通す。
 */
export interface ZipSource {
  readonly name: string;
  readonly content: string | Uint8Array;
  /** trueならdeflateで入れる（既定は無圧縮。絵は縮まないので実際のパックでも無圧縮が普通）。 */
  readonly deflate?: boolean;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;

export function zipArchive(sources: readonly ZipSource[]): ArrayBuffer {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const source of sources) {
    const name = new TextEncoder().encode(source.name);
    const content =
      typeof source.content === 'string' ? new TextEncoder().encode(source.content) : source.content;
    const stored = source.deflate === true ? new Uint8Array(deflateRawSync(content)) : content;
    const method = source.deflate === true ? 8 : 0;

    const local = new Uint8Array(30 + name.length + stored.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, LOCAL_HEADER, true);
    localView.setUint16(8, method, true);
    localView.setUint32(18, stored.length, true);
    localView.setUint32(22, content.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(stored, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, CENTRAL_HEADER, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(20, stored.length, true);
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
  endView.setUint16(8, sources.length, true);
  endView.setUint16(10, sources.length, true);
  endView.setUint32(12, total(centrals), true);
  endView.setUint32(16, offset, true);

  return concat([...locals, ...centrals, end]);
}

function total(parts: readonly Uint8Array[]): number {
  return parts.reduce((sum, part) => sum + part.length, 0);
}

function concat(parts: readonly Uint8Array[]): ArrayBuffer {
  const all = new Uint8Array(total(parts));
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all.buffer;
}
