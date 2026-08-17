import type { AssetPack } from '../asset-pack/AssetPack';
import type { LoadReport } from './LoadReport';
import type { WorldCodex } from '../domain/defs/WorldCodex';
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
 * 定義YAMLを読んでWorldCodexを組み立てる。同梱ぶんが先、アセットパックのぶんが後
 * （AssetPack.md）。書式の誤りも識別子の重複もYamlLoadErrorのまま呼び出し側へ出す。
 */
export function loadWorldCodex(pack: AssetPack | undefined, report: LoadReport): WorldCodex {
  const loader = new WorldCodexYamlLoader();
  // 同梱ぶんは報告先を渡さない＝patchの誤りも投げる（AssetPack.md 6.1節）。
  for (const [file, text] of WORLD_CODEX_TEXTS) loader.load(file, text);
  if (pack !== undefined) for (const [file, text] of pack.worldCodexTexts()) loader.load(file, text, report);
  return loader.build();
}
