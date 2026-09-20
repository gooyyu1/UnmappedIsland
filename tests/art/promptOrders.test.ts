import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 絵の注文の置き場（tools/comfyui/README.md「アイテムのプロンプト」）。 */
const PROMPTS_DIR = 'tools/comfyui/prompts';

/** 1枚ぶんの生成と後処理の設定の置き場（同README「作り直す」）。 */
const RECIPES_DIR = 'tools/comfyui/recipes';

/** レシピが `prompts` を名乗らないときに generate.py が読むファイル（tools/comfyui/generate.py）。 */
const DEFAULT_PROMPTS_FILE = 'lane_backgrounds.json';

/** generate.py がワークフローへ差し込む鍵。この2つを持つものが「今そのまま振れる注文」。 */
const ORDER_KEYS = ['positive', 'negative'] as const;

type Entry = Record<string, unknown>;

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

function jsonFilesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort();
}

/**
 * 本文のエントリ（`_comment` のような、物を指さない鍵を除いたもの）。
 */
function entriesOf(file: string): [string, Entry][] {
  return Object.entries(readJson(`${PROMPTS_DIR}/${file}`)).filter(
    (pair): pair is [string, Entry] =>
      !pair[0].startsWith('_') && typeof pair[1] === 'object' && pair[1] !== null,
  );
}

/**
 * レシピが名指ししている本文（ファイル名 → その中の名前）。
 *
 * **レシピ1つを1つのファイルとして読むだけで足りる。** `edit.source` の連鎖で基準にされる側も
 * `recipes/` の中のファイルなので、ここを走査すれば一緒に拾える（build.py の produce_raw）。
 */
function orderedNames(): Map<string, Set<string>> {
  const ordered = new Map<string, Set<string>>();
  for (const file of jsonFilesIn(RECIPES_DIR)) {
    const recipe = readJson(`${RECIPES_DIR}/${file}`);
    const name = recipe.prompt;
    if (typeof name !== 'string') continue;
    const from = typeof recipe.prompts === 'string' ? recipe.prompts : DEFAULT_PROMPTS_FILE;
    const names = ordered.get(from) ?? new Set<string>();
    names.add(name);
    ordered.set(from, names);
  }
  return ordered;
}

/**
 * 絵の注文（`positive`・`negative`）が、今そのまま振れるものだけになっているかの検査。
 *
 * **振られなくなった本文をその鍵に残すと、散文の断りでは止まらない**——`description` を読まずに
 * 注文の側から入った人が、定義と食い違う本文へそのまま seed を振る（#2411）。走らせた記録は
 * `retired` の下へ移し、注文の鍵には呼び手のあるものだけを置く。
 */
describe('絵の注文', () => {
  it('レシピが名指しする本文は、positive と negative を持つエントリとして在る', () => {
    const missing: string[] = [];
    for (const [file, names] of orderedNames()) {
      const entries = new Map(entriesOf(file));
      for (const name of names) {
        const entry = entries.get(name);
        if (entry === undefined) {
          missing.push(`${file} に ${name} が無い`);
          continue;
        }
        for (const key of ORDER_KEYS) {
          if (typeof entry[key] !== 'string') missing.push(`${file} の ${name} に ${key} が無い`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('どのレシピからも振られない本文は、注文の鍵に残っていない', () => {
    const ordered = orderedNames();
    const left: string[] = [];
    for (const file of jsonFilesIn(PROMPTS_DIR)) {
      const names = ordered.get(file) ?? new Set<string>();
      for (const [name, entry] of entriesOf(file)) {
        if (names.has(name)) continue;
        if (ORDER_KEYS.some((key) => key in entry)) left.push(`${file} の ${name}`);
      }
    }
    expect(left).toEqual([]);
  });
});
