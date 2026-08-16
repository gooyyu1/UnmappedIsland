import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * ゲーム本体に同梱されるWorldCodex定義YAMLの置き場所（テストはリポジトリルートで実行される前提）。
 * ここを丸ごと読むため、ファイルを増やしてもテスト側の変更は要らない（src/loader/bundledWorldCodex.ts）。
 */
export const WORLD_CODEX_DIR = 'src/world-codex';

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
