import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 絵の生成の道具の置き場（tools/comfyui/README.md）。 */
const COMFYUI_DIR = 'tools/comfyui';

/** 絵の注文の置き場（同README「アイテムのプロンプト」）。 */
const PROMPTS_DIR = `${COMFYUI_DIR}/prompts`;

/** 1枚ぶんの生成と後処理の設定の置き場（同README「作り直す」）。 */
const RECIPES_DIR = `${COMFYUI_DIR}/recipes`;

/** レシピが `prompts` を名乗らないときに generate.py が読むファイル（tools/comfyui/generate.py）。 */
const DEFAULT_PROMPTS_FILE = 'lane_backgrounds.json';

/** generate.py がワークフローへ差し込む鍵。この2つを持つものが「今そのまま振れる注文」。 */
const ORDER_KEYS = ['positive', 'negative'] as const;

/**
 * 生成の代わりに絵を作る手（build.py の `build_raw`）。**このどれかを持つレシピは generate.py まで
 * 降りない**ので、そこに `prompt` が在っても誰も振らない。
 */
const INSTEAD_OF_GENERATING = ['underlay', 'stain', 'puff', 'glyph', 'sketch', 'paint'] as const;

type Entry = Record<string, unknown>;
type Recipe = Record<string, unknown>;

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

function jsonFilesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort();
}

/** 本文のエントリ（`_comment` のような、物を指さない鍵を除いたもの）。 */
function entriesOf(file: string): [string, Entry][] {
  return Object.entries(readJson(`${PROMPTS_DIR}/${file}`)).filter(
    (pair): pair is [string, Entry] =>
      !pair[0].startsWith('_') && typeof pair[1] === 'object' && pair[1] !== null,
  );
}

/**
 * そのレシピが generate.py まで降りるか（build.py の `build_raw` と同じ順で見る）。
 *
 * `edit` を持つレシピの基準は、`source` が指す別のレシピ（そちらを単体で読めば足りる）か、
 * `source` を持たないなら自分から `edit` を外したもの。
 */
function reachesGenerate(recipe: Recipe): boolean {
  const edit = recipe.edit;
  if (edit !== undefined) {
    if (typeof edit === 'object' && edit !== null && 'source' in edit) return false;
    return reachesGenerate(Object.fromEntries(Object.entries(recipe).filter(([key]) => key !== 'edit')));
  }
  return !INSTEAD_OF_GENERATING.some((key) => key in recipe);
}

/** レシピを名前順に読んだもの。 */
function recipes(): [string, Recipe][] {
  return jsonFilesIn(RECIPES_DIR).map((file) => [file, readJson(`${RECIPES_DIR}/${file}`)]);
}

/** レシピが名指ししている本文（プロンプト集のファイル名 → その中の名前）。 */
function orderedNames(): Map<string, Set<string>> {
  const ordered = new Map<string, Set<string>>();
  for (const [, recipe] of recipes()) {
    const name = recipe.prompt;
    if (typeof name !== 'string' || !reachesGenerate(recipe)) continue;
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

  /**
   * **下絵へ移したレシピに `prompt` が残ると、上の2つが揃って素通しする**——そのエントリは
   * 「振られている」と数えられ、注文の鍵に残った本文が誰にも咎められない。生成の代わりに絵を
   * 作る手を足したなら、同じ手で `prompt` を落とす。
   */
  it('prompt を持つのは、generate.py まで降りるレシピだけ', () => {
    const wrong: string[] = [];
    for (const [file, recipe] of recipes()) {
      const has = 'prompt' in recipe;
      const reaches = reachesGenerate(recipe);
      if (has && !reaches) wrong.push(`${file} は生成まで降りないのに prompt を持つ`);
      if (!has && reaches) wrong.push(`${file} は生成まで降りるのに prompt が無い`);
    }
    expect(wrong).toEqual([]);
  });

  /**
   * 振らなくなった本文を手で振ろうとしたとき、generate.py が入口で止めて今の作り方を告げること
   * （tools/comfyui/README.md「アイテムのプロンプト」）。**塞ぐのではなく案内板にしてある**ので、
   * 止まることと、行き先を告げることの両方を見る。
   */
  it('retired だけを持つ本文は、generate.py が入口で止めて行き先を告げる', () => {
    const retired = entriesOf('objects.json').find(
      ([, entry]) => 'retired' in entry && !('positive' in entry),
    );
    expect(retired, 'retired だけを持つエントリが objects.json に無い').toBeDefined();

    // 止まる場所を見るための宛先。**生成まで進めば作られる**ので、無いままであることも確かめる。
    const out = join(mkdtempSync(join(tmpdir(), 'prompt-orders-')), 'out');
    const run = spawnSync(
      'python3',
      ['generate.py', retired![0], '--prompts', 'objects.json', '--out', out],
      { cwd: COMFYUI_DIR, encoding: 'utf-8' },
    );

    expect(run.error, `generate.py を起動できない: ${run.error?.message ?? ''}`).toBeUndefined();
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('retired');
    expect(run.stderr).toContain('recipes/');
    expect(existsSync(out)).toBe(false);
  });
});
