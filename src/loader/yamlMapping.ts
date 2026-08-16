import { isMap, isScalar, isSeq } from 'yaml';
import type { Scalar, YAMLMap, YAMLSeq } from 'yaml';
import { INT32_MAX, INT32_MIN } from '../util/int32';
import { YamlLoadError } from './YamlLoadError';

/** WorldCodexのYAMLを構成するノード。 */
export type YamlNode = Scalar | YAMLMap | YAMLSeq;

/**
 * yamlパッケージのノード（YAMLMap等）に対する、フィールド取り出し用の薄いヘルパー。
 * エラーメッセージにcontext（ファイル名・object_def名など）を含められるようにする。
 * 生のyaml APIを直接触るのはこのモジュール内だけに閉じ、ローダー本体は型と値の検証込みの
 * この関数群だけを使う。
 *
 * スカラーは常に「YAMLに書かれた表記の文字列」とみなして扱い、数値・真偽値としての解釈は
 * requireInt等の各ヘルパーが明示的に行う（YAMLの暗黙の型解決に依存しない）。
 */

const INT_PATTERN = /^[+-]?\d+$/;

/** スカラーノードの文字列表現。値なし（`key:` のみ）は空文字列とみなす。 */
function scalarText(scalar: Scalar): string {
  return scalar.value === null || scalar.value === undefined ? '' : String(scalar.value);
}

/** キーの値をノードのまま返す（種類を問わない。patchのようにYAMLを直に触る側が使う）。 */
export function tryGetNode(map: YAMLMap, key: string): YamlNode | undefined {
  return (map.get(key, true) ?? undefined) as YamlNode | undefined;
}

export function tryGetMap(map: YAMLMap, key: string, context: string): YAMLMap | undefined {
  const node = map.get(key, true);
  if (node === undefined) return undefined;
  if (isMap(node)) return node;
  throw new YamlLoadError(`${context}: '${key}' はマッピングである必要があります。`);
}

export function tryGetSeq(map: YAMLMap, key: string, context: string): YAMLSeq | undefined {
  const node = map.get(key, true);
  if (node === undefined) return undefined;
  if (isSeq(node)) return node;
  throw new YamlLoadError(`${context}: '${key}' は配列である必要があります。`);
}

export function tryGetScalar(map: YAMLMap, key: string, context: string): string | undefined {
  const node = map.get(key, true);
  if (node === undefined) return undefined;
  if (isScalar(node)) return scalarText(node);
  throw new YamlLoadError(`${context}: '${key}' はスカラー値である必要があります。`);
}

export function requireScalar(map: YAMLMap, key: string, context: string): string {
  const value = tryGetScalar(map, key, context);
  if (value === undefined) throw new YamlLoadError(`${context}: 必須フィールド '${key}' がありません。`);
  return value;
}

function parseIntStrict(raw: string, key: string, context: string): number {
  if (!INT_PATTERN.test(raw))
    throw new YamlLoadError(`${context}: '${key}' は整数である必要があります（値: '${raw}'）。`);
  const value = Number(raw);
  if (value < INT32_MIN || value > INT32_MAX)
    throw new YamlLoadError(`${context}: '${key}' は整数である必要があります（値: '${raw}'）。`);
  return value;
}

export function requireInt(map: YAMLMap, key: string, context: string): number {
  return parseIntStrict(requireScalar(map, key, context), key, context);
}

export function tryGetInt(map: YAMLMap, key: string, context: string): number | undefined {
  const raw = tryGetScalar(map, key, context);
  if (raw === undefined) return undefined;
  return parseIntStrict(raw, key, context);
}

/**
 * プロパティの値・量など、小数を許す場所の必須フィールド（GameElementDefinition.md 6節）。
 * 枠数や分のような「数えるもの」はrequireIntのままにする。
 */
export function requireNumber(map: YAMLMap, key: string, context: string): number {
  const value = tryGetNumber(map, key, context);
  if (value === undefined) throw new YamlLoadError(`${context}: 必須フィールド '${key}' がありません。`);
  return value;
}

export function tryGetNumber(map: YAMLMap, key: string, context: string): number | undefined {
  const raw = tryGetScalar(map, key, context);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (raw.trim() === '' || Number.isNaN(value))
    throw new YamlLoadError(`${context}: '${key}' は数値である必要があります（値: '${raw}'）。`);
  return value;
}

export function tryGetBool(map: YAMLMap, key: string, context: string, fallback: boolean): boolean {
  const raw = tryGetScalar(map, key, context);
  if (raw === undefined) return fallback;
  const lowered = raw.toLowerCase();
  if (lowered === 'true') return true;
  if (lowered === 'false') return false;
  throw new YamlLoadError(`${context}: '${key}' は真偽値である必要があります（値: '${raw}'）。`);
}

/** マッピングの子を、YAML上の宣言順のまま (キー文字列, 値ノード) の列として返す。 */
export function entriesInOrder(map: YAMLMap): ReadonlyArray<[string, YamlNode]> {
  return map.items.map((pair) => {
    if (!isScalar(pair.key)) throw new YamlLoadError('マッピングのキーはスカラーである必要があります。');
    return [scalarText(pair.key), pair.value as YamlNode];
  });
}

/** ノードをマッピングとして扱う（配列要素など、キー経由でないノードの型検証用）。 */
export function asMap(node: unknown, context: string): YAMLMap {
  if (isMap(node)) return node;
  throw new YamlLoadError(`${context}: マッピングである必要があります。`);
}

/** ノードを配列として扱う（配列要素など、キー経由でないノードの型検証用）。 */
export function asSeq(node: unknown, context: string): YAMLSeq {
  if (isSeq(node)) return node;
  throw new YamlLoadError(`${context}: 配列である必要があります。`);
}

/** ノードをスカラーの文字列として扱う（配列要素など、キー経由でないノードの型検証用）。 */
export function asScalarText(node: unknown, context: string): string {
  if (isScalar(node)) return scalarText(node);
  throw new YamlLoadError(`${context}: スカラー値である必要があります。`);
}
