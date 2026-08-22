import type { YAMLMap } from 'yaml';
import { tryGetScalar } from './yamlMapping';

import { YamlLoadError } from './YamlLoadError';
import { INT32_MAX, INT32_MIN } from '../util/int32';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import { TypeMatchRule } from '../domain/TypeMatchRule';

/**
 * 複数の領域（props/conditions/active効果/pick）から使う小さなパースヘルパー。
 */

/**
 * 「どの型が当てはまるか」の指定（`{tag: ...}`か`{object: ...}`のいずれか一方）を読む。
 * 枠の`accept`（7.2節）とcombinationsの`with`（12.1節）が同じ形を共有する。
 */
export function parseTypeMatchRule(
  loader: WorldCodexYamlLoader,
  node: YAMLMap,
  context: string,
): TypeMatchRule {
  const tagName = tryGetScalar(node, 'tag', context);
  const objectName = tryGetScalar(node, 'object', context);

  if (tagName !== undefined && objectName !== undefined)
    throw new YamlLoadError(`${context}: 'tag'と'object'は同時に指定できません。`);
  if (tagName === undefined && objectName === undefined)
    throw new YamlLoadError(`${context}: 'tag'または'object'のいずれかが必要です。`);

  return tagName !== undefined
    ? TypeMatchRule.tag(loader.tagNames.intern(tagName))
    : TypeMatchRule.object(loader.objectNames.intern(objectName!));
}

/**
 * 数値リテラルの形。小数を許すのはプロパティの値だけで（GameElementDefinition.md 6節）、枠数や
 * 分数のような「数えるもの」はrequireIntのまま整数を要求する。指数形を許すのは、YAMLが数値として
 * 解いた極小の値をStringが `1e-7` の形へ戻すため。
 */
const NUMBER_PATTERN = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;

function tryParseNumber(raw: string): number | undefined {
  if (!NUMBER_PATTERN.test(raw)) return undefined;
  const value = Number(raw);
  // 値域は32bit整数の幅に留める（精度は倍精度）。桁の打ち間違いをその場で捕まえるための歯止め。
  if (!Number.isFinite(value) || value < INT32_MIN || value > INT32_MAX) return undefined;
  return value;
}

/** setやmodify/addの量など、mapのキー経由ではなく値ノードから直接取り出す数値リテラル。
 * yamlMapping.tsのrequireNumber等はmap+key単位でしか扱えないため、値ノードを直接受け取るここだけの薄いラッパー。 */
export function parseNumberLiteral(context: string, raw: string): number {
  const value = tryParseNumber(raw);
  if (value === undefined) throw new YamlLoadError(`${context}: 数値である必要があります（値: '${raw}'）。`);
  return value;
}

/** シンボル型の値として許容する識別子の形（3.2節の命名規則と同じ）。 */
const SYMBOL_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * 数値・真偽値・シンボル名（識別子）のいずれかとして値を解釈する。識別子形の文字列は
 * symbolNamesへ登録してグローバルIDを返す（シンボル型のprops、6節。専用の宣言は不要で
 * `value`の形だけで判別する）。"true"/"false"がシンボルとして解釈されないよう、判定順は
 * 数値→真偽値→シンボルで固定する。2番目の戻り値は、rawがシンボル名として登録された場合にtrueになる
 * （stagesの解釈分岐、6.4節）。
 */
export function parseScalarNumber(
  loader: WorldCodexYamlLoader,
  context: string,
  raw: string,
): [number, boolean] {
  const numberValue = tryParseNumber(raw);
  if (numberValue !== undefined) return [numberValue, false];

  const lowered = raw.toLowerCase();
  if (lowered === 'true') return [1, false];
  if (lowered === 'false') return [0, false];

  if (SYMBOL_PATTERN.test(raw)) return [loader.symbolNames.intern(raw), true];

  throw new YamlLoadError(
    `${context}: 値 '${raw}' は数値・真偽値・シンボル名(識別子)のいずれかである必要があります。`,
  );
}
