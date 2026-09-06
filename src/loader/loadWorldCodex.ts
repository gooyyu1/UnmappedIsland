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

/** 同梱ぶんのパース結果の控え。同梱YAMLは実行中に変わらないので、読み込みをまたいで残せる。 */
let bundledDocuments: ReadonlyMap<string, Document> | undefined;

/**
 * 同梱ぶんを読むためのDocument（ファイル名順）。**控えをそのまま配る**——同じ文字列を読み込みの
 * たびにパースし直すのは高い（同梱ぶん全体で約180ms。2026-09-06計測）。
 *
 * 複製を挟まずに配れるのは、patch（GameElementDefinition.md 3.4節）が書き換えるのは名指しされた
 * 宣言のノードだけで、そこはRawObjectDefが自分の複製へ移してから書き換えるため
 * （RawObjectDef.modifyDeclaration）。
 */
function bundledDocumentsToRead(): ReadonlyMap<string, Document> {
  bundledDocuments ??= new Map(
    [...WORLD_CODEX_TEXTS].map(([file, text]): [string, Document] => [file, parseDocument(text)]),
  );
  return bundledDocuments;
}

/**
 * 定義YAMLを読んでWorldCodexを組み立てる。**同梱ぶんが先、アセットパックのぶんは渡された順**
 * （AssetPack.md 6.2節）。書式の誤りも識別子の重複もYamlLoadErrorのまま呼び出し側へ出す。
 */
export function loadWorldCodex(packs: readonly AssetPack[], report: LoadReport): WorldCodex {
  const loader = new WorldCodexYamlLoader();
  // 同梱ぶんは報告先を渡さない＝patchの誤りも投げる（AssetPack.md 6.1節）。
  for (const [file, doc] of bundledDocumentsToRead()) loader.loadDocument(file, doc);
  for (const pack of packs)
    for (const [file, text] of pack.worldCodexTexts()) loader.load(file, text, { name: pack.name, report });
  return loader.buildAndReset();
}
