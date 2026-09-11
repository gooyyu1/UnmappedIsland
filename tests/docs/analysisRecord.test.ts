import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 一次の分析係の記録（`.claude/analysis/<日付>.md`）が、係の本文（`.claude/analysis-prompt.md`）の
 * 定めた節を持っていることの検査。
 *
 * **この係が過去の回の記録を開くのは、その回のスメルが名指した行を確かめるときだけ**
 * （`.claude/board-design.md` 2.17.4）なので、記録の書き方が回ごとにずれても、次の回には何も届かない。
 * **定めを置ける場所は本文だけなので、守られたかを見るのはここ**——読んだスメルのうち issue に
 * しなかったものは、コメントへ 👀 が付いた時点で二度と拾われないので、記録から落ちるとそのまま消える。
 *
 * **要る節は本文から引く。** ここへ節名を書き写すと、本文を直したときに写しだけが古くなる。
 */

const ROOT = resolve(__dirname, '../..');
const PROMPT = join(ROOT, '.claude', 'analysis-prompt.md');
const RECORDS = join(ROOT, '.claude', 'analysis');

/**
 * 検査の掛かる回。**これより前の回は、当時の定めで書かれたその時点の記録**で、後から書き換える
 * 先ではない（`tests/docs/githubAccess.test.ts` が `analysis/` を降りないのと同じ理由）。節を
 * 足した日に走る回は、この定めが入る前に記録を書いているので、翌日から——**日付を付けるのは記録を
 * 書く係で、クラウドなら UTC・手元なら日本時間**と、どちらの日境で切るかは決まっていないため、
 * `## 開いた過去の記録` を足した回（UTC の 2026-09-11、日本時間の 2026-09-12）はどちらも外す。
 */
const RECORDS_FROM = '2026-09-13';

/** 記録の節を定めている節の見出し。本文はひな形の囲みの中に在るので、原文から引く。 */
const RECORD_SECTION = '## 記録';

/**
 * 本文の「記録」の節が**最初に並べた箇条書き**と、そこから引けた見出し。置く節を並べているのが
 * この一覧で、節の後ろに続く補足の箇条書きまで見出しの定義として読まない。
 */
function recordSections(): { readonly bullets: number; readonly headings: readonly string[] } {
  const lines = readFileSync(PROMPT, 'utf-8').split(/\r?\n/);
  const start = lines.findIndex((line) => line === RECORD_SECTION);
  if (start < 0) throw new Error(`${RECORD_SECTION} が ${PROMPT} に無い`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  const block = end < 0 ? rest : rest.slice(0, end);
  const first = block.findIndex((line) => line.startsWith('- '));
  if (first < 0) throw new Error(`置く節の一覧が ${RECORD_SECTION} に無い`);
  // 一覧の終わりは空行。項目が折り返した続きの行は字下げで続くので、そこでは切れない。
  const after = block.slice(first).findIndex((line) => line.trim() === '');
  const list = block.slice(first, after < 0 ? undefined : first + after);
  return {
    bullets: list.filter((line) => line.startsWith('- ')).length,
    headings: list.flatMap((line) => {
      const found = /^- \*\*`(## [^`]+)`\*\*/.exec(line);
      return found ? [found[1]] : [];
    }),
  };
}

/** 記録が持つべき見出し。 */
function requiredHeadings(): readonly string[] {
  return recordSections().headings;
}

/** 記録のファイル名と中身。`summary/` は二次の係の出力なので降りない。 */
function records(): readonly { readonly name: string; readonly text: string }[] {
  return readdirSync(RECORDS, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => ({ name: entry.name, text: readFileSync(join(RECORDS, entry.name), 'utf-8') }));
}

describe('一次の分析の記録', () => {
  // 引けなかった節は、下の検査から黙って外れる——節を1つ足したのに要求が増えない、が緑で通る。
  it('要る節を本文の箇条書きから全部引けている', () => {
    const { bullets, headings } = recordSections();

    expect(headings.length).toBeGreaterThan(1);
    expect(headings.length).toBe(bullets);
  });

  // 二次の係は回の前後をファイル名の文字列の大小で並べる（`.claude/board-design.md` 2.17.4）。
  // 日付で始まらない記録は、そこから外れるうえ、下の検査でも回を引けない。
  it('記録は日付で始まる', () => {
    expect(records().filter(({ name }) => !/^\d{4}-\d{2}-\d{2}/.test(name))).toEqual([]);
  });

  it('記録が本文の定めた節を持つ', () => {
    const headings = requiredHeadings();
    const missing = records()
      .filter(({ name }) => /^\d{4}-\d{2}-\d{2}/.test(name) && name.slice(0, 10) >= RECORDS_FROM)
      .map(({ name, text }) => {
        const written = new Set(text.split(/\r?\n/).map((line) => line.trim()));
        return { name, missing: headings.filter((heading) => !written.has(heading)) };
      })
      .filter((record) => record.missing.length > 0);

    expect(missing).toEqual([]);
  });
});
