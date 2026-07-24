import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import type { YAMLMap } from 'yaml';
import {
  asMap,
  asScalarText,
  entriesInOrder,
  requireInt,
  requireScalar,
  tryGetBool,
  tryGetInt,
  tryGetMap,
  tryGetNumber,
  tryGetScalar,
  tryGetSeq,
} from '../../src/loader/yamlMapping';
import { YamlLoadError } from '../../src/loader/YamlLoadError';

function parseMap(yamlText: string): YAMLMap {
  return asMap(parseDocument(yamlText).contents, 'test');
}

describe('yamlMapping', () => {
  const map = parseMap(`
name: apple
count: 3
weight: 1.5
flag: true
empty:
nested:
  a: 1
items:
  - x
  - y
`);

  it('tryGetScalarはスカラーを文字列として返し、無いキーはundefined', () => {
    expect(tryGetScalar(map, 'name', 'ctx')).toBe('apple');
    expect(tryGetScalar(map, 'count', 'ctx')).toBe('3');
    expect(tryGetScalar(map, 'missing', 'ctx')).toBeUndefined();
  });

  it('値なしのキーは空文字列のスカラーとみなす', () => {
    expect(tryGetScalar(map, 'empty', 'ctx')).toBe('');
  });

  it('スカラーが期待される場所のマッピングはエラー', () => {
    expect(() => tryGetScalar(map, 'nested', 'ctx')).toThrow(YamlLoadError);
    expect(() => tryGetScalar(map, 'nested', 'ctx')).toThrowError(/ctx: 'nested' はスカラー値/);
  });

  it('requireScalarは必須フィールドの欠落をエラーにする', () => {
    expect(requireScalar(map, 'name', 'ctx')).toBe('apple');
    expect(() => requireScalar(map, 'missing', 'ctx')).toThrowError(/必須フィールド 'missing'/);
  });

  it('requireInt/tryGetIntは整数だけを受け付ける', () => {
    expect(requireInt(map, 'count', 'ctx')).toBe(3);
    expect(tryGetInt(map, 'missing', 'ctx')).toBeUndefined();
    expect(() => requireInt(map, 'weight', 'ctx')).toThrowError(/'weight' は整数/);
    expect(() => requireInt(map, 'name', 'ctx')).toThrowError(/'name' は整数/);
  });

  it('tryGetNumberは小数を受け付ける', () => {
    expect(tryGetNumber(map, 'weight', 'ctx')).toBe(1.5);
    expect(tryGetNumber(map, 'count', 'ctx')).toBe(3);
    expect(() => tryGetNumber(map, 'name', 'ctx')).toThrowError(/'name' は数値/);
  });

  it('tryGetBoolは真偽値を解釈し、無いキーはfallback', () => {
    expect(tryGetBool(map, 'flag', 'ctx', false)).toBe(true);
    expect(tryGetBool(map, 'missing', 'ctx', true)).toBe(true);
    expect(() => tryGetBool(map, 'name', 'ctx', false)).toThrowError(/'name' は真偽値/);
  });

  it('tryGetMap/tryGetSeqは型の合わないノードをエラーにする', () => {
    expect(tryGetMap(map, 'nested', 'ctx')).toBeDefined();
    expect(tryGetSeq(map, 'items', 'ctx')?.items).toHaveLength(2);
    expect(() => tryGetMap(map, 'items', 'ctx')).toThrowError(/'items' はマッピング/);
    expect(() => tryGetSeq(map, 'nested', 'ctx')).toThrowError(/'nested' は配列/);
  });

  it('entriesInOrderは宣言順を保つ', () => {
    const keys = entriesInOrder(map).map(([key]) => key);
    expect(keys).toEqual(['name', 'count', 'weight', 'flag', 'empty', 'nested', 'items']);
  });

  it('asScalarTextは配列要素のスカラーを取り出せる', () => {
    const items = tryGetSeq(map, 'items', 'ctx');
    expect(items?.items.map((item) => asScalarText(item, 'ctx'))).toEqual(['x', 'y']);
  });
});
