import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 層の境界の検査（docs/CodeStructure.md 1節）。
 *
 * **知らないと言っている層が、本当に知らないままか**を見る。import を辿るので、間に何本挟まって
 * いても見つかる——`ShownCards` が `Card.ts` の値を1つ輸入した瞬間に落ちる、という粒度。
 *
 * 名前や置き場所の規約ではなく**到達可能性**を見るのは、これが層の値打ちそのものだから。Phaserを
 * 持ち込まない限り、その層は画面を作らずに確かめられる（tests/game/shownCards.test.ts ほか）。
 * `src/ui` がこのゲームを知らない限り、そこにあるものはこのゲーム抜きで読める。
 */

const ROOT = resolve(__dirname, '../..');

/** Phaserへ到達してはいけない置き場（CodeStructure.md 1節）。 */
const PHASER_FREE = [
  'src/domain',
  'src/loader',
  'src/locale',
  'src/save',
  'src/scenario',
  'src/util',
  'src/art',
  'src/asset-pack',
  'src/game/view',
  'src/game/looks',
];

/**
 * 解析層（`src/analysis`）へ到達してはいけない置き場（CodeStructure.md 5節）。定義から数値を導く近似の
 * 置き場所なので、**ドメインと遊びの本体はその存在を知らない**。
 */
const ANALYSIS_FREE = ['src/domain', 'src/loader', 'src/locale', 'src/game', 'src/ui'];

/**
 * データベースビューア（`src/codex-viewer`）へ到達してはいけない置き場。守っているのは**表示の語彙**
 * （`DescriptionToken`・リンク・表示名）がビューアの外へ出ないことで、宣言を語にする文そのものは
 * ドメインに置ける——条件の日本語（`conditionWords`）は、収支の表とビューアが同じ文を出すために
 * ドメインへ1つだけ置いてある（issue #987）。
 */
const VIEWER_FREE = ['src/domain', 'src/loader', 'src/locale', 'src/game', 'src/ui', 'src/analysis'];

/** 効果と条件の木そのもの。組み立ててよいのはドメインと、YAMLから作るローダーだけ。 */
const TREE_MODULES = ['src/domain/ActiveEffect.ts', 'src/domain/ConditionNode.ts'];

/** 宣言を読み上げてもらう側の置き場（CodeStructure.md 5節）。 */
const TREE_READERS = ['src/analysis', 'src/codex-viewer'];

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
 * それを型として輸入する（CodeStructure.md 1節）——型はビルドで消えるので、Phaserは付いてこない。
 */
function importsOf(rel: string, includeTypes = false): readonly string[] {
  const source = readFileSync(join(ROOT, rel), 'utf-8');
  const specifiers = [
    // import ... from '…' / export ... from '…'（先頭が type のものは除く）
    ...[...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+([^'"()]*?)\s*from\s*['"]([^'"]+)['"]/g)]
      .filter((m) => includeTypes || !m[1].trimStart().startsWith('type'))
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
 * そのファイルから、行き先に当てはまるものへ至る経路（無ければundefined）。同じファイルを2度
 * 辿らないので、循環があっても止まる。
 */
function pathTo(
  entry: string,
  forbidden: (target: string) => boolean,
  includeTypes = false,
): readonly string[] | undefined {
  const seen = new Set<string>();
  const walk = (rel: string, trail: readonly string[]): readonly string[] | undefined => {
    if (seen.has(rel)) return undefined;
    seen.add(rel);

    for (const target of importsOf(rel, includeTypes)) {
      if (forbidden(target)) return [...trail, rel, target];
      if (!target.endsWith('.ts')) continue;
      const found = walk(target, [...trail, rel]);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(entry, []);
}

/** その置き場から禁じた先へ至る経路を、読める形にして全部並べる。 */
function routesFrom(
  dir: string,
  forbidden: (target: string) => boolean,
  includeTypes = false,
): readonly string[] {
  return sourcesIn(dir)
    .map((rel) => pathTo(rel, forbidden, includeTypes))
    .filter((route): route is readonly string[] => route !== undefined)
    .map((route) => route.join(' → '));
}

/** 構造の文書。1節の表と2節の図が、どちらもここから読める。 */
function structureDoc(): string {
  return readFileSync(join(ROOT, 'docs/CodeStructure.md'), 'utf-8');
}

/**
 * 1節の表の行。**他の節の表を混ぜない**——5節にもドメインと解析を比べる表があり、混ぜると
 * 1節から行が消えてもそちらが拾ってしまう。「1節の表が唯一の記載場所」を検査するのだから、
 * 見る範囲もその表だけ。
 */
function structureRows(): readonly string[] {
  const section = structureDoc()
    .split(/^## /m)
    .find((part) => part.startsWith('1. '));
  if (section === undefined) throw new Error('CodeStructure.md の1節が見つかりません');
  return section.split(/\r?\n/).filter((line) => line.startsWith('| **'));
}

/** 1節の表が並べる構成要素の名前（1列目）。 */
function structureNames(): readonly string[] {
  return structureRows().map((line) => line.split('|')[1].replaceAll('*', '').trim());
}

describe('層の境界', () => {
  it.each(PHASER_FREE)('%s はPhaserへ到達しない', (dir) => {
    expect(
      routesFrom(dir, (target) => target === 'phaser'),
      'この経路のどこかで層をまたいでいる',
    ).toEqual([]);
  });

  it('src/ui はこのゲームへ到達しない', () => {
    // 汎用部品だけを置く場所（CodeStructure.md 1節）。ゲームの語彙も意匠も知らないので、ここにある
    // ものはこのゲームを消しても変わらない。
    expect(
      routesFrom('src/ui', (target) => target.startsWith('src/game/')),
      'この経路のどこかでゲームを覗いている',
    ).toEqual([]);
  });

  it.each(ANALYSIS_FREE)('%s は解析層へ到達しない', (dir) => {
    // **型として輸入するのも数える。** Phaserと違って、ここで守っているのは実行時の依存ではなく
    // 「近似がドメインの語彙に混ざらないこと」——`StaticValueResolver`を引数に取った時点で、
    // その仮定はドメインの契約になってしまう。
    expect(
      routesFrom(dir, (target) => target.startsWith('src/analysis/'), true),
      'この経路のどこかで、定義から数値を導く近似を覗いている',
    ).toEqual([]);
  });

  it.each(VIEWER_FREE)('%s はデータベースビューアへ到達しない', (dir) => {
    // **型として輸入するのも数える。** 守っているのは「表示の語彙がドメインの契約に混ざらないこと」
    // ——`DescriptionWriter`を引数に取った時点で、その型は「どう見せるか」を知ってしまう。
    expect(
      routesFrom(dir, (target) => target.startsWith('src/codex-viewer/'), true),
      'この経路のどこかで、宣言の見せ方を覗いている',
    ).toEqual([]);
  });

  it.each(TREE_READERS)('%s は効果・条件の木そのものを輸入しない', (dir) => {
    // ここだけ到達可能性ではなく**直接の輸入**を見る。読み手が輸入する定義クラスの先には木が居るが、
    // 読み手の手に渡るのは読み下せる宣言（EffectDeclaration・ConditionDeclaration）だけで、
    // 木を直に持てば読むだけでなく適用（apply）・評価（evaluate）までできてしまう。
    const offenders = sourcesIn(dir).filter((rel) =>
      importsOf(rel, true).some((target) => TREE_MODULES.includes(target)),
    );
    expect(offenders, 'このファイルが木そのものを輸入している').toEqual([]);
  });

  it('検査対象の置き場が実在する', () => {
    // 引っ越しで置き場が消えたときに、検査が黙って空を通さないようにする。
    expect(PHASER_FREE.filter((dir) => !existsSync(join(ROOT, dir)))).toEqual([]);
    expect(VIEWER_FREE.filter((dir) => !existsSync(join(ROOT, dir)))).toEqual([]);
    expect(ANALYSIS_FREE.filter((dir) => !existsSync(join(ROOT, dir)))).toEqual([]);
    expect(TREE_MODULES.filter((rel) => !existsSync(join(ROOT, rel)))).toEqual([]);
    expect(TREE_READERS.filter((dir) => !existsSync(join(ROOT, dir)))).toEqual([]);
    expect(sourcesIn('src/analysis').length).toBeGreaterThan(3);
    expect(sourcesIn('src/game/view').length).toBeGreaterThan(5);
    expect(sourcesIn('src/ui').length).toBeGreaterThan(5);
  });

  it('src/ の置き場が、CodeStructure.md の表に出そろっている', () => {
    // 表は「置き場の唯一の記載場所」を名乗る（CodeStructure.md 1節）。名乗るだけでは、置き場を
    // 足したときに書き忘れても誰も気づかない——**数えるのはこちらの仕事**。
    //
    // 表が丸ごと受けている場所はそこで止め、受けていなければ1段降りて確かめる。`src/game/` は
    // ディレクトリごとの行を持たず直下のファイルを列挙しているので、この降り方でだけ拾える。
    const listed = [
      ...structureRows()
        .join('\n')
        .matchAll(/`(src\/[^`]+)`/g),
    ].map((m) => m[1].replace(/\/$/, ''));
    const covers = (path: string): boolean =>
      listed.some((entry) =>
        entry.includes('*')
          ? new RegExp(`^${entry.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*')}$`).test(path)
          : entry === path,
      );

    const missing: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(join(ROOT, dir))) {
        const path = `${dir}/${entry}`;
        // データファイルはコードではないので、どの行にも属さない（CodeStructure.md 1節）。
        if (path === 'src/assets') continue;
        if (covers(path)) continue;
        if (statSync(join(ROOT, path)).isDirectory()) walk(path);
        else missing.push(path);
      }
    };
    walk('src');

    // 逆向きも見る。**片方向だけでは、置き場を消したときに表だけが黙って腐る。**
    const gone = listed.filter((entry) =>
      entry.includes('*')
        ? !readdirSync(join(ROOT, dirname(entry))).some((name) =>
            new RegExp(`^${entry.split('/').pop()?.replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`).test(name),
          )
        : !existsSync(join(ROOT, entry)),
    );

    expect(missing, 'この置き場が表のどの行にも載っていない').toEqual([]);
    expect(gone, '表が挙げているこの置き場が実在しない').toEqual([]);
    expect(listed.length).toBeGreaterThan(10);
  });

  it('依存の図のノードが、1節の表の行と同じ', () => {
    // 表と図は同じものを説明する2つの一覧なので、**並べた時点で行集合の一致を誰かが見る必要が
    // ある**。図が網羅すると言っているのはノードで（CodeStructure.md 2節）、辺は主な向きの要約。
    //
    // ラベルは**丸ごと**取る。`<br/>` の手前で切ると、ノードに置き場を書き足しても検査の外に
    // 出てしまい、1節の表だけが唯一の記載場所だという宣言がそこで破れる。
    const diagram = structureDoc().match(/```mermaid\n([\s\S]*?)```/);
    if (diagram === null) throw new Error('CodeStructure.md の依存の図が見つかりません');
    const nodes = [...diagram[1].matchAll(/^\s+\w+\["([^"]+)"\]/gm)].map((m) => m[1].trim());

    expect([...nodes].sort(), '図のノードと表の行が食い違っている').toEqual([...structureNames()].sort());
    expect(nodes.length).toBeGreaterThan(9);
  });
});
