import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 一次の分析係の記録（`.claude/analysis/<日付>.md`）が、係の本文（`.claude/analysis-prompt.md`）の
 * 定めた節を持っていることの検査。
 *
 * **この係は過去の回の記録を読まない**（`.claude/board-design.md` 2.17.4）ので、記録の書き方が
 * 回ごとにずれても、次の回には何も届かない。**定めを置ける場所は本文だけで、守られたかを見る者は
 * 居ない**——読んだスメルのうち issue にしなかったものは、コメントへ 👀 が付いた時点で二度と
 * 拾われないので、記録から落ちるとそのまま消える。
 *
 * **要る節は本文から引く。** ここへ節名を書き写すと、本文を直したときに写しだけが古くなる。
 */

const ROOT = resolve(__dirname, '../..');
const PROMPT = join(ROOT, '.claude', 'analysis-prompt.md');
const RECORDS = join(ROOT, '.claude', 'analysis');

/**
 * 検査の掛かる回。**これより前の回は、当時の定めで書かれたその時点の記録**で、後から書き換える
 * 先ではない（`tests/docs/githubAccess.test.ts` が `analysis/` を降りないのと同じ理由）。節を
 * 足した日（2026-09-11）に走る回は、この定めが入る前に記録を書いているので、翌日から。
 */
const RECORDS_FROM = '2026-09-12';

/** 記録の節を定めている節の見出し。本文はひな形の囲みの中に在るので、原文から引く。 */
const RECORD_SECTION = '## 記録';

/** 本文の「記録」の節に並ぶ箇条書きと、そこから引けた見出し。 */
function recordSections(): { readonly bullets: number; readonly headings: readonly string[] } {
  const lines = readFileSync(PROMPT, 'utf-8').split(/\r?\n/);
  const start = lines.findIndex((line) => line === RECORD_SECTION);
  if (start < 0) throw new Error(`${RECORD_SECTION} が ${PROMPT} に無い`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  const block = end < 0 ? rest : rest.slice(0, end);
  return {
    bullets: block.filter((line) => line.startsWith('- ')).length,
    headings: block.flatMap((line) => {
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
