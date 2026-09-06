import { parseDocument } from 'yaml';
import type { Document } from 'yaml';
import type { AssetPack } from '../asset-pack/AssetPack';
import type { LoadReport } from './LoadReport';
import type { WorldCodex } from '../domain/WorldCodex';
import { WorldCodexYamlLoader } from './WorldCodexYamlLoader';

/**
 * 同梱されるWorldCodex定義YAMLの中身。規約は「`src/assets/world-codex/` 以下にYAMLを置く」のみで、
 * コード側への登録は要らない。一覧はimport.meta.globがビルド時に作る——`public/` 配下に置くと
 * ビルド時にも実行時にも一覧を得る手段が無く、ファイル名をコードに並べることになるため。
 *
 * 拡張子の範囲はテスト側の走査（tests/support/worldCodexFiles.ts）と揃える。片方だけが拾う
 * ファイルがあると、テストは全部通るのにゲームでは定義が欠ける。
 */
const FILES = import.meta.glob('../assets/world-codex/**/*.{yaml,yml}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

/** 同梱WorldCodexのファイル名（src/assets/world-codex/からの相対）と、その中身（ファイル名順）。 */
export const WORLD_CODEX_TEXTS: ReadonlyMap<string, string> = new Map(
  Object.entries(FILES)
    .map(([path, text]): [string, string] => [path.replace(/^.*\/world-codex\//, ''), text])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
);

/**
 * 同梱ぶんのパース結果。**同梱YAMLは実行中に変わらないので、パースは最初の1回だけ**——読み込みは
 * ゲームの起動と試験の1件ごとに何度も走り、そのたびに同じ文字列をパースし直していた（組み上げ
 * 全体200msのうち190msがパース。2026-09-06計測）。
 */
let bundledDocuments: ReadonlyMap<string, Document> | undefined;

/**
 * 同梱ぶんのパース結果の複製（ファイル名順）。**複製を渡す**——読み込んだDocumentはpatch（
 * GameElementDefinition.md 3.4節）が書き換えるので、控えをそのまま渡すと2回目以降の読み込みが
 * 1回目の書き換えを見る。複製はパースより速い（約90ms対190ms。同計測）。
 */
function bundledDocumentCopies(): Iterable<readonly [string, Document]> {
  bundledDocuments ??= new Map(
    [...WORLD_CODEX_TEXTS].map(([file, text]): [string, Document] => [file, parseDocument(text)]),
  );
  return [...bundledDocuments].map(([file, doc]): [string, Document] => [file, doc.clone()]);
}

/**
 * 定義YAMLを読んでWorldCodexを組み立てる。**同梱ぶんが先、アセットパックのぶんは渡された順**
 * （AssetPack.md 6.2節）。書式の誤りも識別子の重複もYamlLoadErrorのまま呼び出し側へ出す。
 */
export function loadWorldCodex(packs: readonly AssetPack[], report: LoadReport): WorldCodex {
  const loader = new WorldCodexYamlLoader();
  // 同梱ぶんは報告先を渡さない＝patchの誤りも投げる（AssetPack.md 6.1節）。
  for (const [file, doc] of bundledDocumentCopies()) loader.loadDocument(file, doc);
  for (const pack of packs)
    for (const [file, text] of pack.worldCodexTexts()) loader.load(file, text, { name: pack.name, report });
  return loader.buildAndReset();
}
