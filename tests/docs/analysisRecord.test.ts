import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 分析係の記録が、係の本文（`.claude/*-prompt.md`）の定めた節を持っていることの検査。
 *
 * **一次も二次も同じ形で回る**（{@link SERIES}）——どちらも本文の `## 記録` が置く節を並べ、1回1
 * ファイルで日付の名前を付ける。**見る仕組みを分ける差は無い**ので、置き場と本文だけを変えて同じ
 * 1つを掛ける。
 *
 * 検査がここに要るのは、**記録の書き方がずれても次の回には何も届かない**ため。一次が過去の回の記録を
 * 開くのはその回のスメルが名指した行を確かめるときだけ（`.claude/board-design.md` 2.17.4）で、
 * 二次が必ず読むのも直前の1件までしかない。**定めを置ける場所は本文だけなので、守られたかを見るのは
 * ここ**——読んだスメルのうち issue にしなかったものは、コメントへ 👀 が付いた時点で二度と拾われない
 * ので、記録から落ちるとそのまま消える。
 *
 * **要る節は本文から引く。** ここへ節名を書き写すと、本文を直したときに写しだけが古くなる。
 */

const ROOT = resolve(__dirname, '../..');

/** 記録を書く係。 */
interface Series {
  /** 失敗メッセージに出す名前。 */
  readonly name: string;
  /** 記録の節を定めている本文。 */
  readonly prompt: string;
  /** 記録の置き場。 */
  readonly dir: string;
  /**
   * 検査の掛かる最初の回（`YYYY-MM-DD`）。**これより前の回は、当時の定めで書かれたその時点の記録**
   * で、後から書き換える先ではない（`tests/docs/githubAccess.test.ts` が `analysis/` を降りないのと
   * 同じ理由）。
   *
   * **置いた係は、その日付の回が書かれるまで1件も見ない**——「揃っている」と「1件も見ていない」は
   * 緑では区別が付かないので、**置くのは、今在る回が当時の定めで書かれていて満たしようがないときだけ**。
   * 満たしているなら置かず、全部の回に掛ける。
   */
  readonly from?: string;
}

const SERIES: readonly Series[] = [
  {
    name: '一次',
    prompt: join(ROOT, '.claude', 'analysis-prompt.md'),
    dir: join(ROOT, '.claude', 'analysis'),
    // 節を足した日に走る回は、この定めが入る前に記録を書いている。**日付を付けるのは記録を書く係で、
    // クラウドなら UTC・手元なら日本時間**と、どちらの日境で切るかは決まっていないため、
    // `## 開いた過去の記録` を足した回（UTC の 2026-09-11、日本時間の 2026-09-12）はどちらも外す。
    from: '2026-09-13',
  },
  {
    name: '二次',
    prompt: join(ROOT, '.claude', 'analysis-trend-prompt.md'),
    dir: join(ROOT, '.claude', 'analysis', 'summary'),
  },
];

/** 記録の節を定めている節の見出し。本文はひな形の囲みの中に在るので、原文から引く。 */
const RECORD_SECTION = '## 記録';

/**
 * 本文の「記録」の節が**最初に並べた箇条書き**と、そこから引けた見出し。置く節を並べているのが
 * この一覧で、節の後ろに続く補足の箇条書きまで見出しの定義として読まない。
 */
function recordSections(prompt: string): {
  readonly bullets: number;
  readonly headings: readonly string[];
} {
  const lines = readFileSync(prompt, 'utf-8').split(/\r?\n/);
  const start = lines.findIndex((line) => line === RECORD_SECTION);
  if (start < 0) throw new Error(`${RECORD_SECTION} が ${prompt} に無い`);
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

/** 記録のファイル名と中身。下の階層は別の係の置き場なので降りない。 */
function records(dir: string): readonly { readonly name: string; readonly text: string }[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => ({ name: entry.name, text: readFileSync(join(dir, entry.name), 'utf-8') }));
}

/** 記録に書かれていない、要る見出し。 */
function missingHeadings(text: string, headings: readonly string[]): string[] {
  const written = new Set(text.split(/\r?\n/).map((line) => line.trim()));
  return headings.filter((heading) => !written.has(heading));
}

/** 節の検査が実際に掛かる回。日付で始まらない記録は回を引けないので外れる。 */
function checkedRecords(dir: string, from: string | undefined) {
  return records(dir).filter(
    ({ name }) => /^\d{4}-\d{2}-\d{2}/.test(name) && name.slice(0, 10) >= (from ?? ''),
  );
}

describe.each(SERIES)('$name の分析の記録', ({ prompt, dir, from }: Series) => {
  // 引けなかった節は、下の検査から黙って外れる——節を1つ足したのに要求が増えない、が緑で通る。
  it('要る節を本文の箇条書きから全部引けている', () => {
    const { bullets, headings } = recordSections(prompt);

    expect(headings.length).toBeGreaterThan(1);
    expect(headings.length).toBe(bullets);
  });

  // 二次の係は回の前後をファイル名の文字列の大小で並べる（`.claude/board-design.md` 2.17.4）。
  // 日付で始まらない記録は、そこから外れるうえ、下の検査でも回を引けない。
  it('記録は日付で始まる', () => {
    expect(records(dir).filter(({ name }) => !/^\d{4}-\d{2}-\d{2}/.test(name))).toEqual([]);
  });

  it('記録が本文の定めた節を持つ', () => {
    const { headings } = recordSections(prompt);
    const missing = checkedRecords(dir, from)
      .map(({ name, text }) => ({ name, missing: missingHeadings(text, headings) }))
      .filter((record) => record.missing.length > 0);

    expect(missing).toEqual([]);
  });
});

describe('節の照合', () => {
  // 上の検査は「節が揃っている」と「節を1つも要求していない」を緑では区別できないので、要求が
  // 実際に効くことを既知の入力で別に確かめる。
  it('定めた節が記録に無ければ、その節を挙げる', () => {
    expect(missingHeadings('## 読んだ範囲\n本文\n', ['## 読んだ範囲', '## 切った issue'])).toEqual([
      '## 切った issue',
    ]);
  });

  it('少なくとも1つの係が、記録を実際に見ている', () => {
    // 起点（`Series.from`）を置いた係は、その日付の回が書かれるまで1件も見ない。全部の係がそう
    // なると、上の「記録が本文の定めた節を持つ」は**1件も読まないまま緑**になる。
    const seen = SERIES.map(({ name, dir, from }) => `${name}: ${checkedRecords(dir, from).length}`);
    const total = SERIES.reduce((sum, { dir, from }) => sum + checkedRecords(dir, from).length, 0);

    expect(total, `どの係も記録を見ていない（見た件数 — ${seen.join('・')}）`).toBeGreaterThan(0);
  });
});
