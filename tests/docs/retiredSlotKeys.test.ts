import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { describe, expect, it } from 'vitest';
import { isVerbatimRecord, trackedDocs, trackedFiles } from '../../scripts/docScope.mjs';
import { RETIRED_SLOT_KEYS } from '../../src/loader/parseSlots';

/**
 * 廃止したスロットの宣言キー（{@link RETIRED_SLOT_KEYS}）を、説明が今も書けるものとして挙げて
 * いないかの検査（[`docs/DocumentStyle.md`](../../docs/DocumentStyle.md) 5節）。
 * **ロードを止める側は YAML しか見ない**ので、書く人が先に読む説明のほうは、綴りが死んでも何も
 * 落ちずに残る（issue #1924）。
 *
 * **綴りの一覧をここへ書き写さない**——ロードを止めている側から引く。写すと、廃止キーが増えた日に
 * 写しだけが古くなる。
 *
 * 綴りには2種あり、「現役のキーとして書いている」と言える証拠が違うので `it` を分けてある。
 *
 * 1. **今どこも指していない綴り**（{@link DEAD}）。コードのどこにも生きていないので、**どこに書いて
 *    あっても**廃止だと断っていなければ、読み手には書けるものとして渡る。
 * 2. **スロットの外では今も生きている綴り**（{@link LIVE_ELSEWHERE}）。綴りだけでは言及の正否を
 *    決められないので、**YAML の例で `slots:` の下に置かれている**ことを証拠にする。そこに書けば
 *    ロードが止まる形そのもので、読み手が写せばそのまま詰まる。
 */

const ROOT = resolve(__dirname, '../..');

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf-8');
}

const RETIRED = RETIRED_SLOT_KEYS.map(([key]) => key);

function appearsIn(text: string, key: string): boolean {
  return new RegExp(`\\b${key}\\b`).test(text);
}

const PARSE_SLOTS = join('src', 'loader', 'parseSlots.ts');
const SOURCES = trackedFiles(ROOT, 'src/*.ts');

/**
 * コメントを取り除いた本文（文字列リテラルは残す——名前を文字列で持つ宣言もあるため）。
 * **コメントを残すと、廃止済みの綴りを説明が1つ挙げただけでその綴りが「生きている」ことになり、
 * 検査の外へ出る**——見張る対象が、そのまま見張りを外す。
 */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * 廃止の一覧を置いているファイルを除いたソースのコード。**そこには全部の綴りが在る**ので、含めると
 * 綴りが1つも死んでいないことになり、下の 1 が何も見なくなる。
 *
 * 一覧の中だけで生きている綴りは死んだ側に入るが、そちらは 1 が赤くなって知れる。見逃す側へ倒さない。
 */
const CODE = SOURCES.filter((rel) => rel !== PARSE_SLOTS)
  .map((rel) => codeOnly(read(rel)))
  .join('\n');

/** 今どこも指していない綴り。スロットの外では今も生きている綴り（{@link LIVE_ELSEWHERE}）と分ける。 */
const DEAD = RETIRED.filter((key) => !appearsIn(CODE, key));
const LIVE_ELSEWHERE = RETIRED.filter((key) => appearsIn(CODE, key));

/**
 * 廃止だと断っている印。**その綴りがもう書けないことを指すのが語の意味であるものだけ**を挙げる
 * （`docHistory.test.ts` の印と同じ選び方）。単なる否定（「書きません」）は現役のキーへの制約にも
 * 使うので、印にしない。
 *
 * **`旧` は語の一部にも当たる**（`復旧`・`新旧`）ので、その語を含む段は断ったものとして通る。
 * 免除が広がる向きの紛れなので、見逃しはここでは増えず、断り漏れを1つ見落とすだけで済む。
 */
const RETIREMENT_MARKERS = ['廃止', '旧', 'かつて', '当時'];

/** 説明が書かれている行と、原文での行番号。 */
type ProseLine = { readonly line: number; readonly text: string };

/** どの行が説明か。行をまたぐ形（ブロックコメント）を見るので、1行ずつでは決められない。 */
type ProseMask = (lines: readonly string[]) => boolean[];

/** `.md` は全体が説明。 */
const ALL_LINES: ProseMask = (lines) => lines.map(() => true);

/**
 * `.ts` で説明が書かれているのはコメントの行だけ。**ブロックの中は `*` を置かない行も本文**
 * ——1行ずつ行頭だけで決めると、そこに書いた説明が丸ごと走査から外れる。
 */
const COMMENT_LINES: ProseMask = (lines) => {
  let inBlock = false;
  return lines.map((raw) => {
    const trimmed = raw.trim();
    if (trimmed.startsWith('/*')) inBlock = true;
    const comment = inBlock || trimmed.startsWith('//') || trimmed.startsWith('*');
    if (trimmed.includes('*/')) inBlock = false;
    return comment;
  });
};

/**
 * 説明が書かれている行だけを、行番号を付けて返す。**空行と、説明でない行は落とす**——落とした跡が
 * 行番号の飛びになり、{@link paragraphs} がそこで段を切る。
 */
function proseLines(text: string, prose: ProseMask): ProseLine[] {
  const lines = text.split('\n');
  const keep = prose(lines);
  return lines
    .map((raw, index) => ({ line: index + 1, text: raw }))
    .filter(({ text: raw }, index) => raw.trim() !== '' && keep[index]);
}

/** 行番号が続いている塊。読み手が1つのまとまりとして読む範囲で、断りが効く範囲でもある。 */
function paragraphs(lines: readonly ProseLine[]): ProseLine[][] {
  const found: ProseLine[][] = [];
  for (const entry of lines) {
    const last = found.at(-1);
    if (last !== undefined && last[last.length - 1].line + 1 === entry.line) last.push(entry);
    else found.push([entry]);
  }
  return found;
}

/** 断りの無いまま綴りを挙げている箇所（`行番号 綴り`）。 */
function mentionsWithoutNotice(lines: readonly ProseLine[], keys: readonly string[]): string[] {
  const found: string[] = [];
  for (const paragraph of paragraphs(lines)) {
    if (paragraph.some(({ text }) => RETIREMENT_MARKERS.some((mark) => text.includes(mark)))) continue;
    for (const { line, text } of paragraph)
      for (const key of keys) if (appearsIn(text, key)) found.push(`${line} ${key}`);
  }
  return found;
}

/** `yaml` のコードフェンスの中身と、フェンスが始まる行。 */
function yamlFences(text: string): { readonly line: number; readonly body: string }[] {
  const found: { line: number; body: string }[] = [];
  const lines = text.split('\n');
  let opened: { line: number; yaml: boolean } | null = null;
  lines.forEach((raw, index) => {
    const fence = /^\s*```(\w*)\s*$/.exec(raw);
    if (fence === null) return;
    if (opened === null) {
      opened = { line: index + 1, yaml: fence[1] === 'yaml' || fence[1] === 'yml' };
      return;
    }
    if (opened.yaml)
      found.push({ line: opened.line, body: lines.slice(opened.line, index).join('\n') });
    opened = null;
  });
  return found;
}

/** 例の途中を省いた行（`...`）。YAML としては読めないので、読む前に落とす。 */
const ELLIPSIS = /^\s*(?:\.\.\.|…)\s*$/;

/** 宣言のどこを見ているか。`slots` はスロット名の並び、`slotNode` がスロット1つの宣言。 */
type Where = 'outside' | 'slots' | 'slotNode';

/** スロットの宣言として書かれた廃止済みのキーと、見たスロットの数。 */
type SlotScan = { readonly retired: string[]; slotNodes: number };

function scanSlots(value: unknown, where: Where, into: SlotScan): void {
  if (Array.isArray(value)) {
    for (const item of value) scanSlots(item, where, into);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (where === 'slotNode') into.slotNodes += 1;
  for (const [key, child] of Object.entries(value)) {
    if (where === 'slotNode' && RETIRED.includes(key)) into.retired.push(key);
    scanSlots(child, where === 'slots' ? 'slotNode' : key === 'slots' ? 'slots' : 'outside', into);
  }
}

/** その YAML の例が、スロットの宣言として書いている廃止済みのキー。 */
function retiredSlotKeysIn(body: string): SlotScan {
  const into: SlotScan = { retired: [], slotNodes: 0 };
  const doc = parseDocument(
    body
      .split('\n')
      .filter((line) => !ELLIPSIS.test(line))
      .join('\n'),
  );
  // 読めなかった例は判定できない。**廃止済みの綴りを含むときだけ**、読めないことを挙げる——黙って
  // 飛ばすと、通ったのか見ていないのかが緑では区別できない。
  if (doc.errors.length > 0) {
    if (RETIRED.some((key) => appearsIn(body, key)))
      into.retired.push(`（YAML として読めない: ${doc.errors[0].message.split('\n')[0]}）`);
    return into;
  }
  scanSlots(doc.toJS(), 'outside', into);
  return into;
}

const DOCUMENTS = trackedDocs(ROOT).filter((rel) => !isVerbatimRecord(rel));

/**
 * 説明を持つファイル。**`docs/` に閉じない**——`agent-ops/**` もソースのコメントも同じ綴りを書ける
 * （`DocumentStyle.md` 10節）。**`tests/` のコメントも入れる**が、{@link CODE} には入れない
 * ——あちらには廃止済みの綴りが入力の例として並ぶので、生きている証拠にはならない。
 */
const PROSE_FILES = [
  ...DOCUMENTS.map((rel) => ({ rel, prose: ALL_LINES })),
  ...SOURCES.map((rel) => ({ rel, prose: COMMENT_LINES })),
  ...trackedFiles(ROOT, 'tests/*.ts').map((rel) => ({ rel, prose: COMMENT_LINES })),
];

describe('廃止したスロットの宣言キー', () => {
  it('綴りが、死んだものと生きているものに分かれている', () => {
    // 一覧を置いているファイルが動くと除外が当たらなくなり、どの綴りも生きていることになって、
    // 下の「断らずに書いていない」が何も見ないまま緑になる。
    expect(SOURCES).toContain(PARSE_SLOTS);
    expect(DEAD, '廃止した綴りが1つも死んでいない（除外が当たっていない疑い）').not.toEqual([]);
    expect(LIVE_ELSEWHERE, 'スロットの外で生きている綴りが1つも無い').not.toEqual([]);
  });

  it('今どこも指していない綴りを、廃止と断らずに書いていない', () => {
    const undeclared = PROSE_FILES.flatMap(({ rel, prose }) =>
      mentionsWithoutNotice(proseLines(read(rel), prose), DEAD).map((hit) => `${rel}:${hit}`),
    );

    expect(
      undeclared,
      '説明が、今は書けない綴りを断りなく挙げている（廃止したと断るか、今の書き方へ直す' +
        `——DocumentStyle.md 5節）:\n${undeclared.join('\n')}`,
    ).toEqual([]);
  });

  it('YAML の例が、スロットの下に廃止済みのキーを置いていない', () => {
    const written: string[] = [];
    let slotNodes = 0;
    for (const rel of DOCUMENTS) {
      for (const { line, body } of yamlFences(read(rel))) {
        const scan = retiredSlotKeysIn(body);
        slotNodes += scan.slotNodes;
        for (const key of scan.retired) written.push(`${rel}:${line} ${key}`);
      }
    }

    expect(slotNodes, 'YAML の例からスロットの宣言を1つも拾えていない').toBeGreaterThan(0);
    expect(
      written,
      `YAML の例が、スロットの宣言に廃止済みのキーを置いている:\n${written.join('\n')}`,
    ).toEqual([]);
  });

  it('断りの有無と、キーの置き場で、判定が分かれる', () => {
    // 綴りは廃止の一覧から引く。書き写すと、この検査だけが古い綴りを見張ることになる。
    const dead = DEAD[0];
    const live = LIVE_ELSEWHERE[0];
    const prose = (text: string): ProseLine[] => proseLines(text, ALL_LINES);

    expect(mentionsWithoutNotice(prose(`枠には \`${dead}\` を書きます。`), DEAD)).toEqual([
      `1 ${dead}`,
    ]);
    expect(
      mentionsWithoutNotice(prose(`廃止した \`${dead}\` は書けません。`), DEAD),
      '断りは、同じ段のどこかに在ればよい',
    ).toEqual([]);

    expect(retiredSlotKeysIn(`slots:\n  s: {${live}: false}\n`).retired).toEqual([live]);
    expect(
      retiredSlotKeysIn(`object_defs:\n  x:\n    ${live}: false\n    slots:\n      s: {}\n`).retired,
      'スロットの外は、廃止した綴りではない',
    ).toEqual([]);
  });
});
