import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 分析係の記録が、係の本文（`agent-ops/prompts/*-prompt.md`）の定めた節を持っていることの検査。
 *
 * **一次も二次も同じ形で回る**（{@link SERIES}）——どちらも本文の `## 記録` が置く節を並べ、1回1
 * ファイルで日付の名前を付ける。**見る仕組みを分ける差は無い**ので、置き場と本文だけを変えて同じ
 * 1つを掛ける。
 *
 * 検査がここに要るのは、**記録の書き方がずれても次の回には何も届かない**ため。一次が過去の回の記録を
 * 開くのはその回のスメルが名指した行を確かめるときだけ（`agent-ops/board-design.md` 2.17.4）で、
 * 二次が必ず読むのも直前の1件までしかない。**定めを置ける場所は本文だけなので、守られたかを見るのは
 * ここ**——読んだスメルのうち issue にしなかったものは、コメントへ 👀 が付いた時点で二度と拾われない
 * ので、記録から落ちるとそのまま消える。
 *
 * **要る節は本文から引く。** ここへ節名を書き写すと、本文を直したときに写しだけが古くなる。
 * **検査が掛かる最初の回（{@link firstCheckedRound}）も同じ理由で本文から引く**——節を足す側が読み書き
 * するのは本文のほうで、値がここに在ると、足した本人ではなく次の回のPRが赤くなる。
 */

const ROOT = resolve(__dirname, '../..');

/**
 * 番号を挙げた節から、行き先の節への追跡。**`## 傾向` の根拠としてだけ現れた形は、コメントへ 👀 が
 * 付いた時点で誰にも拾えなくなる**ので、挙げた番号がどちらかの行き先に現れることを課す
 * （`agent-ops/prompts/analysis-prompt.md` の「記録」）。
 *
 * **節名は本文から引けたものと突き合わせる**（下の「行き先の節名が本文に在る」）ので、本文で節の名前が
 * 変われば、ここの写しは古くなった時点で落ちる。
 */
interface Trace {
  /** 番号を挙げる節。 */
  readonly from: string;
  /**
   * **その回が読んだ番号**を挙げている節。ここに出ていない番号は、この回のスメルではない
   * （既に開いている issue や、前の回のPRへの言及）ので、行き先を課さない。**課すと、書く側の逃げ道は
   * 言及を消すか実体の無い行を足すかになり、見張りが記録を歪める側へ働く。**
   */
  readonly within: string;
  /** 行き先として認める節。 */
  readonly into: readonly string[];
}

/** 記録を書く係。 */
interface Series {
  /** 失敗メッセージに出す名前。 */
  readonly name: string;
  /** 記録の節と、検査の掛かる最初の回を定めている本文。 */
  readonly prompt: string;
  /** 記録の置き場。 */
  readonly dir: string;
  /** 挙げた番号の行き先を課すなら、その組。 */
  readonly trace?: Trace;
}

const SERIES: readonly Series[] = [
  {
    name: '一次',
    prompt: join(ROOT, 'agent-ops', 'prompts', 'analysis-prompt.md'),
    dir: join(ROOT, 'agent-ops', 'analysis'),
    trace: {
      from: '## 傾向',
      within: '## 読んだ範囲',
      into: ['## 切った issue', '## 落としたもの'],
    },
  },
  {
    name: '二次',
    prompt: join(ROOT, 'agent-ops', 'prompts', 'analysis-trend-prompt.md'),
    dir: join(ROOT, 'agent-ops', 'analysis', 'summary'),
  },
];

/** 追跡を課す係。`describe.each` は空の配列では何も登録しないので、居ることを下で別に確かめる。 */
const TRACED = SERIES.filter(
  (series): series is Series & { readonly trace: Trace } => series.trace !== undefined,
);

/** 検査が掛かる最初の回を本文が宣言している行。 */
const FIRST_ROUND = /^\*\*検査が掛かる最初の回\*\*: `(\d{4}-\d{2}-\d{2})`$/m;

/**
 * 検査の掛かる最初の回（`YYYY-MM-DD`）。**これより前の回は、当時の定めで書かれたその時点の記録**で、
 * 後から書き換える先ではない（`agent-ops/board-design.md` 2.17.4）。
 *
 * **置く値は本文が持つ**——節を足したPRが同じ差分で動かせる場所に在れば、足し忘れて赤くなるのも
 * その本人のPRになる。**どこへ動かすかも本文が持つ**（そこが節を足す側の読む場所で、写しをここへ
 * 置くと2つの決め方が並ぶ）。**上げたぶんの回は検査から外れる**ので、上げ過ぎは緑のまま効かなくなる。
 */
function firstCheckedRound(prompt: string): string {
  const found = FIRST_ROUND.exec(readFileSync(prompt, 'utf-8'));
  if (!found) throw new Error(`「検査が掛かる最初の回」の行が ${prompt} に無い`);
  return found[1];
}

/** 記録の節を定めている節の見出し。本文はひな形の囲みの中に在るので、原文から引く。 */
const RECORD_SECTION = '## 記録';

/**
 * `## <見出し>` から次の `## ` の手前までの行。見出しが無ければ `undefined`。**本文の「記録」も記録の
 * 各節も同じ切り方**なので、1つで両方を切る。
 */
function sectionLines(text: string, heading: string): string[] | undefined {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return end < 0 ? rest : rest.slice(0, end);
}

/** その節に挙がっている `#<番号>`。issue とPRを区別しない——行き先として見るのは番号の一致だけ。 */
function numbersIn(text: string, heading: string): Set<string> {
  const block = sectionLines(text, heading) ?? [];
  return new Set([...block.join('\n').matchAll(/#(\d+)/g)].map((found) => found[1]));
}

/** {@link Trace} の要求を満たしていない番号。 */
function strandedNumbers(text: string, trace: Trace): string[] {
  const read = numbersIn(text, trace.within);
  const arrived = new Set(trace.into.flatMap((heading) => [...numbersIn(text, heading)]));
  return [...numbersIn(text, trace.from)]
    .filter((number) => read.has(number) && !arrived.has(number))
    .map((number) => `#${number}`);
}

/**
 * 本文の「記録」の節が**最初に並べた箇条書き**と、そこから引けた見出し。置く節を並べているのが
 * この一覧で、節の後ろに続く補足の箇条書きまで見出しの定義として読まない。
 */
function recordSections(prompt: string): {
  readonly bullets: number;
  readonly headings: readonly string[];
} {
  const block = sectionLines(readFileSync(prompt, 'utf-8'), RECORD_SECTION);
  if (!block) throw new Error(`${RECORD_SECTION} が ${prompt} に無い`);
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
function checkedRecords(dir: string, from: string) {
  return records(dir).filter(
    ({ name }) => /^\d{4}-\d{2}-\d{2}/.test(name) && name.slice(0, 10) >= from,
  );
}

describe.each(SERIES)('$name の分析の記録', ({ prompt, dir }: Series) => {
  // 引けなかった節は、下の検査から黙って外れる——節を1つ足したのに要求が増えない、が緑で通る。
  it('要る節を本文の箇条書きから全部引けている', () => {
    const { bullets, headings } = recordSections(prompt);

    expect(headings.length).toBeGreaterThan(1);
    expect(headings.length).toBe(bullets);
  });

  // 二次の係は回の前後をファイル名の文字列の大小で並べる（`agent-ops/board-design.md` 2.17.4）。
  // 日付で始まらない記録は、そこから外れるうえ、下の検査でも回を引けない。
  it('記録は日付で始まる', () => {
    expect(records(dir).filter(({ name }) => !/^\d{4}-\d{2}-\d{2}/.test(name))).toEqual([]);
  });

  it('記録が本文の定めた節を持つ', () => {
    const { headings } = recordSections(prompt);
    const missing = checkedRecords(dir, firstCheckedRound(prompt))
      .map(({ name, text }) => ({ name, missing: missingHeadings(text, headings) }))
      .filter((record) => record.missing.length > 0);

    expect(
      missing,
      `挙げた回が満たせない定めなら、${prompt} の「検査が掛かる最初の回」を次の回へ動かす`,
    ).toEqual([]);
  });
});

describe.each(TRACED)('$name の記録が挙げた番号', ({ prompt, dir, trace }) => {
  // 節名は本文から引いた見出しと突き合わせる——本文で名前が変われば、{@link SERIES} の写しはここで落ちる。
  it('行き先の節名が本文に在る', () => {
    const { headings } = recordSections(prompt);

    expect(headings).toEqual(expect.arrayContaining([trace.from, trace.within, ...trace.into]));
  });

  it(`\`${trace.from}\` に挙げた番号が、行き先の節にも現れる`, () => {
    const stranded = checkedRecords(dir, firstCheckedRound(prompt))
      .map(({ name, text }) => ({ name, stranded: strandedNumbers(text, trace) }))
      .filter((record) => record.stranded.length > 0);

    expect(
      stranded,
      `${trace.from} に挙げた番号は ${trace.into.join(' か ')} にも書く（行き先の無いスメルは、` +
        '👀 が付いた後は誰にも拾えない）',
    ).toEqual([]);
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

  it('挙げた番号の行き先を、実際に見ている係が居る', () => {
    // `describe.each` は空の配列では `it` を1つも登録しない——**追跡を課す係が居なくなったこと**と
    // 「全部の回が満たしている」は、緑では区別が付かない。
    expect(TRACED.length).toBeGreaterThan(0);
  });

  it('行き先が無ければ、その番号を挙げる', () => {
    // `#33` はその回が読んでいない番号なので、行き先が無くても挙がらない。
    const text =
      '## 読んだ範囲\n#11・#22 を読んだ\n## 傾向\n#11・#22・#33 に出た\n' +
      '## 落としたもの\n#22 は直る先が無い\n';
    const trace = { from: '## 傾向', within: '## 読んだ範囲', into: ['## 落としたもの'] };

    expect(strandedNumbers(text, trace)).toEqual(['#11']);
  });

  it('少なくとも1つの係が、記録を実際に見ている', () => {
    // 起点（本文の「検査が掛かる最初の回」）を先の日付へ置いた係は、その回が書かれるまで1件も見ない。
    // 全部の係がそうなると、上の「記録が本文の定めた節を持つ」は**1件も読まないまま緑**になる。
    const counts = SERIES.map(
      ({ name, prompt, dir }) => [name, checkedRecords(dir, firstCheckedRound(prompt)).length] as const,
    );
    const seen = counts.map(([name, count]) => `${name}: ${count}`);

    expect(
      counts.reduce((sum, [, count]) => sum + count, 0),
      `どの係も記録を見ていない（見た件数 — ${seen.join('・')}）`,
    ).toBeGreaterThan(0);
  });
});

/**
 * 記録が `` ` `` で囲って名指した**他の回の記録**。辿るための指し先なので、置き場が移ったら移した側が
 * 直す（`agent-ops/board-design.md` 2.17.4）。**当時そこに在ったと述べている記述は観測**なので、
 * 日付の付いた記録の名前だけを引く。
 */
const NAMED_ROUND = /`([^`\s]*\/\d{4}-\d{2}-\d{2}[^`\s]*\.md)`/g;

function namedRounds(text: string): string[] {
  return [...text.matchAll(NAMED_ROUND)].map((found) => found[1]);
}

describe('記録が名指した回', () => {
  it('実在する', () => {
    const dead = SERIES.flatMap(({ dir }) =>
      records(dir).flatMap(({ name, text }) =>
        namedRounds(text)
          .filter((path) => !existsSync(join(ROOT, path)))
          .map((path) => `${name}: ${path}`),
      ),
    );

    expect(dead).toEqual([]);
  });

  it('置き場の移った名指しを挙げる', () => {
    expect(namedRounds('`.claude/analysis/2026-09-11.md` … 14〜30行目')).toEqual([
      '.claude/analysis/2026-09-11.md',
    ]);
  });
});
