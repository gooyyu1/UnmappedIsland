import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { BalanceTables } from '../../src/analysis/balanceTables';
import { buildBalanceTables } from '../../src/analysis/balanceTables';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * ゲーム本体に同梱されるWorldCodex定義YAMLの置き場所（テストはリポジトリルートで実行される前提）。
 * ここを丸ごと読むため、ファイルを増やしてもテスト側の変更は要らない（src/loader/loadWorldCodex.ts）。
 */
export const WORLD_CODEX_DIR = 'src/assets/world-codex';

/**
 * キャラクタの個体差に関心が無いテストで代表として使うプレイヤーキャラクタ
 * （docs/world/Characters.md）。どのキャラクタでも成り立つはずの検証をここへ集める。
 */
export const SAMPLE_CHARACTER = 'medic';

/** WORLD_CODEX_DIR内の1ファイルへのパス。 */
export function worldCodexPath(fileName: string): string {
  return join(WORLD_CODEX_DIR, fileName);
}

/** 1つのYAMLファイルを読み込んでローダーへ渡す。 */
export function loadYamlFile(loader: WorldCodexYamlLoader, path: string): WorldCodexYamlLoader {
  return loader.load(path, readFileSync(path, 'utf8'));
}

/**
 * 1つのディレクトリ以下の*.yaml/*.ymlファイルを再帰的にすべて読み込む。
 * 読み込み順はフルパスの辞書順（コードポイント昇順）で決定的にする。
 */
export function loadYamlDirectory(loader: WorldCodexYamlLoader, directory: string): WorldCodexYamlLoader {
  for (const path of findYamlFiles(directory)) loadYamlFile(loader, path);
  return loader;
}

/**
 * 同梱ぶんだけを読んで組み上げたWorldCodex。**何度呼んでも同じものが返る**（1回の組み上げに
 * 200msかかるので、テストの間で使い回す）。
 *
 * **返ったcodexを書き換えてはいけない。** 同じワーカーで走る後続のテストが同じものを受け取る。
 * WorldCodexはロードが済めば不変（src/domain/WorldCodex.ts）なので、守っている限り読み手どうしは
 * 互いに影響しない。定義を足したり差し替えたりして試したいテストは、ここを通さず自分でloaderを組む。
 */
export function bundledCodex(): WorldCodex {
  bundled ??= loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  return bundled;
}

let bundled: WorldCodex | undefined;

/**
 * 同梱の定義を {@link SAMPLE_CHARACTER} で解いた収支表。**何度呼んでも同じものが返る**。
 *
 * 1回の組み立てで1件あたりの上限（`vite.config.ts` の `testTimeout`）の4割ほどを使うので、
 * **呼ぶのはモジュールの直下か `describe` の直下だけ**——収集の時に組めば、どの検査の上限にも
 * 掛からない。`it` の中で呼ぶと、ワーカーで最初に呼んだ検査が組み立てを丸ごと払い、混んだ回に越える。
 * 呼ぶ場所は tests/architecture/bundledBalanceTables.test.ts が見張る。
 *
 * **返った表を書き換えてはいけない。** 理由は {@link bundledCodex} と同じ。
 */
export function bundledBalanceTables(): BalanceTables {
  bundledTables ??= buildBalanceTables(bundledCodex(), SAMPLE_CHARACTER);
  return bundledTables;
}

let bundledTables: BalanceTables | undefined;

/** WORLD_CODEX_DIR以下のYAMLファイルのパス一覧（定義ファイルの字面を検査するテスト向け）。 */
export function worldCodexYamlPaths(): readonly string[] {
  return findYamlFiles(WORLD_CODEX_DIR);
}

function findYamlFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true, recursive: true })) {
    const extension = extname(entry.name).toLowerCase();
    if (entry.isFile() && (extension === '.yaml' || extension === '.yml'))
      found.push(join(entry.parentPath, entry.name));
  }
  return found.sort();
}
