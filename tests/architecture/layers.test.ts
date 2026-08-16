import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 層の境界の検査（docs/engine/Layers.md 1節）。
 *
 * **Phaserを知らないと言っている層が、本当に知らないままか**を見る。import を辿るので、間に何本
 * 挟まっていても見つかる——`ShownCards` が `Card.ts` の値を1つ輸入した瞬間に落ちる、という粒度。
 *
 * 名前や置き場所の規約ではなく**到達可能性**を見るのは、これが層の値打ちそのものだから。Phaserを
 * 持ち込まない限り、その層は画面を作らずに確かめられる（tests/game/shownCards.test.ts ほか）。
 */

const ROOT = resolve(__dirname, '../..');

/** Phaserへ到達してはいけない置き場（Layers.md 4節）。 */
const PHASER_FREE = [
  'src/domain',
  'src/loader',
  'src/locale',
  'src/save',
  'src/scenario',
  'src/util',
  'src/assets',
  'src/game/view',
  'src/game/looks',
];

/** そのディレクトリ以下の.tsファイル（リポジトリ相対）。 */
function sourcesIn(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...sourcesIn(rel));
    else if (entry.endsWith('.ts')) found.push(rel);
  }
  return found;
}

/**
 * そのファイルが**実行時に**読み込む先（相対指定は解決して、パッケージ名はそのまま）。
 *
 * `import type` は数えない。契約（`CardContent`・`StatusContent` ほか）を定めるのは部品側で、映しは
 * それを型として輸入する（Layers.md 4節）——型はビルドで消えるので、Phaserは付いてこない。
 */
function importsOf(rel: string): readonly string[] {
  const source = readFileSync(join(ROOT, rel), 'utf-8');
  const specifiers = [
    // import ... from '…' / export ... from '…'（先頭が type のものは除く）
    ...[...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+([^'"()]*?)\s*from\s*['"]([^'"]+)['"]/g)]
      .filter((m) => !m[1].trimStart().startsWith('type'))
      .map((m) => m[2]),
    // 副作用だけの import と、動的 import
    ...[...source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ...[...source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
  ];

  return specifiers.map((specifier) => {
    if (!specifier.startsWith('.')) return specifier;
    const resolved = join(dirname(rel), specifier).replaceAll('\\', '/');
    return existsSync(join(ROOT, `${resolved}.ts`)) ? `${resolved}.ts` : resolved;
  });
}

/**
 * そのファイルからPhaserへ至る経路（無ければundefined）。同じファイルを2度辿らないので、循環が
 * あっても止まる。
 */
function pathToPhaser(entry: string): readonly string[] | undefined {
  const seen = new Set<string>();
  const walk = (rel: string, trail: readonly string[]): readonly string[] | undefined => {
    if (seen.has(rel)) return undefined;
    seen.add(rel);

    for (const target of importsOf(rel)) {
      if (target === 'phaser') return [...trail, rel, 'phaser'];
      if (!target.endsWith('.ts')) continue;
      const found = walk(target, [...trail, rel]);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(entry, []);
}

describe('層の境界', () => {
  it.each(PHASER_FREE)('%s はPhaserへ到達しない', (dir) => {
    const routes = sourcesIn(dir)
      .map((rel) => pathToPhaser(rel))
      .filter((route): route is readonly string[] => route !== undefined)
      .map((route) => route.join(' → '));

    expect(routes, 'この経路のどこかで層をまたいでいる').toEqual([]);
  });

  it('検査対象の置き場が実在する', () => {
    // 引っ越しで置き場が消えたときに、検査が黙って空を通さないようにする。
    expect(PHASER_FREE.filter((dir) => !existsSync(join(ROOT, dir)))).toEqual([]);
    expect(sourcesIn('src/game/view').length).toBeGreaterThan(5);
  });
});
