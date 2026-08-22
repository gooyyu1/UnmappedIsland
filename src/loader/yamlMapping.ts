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

/**
 * キーの値をノードのまま返す（種類を問わない）。値がスカラー/マッピング/配列のいずれにもなりうる
 * 場所（`value`参照、`not`、`transfer`等の多態フィールド）と、patchのようにYAMLを直に触る側が使う。
 * 型検証はここでは行わず、呼び出し側が個々の分岐で判別する。
 */
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
  return raw === undefined ? undefined : parseIntStrict(raw, key, context);
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

export function tryGetBool(map: YAMLMap, key: string, context: string): boolean | undefined {
  const raw = tryGetScalar(map, key, context);
  if (raw === undefined) return undefined;
  const lowered = raw.toLowerCase();
  if (lowered === 'true') return true;
  if (lowered === 'false') return false;
  throw new YamlLoadError(`${context}: '${key}' は真偽値である必要があります（値: '${raw}'）。`);
}

/**
 * 候補の一覧と突き合わせて1つ選ぶ。**綴り間違いをその場で捕まえる**ため、外れた値は候補を添えて
 * 弾く。fallbackを渡した場所は省略でき、渡さなければ必須。
 */
export function oneOf<T extends string>(
  map: YAMLMap,
  key: string,
  context: string,
  candidates: readonly T[],
  fallback?: T,
): T {
  const text = fallback === undefined ? requireScalar(map, key, context) : tryGetScalar(map, key, context);
  if (text === undefined) return fallback!;

  const chosen = candidates.find((candidate) => candidate === text);
  if (chosen === undefined)
    throw new YamlLoadError(
      `${context}.${key}: 未知の '${text}' です（${candidates.join(' / ')} のいずれかを指定してください）。`,
    );
  return chosen;
}

/** そのマッピングが宣言しているキー名を、YAML上の順で。 */
export function keysOf(map: YAMLMap): readonly string[] {
  return entriesInOrder(map).map(([key]) => key);
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

/**
 * その文脈で認めていないキーが宣言されていればエラーにする（宣言の書き間違いを黙って捨てない）。
 *
 * **判定は「認めるキーの集合」だけで表す。** 呼び出し側ごとに数え上げを書き下すと、同じ文言が散り、
 * メッセージを変えるのに全箇所を直すことになる。noteは理由を添えたい場所（主語によって使える演算子が
 * 変わる、など）だけで使う。
 */
export function requireKnownKeys(node: YAMLMap, known: Iterable<string>, context: string, note = ''): void {
  const allowed = new Set(known);
  const unknown = keysOf(node).filter((key) => !allowed.has(key));
  if (unknown.length > 0)
    throw new YamlLoadError(`${context}: 未知のキー '${unknown.join(', ')}' です${note}。`);
}
