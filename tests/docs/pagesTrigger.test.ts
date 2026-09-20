import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * `CLAUDE.md`「公開サイト（GitHub Pages）」節が、`pages.yml` の現物と食い違っていないかの検査。
 *
 * あの節が置く主張は2種類——**走る条件**と、**サイトのパスごとの出どころ**。どちらも
 * `pages.yml` を書き換えれば嘘になるが、**書き換えても CI も公開サイトも緑のまま**通るので、
 * 気づく者が居ない。節の「Pandoc」が実際にそうやって嘘になった
 * （[issue #2266](https://github.com/gooyyu1/UnmappedIsland/issues/2266)）。
 *
 * **写しを持たないのが要点。** 走る条件は絞りが在ることだけを見て、**どの場所が挙がっているかは
 * 見ない**。出どころは**節の表を読んでから**突き合わせるので、行が増えても検査を書き足さずに済む
 * ——ここへ並べ直せば、並びのほうが古びる（`CLAUDE.md`「数え上げを書かない」）。
 */

const ROOT = resolve(__dirname, '../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/pages.yml');
const GUIDE = resolve(ROOT, 'CLAUDE.md');

/** 表を探す節の見出し。 */
const SECTION = '## 公開サイト（GitHub Pages）';

/** 節の表の行。`| \`/docs/\` | … |` の形だけを拾う。 */
const TABLE_ROW = /^\|\s*`\/([^/`]+)\/`\s*\|(.*)\|\s*$/;

/** {@link SECTION} の本文。**他の節の表を巻き込まない**よう、次の見出しで切る。 */
function section(): readonly string[] {
  const lines = readFileSync(GUIDE, 'utf-8').split('\n');
  const from = lines.indexOf(SECTION);
  if (from < 0) throw new Error(`CLAUDE.md に ${SECTION} が無い`);
  const rest = lines.slice(from + 1);
  const to = rest.findIndex((line) => line.startsWith('## '));
  return to < 0 ? rest : rest.slice(0, to);
}

/** 出どころの欄で在り処を名指している部分。実在するファイルだけを {@link pointedAt} が拾う。 */
const QUOTED = /`([^`]+)`/g;

/**
 * 突き合わせる先。**`on:` の絞りは含めない**——あそこにはリポジトリの主だったファイルが並んでいる
 * ので、含めると**手順をやめても絞りの側が当たって緑のまま**になる。見たいのは手順のほうだけ。
 */
function steps(): string {
  const source = readFileSync(WORKFLOW, 'utf-8');
  const at = source.indexOf('\njobs:');
  if (at < 0) throw new Error('pages.yml に `jobs:` が無い');
  return source.slice(at);
}

/** 節が在り処として指している綴り。**これが動いたら、この検査は別の主張を見張っている。** */
const POINTER = '`on.push.paths`';

/** `pages.yml` の `on.push`。 */
function pushTrigger(): Record<string, unknown> {
  const workflow = parse(readFileSync(WORKFLOW, 'utf-8')) as {
    on?: { push?: Record<string, unknown> };
  };
  const push = workflow.on?.push;
  if (push === undefined) throw new Error('pages.yml の `on` に `push` が無い');
  return push;
}

describe('公開サイトの作り直しが走る条件', () => {
  it('`CLAUDE.md` が、条件の在り処として `on.push.paths` を指している', () => {
    expect(
      readFileSync(GUIDE, 'utf-8').includes(POINTER),
      `節の指し先が動いた。${POINTER} を見張っているこの検査も、新しい指し先へ合わせる`,
    ).toBe(true);
  });

  it('`pages.yml` の `on.push` に、触った場所の絞りが在る', () => {
    expect(
      pushTrigger().paths,
      '絞りを外すと、`CLAUDE.md` の「挙がっている場所を触った push だけ」が嘘になる',
    ).toEqual(expect.arrayContaining([expect.any(String)]));
  });
});

/**
 * 節の表が指している在り処を、`[何の行か, 綴り]` で返す。
 *
 * 拾うのは**サイトのパスそのもの**（`/docs/` なら出力先の `site/docs`）と、**出どころの欄が名指した
 * 実在のファイル**（`scripts/buildDocsSite.mjs`）。`docs/**\/*.md` のような綴りや `*.html` は
 * 実在しないので落ち、**フォルダも落とす**——`src/`・`codex/` は入力の在り処で、手順の側に同じ
 * 綴りが出るとは限らない。**実在するファイルだけを課す**のは、表の欄が在り処ではなく説明を
 * 書いていても検査が要求を出さないようにするため。
 */
function pointedAt(): readonly (readonly [string, string])[] {
  const found: (readonly [string, string])[] = [];
  for (const line of section()) {
    const row = TABLE_ROW.exec(line.trim());
    if (row === null) continue;
    const [, name, origin] = row;
    found.push([`/${name}/`, `site/${name}`]);
    for (const [, quoted] of origin.matchAll(QUOTED)) {
      const path = resolve(ROOT, quoted);
      if (existsSync(path) && statSync(path).isFile()) found.push([`/${name}/`, quoted]);
    }
  }
  return found;
}

describe('公開サイトの出どころ', () => {
  // 表が行を持たなくなったら、下の検査は何も見ていないのと同じになる（空の配列はいつでも通る）。
  it('節の表から、行が読めている', () => {
    expect(pointedAt().length, '節の表の書き方が変わった。行を拾う形を現物へ合わせる').toBeGreaterThan(0);
  });

  it.each(pointedAt())('%s の行が指す `%s` が、`pages.yml` に在る', (_row, target) => {
    expect(
      steps().includes(target),
      '`pages.yml` がその手順をやめると、節の表だけが静かに嘘になる',
    ).toBe(true);
  });
});
