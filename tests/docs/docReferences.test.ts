import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { githubSlugs } from '../../scripts/githubSlugs.mjs';

/**
 * ドキュメントの参照が実在の対象へ解決するかの検査（docs/DocumentStyle.md 5節）。
 *
 * - Markdownリンク（ファイル・アンカー）が実在すること
 * - コード・YAML・ドキュメント中の「Foo.md N節」「Foo.md 〇〇節」が実在の節を指すこと
 * - 見出しの【未実装: 識別子】ラベルが、実装後に剥がし忘れられていないこと
 * - 確定度の印が、印として働く形で付いていること（DocumentStyle.md 6節）
 *
 * アンカーの照合には、公開サイトが実際にIDを振るのと同じ {@link githubSlugs} を使う。
 */

const ROOT = resolve(__dirname, '../..');

function listFiles(dir: string, exts: readonly string[]): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry);
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    if (statSync(join(ROOT, rel)).isDirectory()) {
      result.push(...listFiles(rel, exts));
    } else if (exts.some((ext) => entry.endsWith(ext))) {
      result.push(rel);
    }
  }
  return result;
}

const DOC_FILES = listFiles('docs', ['.md']);

/** 確定度の印（DocumentStyle.md 6節）。付くのは節の見出しだけ。 */
const CONFIRMED_LABEL = '【確定】';

/** 既定である暫定の側に印を付ける語。使わない。 */
const PROVISIONAL_LABELS = ['【未確定】', '【暫定】'];

/** 参照を検査する対象。ドキュメント自身と、節番号でドキュメントを指すコード・データ。 */
const REF_FILES = [
  ...DOC_FILES,
  'CLAUDE.md',
  ...listFiles('src', ['.ts', '.yaml']),
  ...listFiles('tests', ['.ts']),
  ...listFiles('tools', ['.md', '.json']),
].filter((rel) => !rel.startsWith(join('tests', 'docs'))); // 本テスト自身の例・正規表現は対象外

/**
 * インラインコード・コードフェンスを除いた各行と、原文での行番号
 * （例示のリンク・参照・印を検査対象から外す）。
 */
function textLines(markdown: string): { line: number; text: string }[] {
  const kept: { line: number; text: string }[] = [];
  let inFence = false;
  markdown.split('\n').forEach((raw, index) => {
    if (/^\s*```/.test(raw)) inFence = !inFence;
    else if (!inFence) kept.push({ line: index + 1, text: raw.replace(/`[^`]*`/g, '') });
  });
  return kept;
}

/** インラインコード・コードフェンスを除いた本文。 */
function withoutCode(markdown: string): string {
  return textLines(markdown)
    .map(({ text }) => text)
    .join('\n');
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf-8');
}

/** 見出し行（コードフェンス内は除外）。 */
function headingsOf(markdown: string): string[] {
  const headings: string[] = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    else if (!inFence && /^#{1,6}\s/.test(line)) headings.push(line.replace(/^#{1,6}\s+/, '').trim());
  }
  return headings;
}

function slugsOf(headings: readonly string[]): Set<string> {
  return new Set(githubSlugs(headings));
}

const docByPath = new Map(DOC_FILES.map((rel) => [rel, read(rel)]));
const headingsByPath = new Map([...docByPath].map(([rel, text]) => [rel, headingsOf(text)]));

/** ファイル名（basename）→ docs内の候補パス。 */
const docsByBasename = new Map<string, string[]>();
for (const rel of DOC_FILES) {
  const base = rel.split(sep).pop() as string;
  docsByBasename.set(base, [...(docsByBasename.get(base) ?? []), rel]);
}

/** その文書が番号 `num` の節を持つか。 */
function hasNumberedSection(docRel: string, num: string): boolean {
  return (headingsByPath.get(docRel) ?? []).some((h) => {
    const match = /^(\d+(?:\.\d+)*)[.\s]/.exec(h);
    return match !== null && match[1] === num;
  });
}

/** その文書が、名前 `name`（空白除去済み）を含む見出しを持つか。 */
function hasNamedSection(docRel: string, name: string): boolean {
  return (headingsByPath.get(docRel) ?? []).some((h) => h.replace(/[\s「」]/g, '').includes(name));
}

describe('ドキュメントの参照', () => {
  it('Markdownリンクの先のファイルが存在する', () => {
    const broken: string[] = [];
    for (const [rel, text] of docByPath) {
      for (const match of withoutCode(text).matchAll(/\]\(([^)#\s]+)(#[^)\s]*)?\)/g)) {
        const target = match[1];
        if (/^[a-z]+:/.test(target)) continue; // http(s):等
        const resolved = resolve(ROOT, dirname(rel), target);
        if (!existsSync(resolved)) broken.push(`${rel}: ${target}`);
      }
    }
    expect(broken, `リンク切れ:\n${broken.join('\n')}`).toEqual([]);
  });

  it('Markdownリンクのアンカーが、リンク先の見出しに解決する', () => {
    const broken: string[] = [];
    for (const [rel, text] of docByPath) {
      for (const match of withoutCode(text).matchAll(/\]\(([^)#\s]*)#([^)\s]+)\)/g)) {
        const [, file, anchor] = match;
        if (/^[a-z]+:/.test(file)) continue;
        let targetRel = rel;
        if (file !== '') {
          if (!file.endsWith('.md')) continue; // HTML等のアンカーは対象外
          targetRel = resolve(ROOT, dirname(rel), file).slice(ROOT.length + 1);
        }
        const headings = headingsByPath.get(targetRel);
        if (headings === undefined || !slugsOf(headings).has(decodeURIComponent(anchor))) {
          broken.push(`${rel}: ${file}#${anchor}`);
        }
      }
    }
    expect(broken, `アンカー切れ:\n${broken.join('\n')}`).toEqual([]);
  });

  it('節番号の参照が実在の節に解決する（明示・同・裸の全形式）', () => {
    // 参照の指し先の規約（docs/DocumentStyle.md 5節）:
    // - 「Foo.md N節」= その文書の節
    // - 「同 N節」= 同じファイル内で直前に名前を挙げた文書の節
    // - 裸の「N節」= 読み手の解釈と同じ優先順で、自文書 → 直前に名前を挙げた文書 →
    //   GameElementDefinition.md（WorldCodex文法の節）のどれか
    // - 「・」「、」で続く番号の列挙は、直前の参照と同じ文書
    const broken: string[] = [];
    const tokenPattern =
      /([A-Za-z][\w.]*\.md)`?(?:\]\([^)]*\))?|(同\s*)?(\d+(?:\.\d+)*)(?:\s*[〜～]\s*(\d+(?:\.\d+)*))?\s*節/g;
    const resolves = (base: string, nums: readonly string[]): boolean => {
      const candidates = docsByBasename.get(base);
      return (
        candidates !== undefined &&
        nums.every((n) => candidates.some((doc) => hasNumberedSection(doc, n)))
      );
    };
    for (const rel of REF_FILES) {
      const text = read(rel).replace(/\n[\s*/#-]*/g, ' '); // コメントの継続行をまたぐ参照を繋ぐ
      const selfBase = docByPath.has(rel) ? (rel.split(sep).pop() as string) : null;
      let lastNamedBase: string | null = null;
      let lastNamedEnd = -1;
      let prevRef: { base: string | null; end: number } | null = null;
      for (const match of text.matchAll(tokenPattern)) {
        const whole = match[0];
        // 捕獲グループは**マッチしなければundefined**になるが、TSの型は string[] と言っている。
        const [namedBase, dou, num, rangeEnd] = match.slice(1) as (string | undefined)[];
        if (namedBase !== undefined) {
          lastNamedBase = namedBase;
          lastNamedEnd = match.index + whole.length;
          continue;
        }
        if (num === undefined) continue;
        const nums = rangeEnd === undefined ? [num] : [num, rangeEnd];
        const gap = text.slice(lastNamedEnd, match.index);
        const sincePrev = prevRef === null ? null : text.slice(prevRef.end, match.index);
        // 指し先の候補（先頭から順に試し、最初に解決した文書を採る）
        let candidates: (string | null)[];
        if (lastNamedBase !== null && /^[\s`の)）]*$/.test(gap)) {
          candidates = [lastNamedBase]; // 明示: Foo.md N節（リンク形式の閉じ括弧は挟んでよい）
        } else if (dou !== undefined) {
          candidates = [lastNamedBase]; // 同 N節
        } else if (sincePrev !== null && /^[・、]\s*$/.test(sincePrev)) {
          candidates = [prevRef!.base]; // 列挙の続き: N節・M節
        } else {
          candidates = [selfBase, lastNamedBase, 'GameElementDefinition.md'];
        }
        const bases = [...new Set(candidates.filter((c): c is string => c !== null))];
        const resolved = bases.find((base) => resolves(base, nums)) ?? null;
        prevRef = { base: resolved, end: match.index + whole.length };
        if (resolved === null) {
          broken.push(`${rel}: 「${whole.trim()}」が解決しない（候補: ${bases.join('・')}）`);
        }
      }
    }
    expect(broken, `節番号の参照切れ:\n${broken.join('\n')}`).toEqual([]);
  });

  it('「Foo.md 〇〇節」（名前指し）が実在の見出しに解決する', () => {
    const broken: string[] = [];
    for (const rel of REF_FILES) {
      const text = read(rel).replace(/\n[\s*/#-]*/g, ' ');
      for (const match of text.matchAll(
        /([A-Za-z][\w.]*\.md)`?(?:\]\([^)]*\))?[ ]*(?:の)?[ ]*「?([^\s\d「」、。：:（）()*`・—〜～-][^「」、。：:（）()*`・—〜～]{0,30}?)」?[ ]*節/g,
      )) {
        const [, base, rawName] = match;
        if (/^の?\d/.test(rawName.trim())) continue; // 番号・範囲指しは前のテストが見る
        const name = rawName.replace(/[\s「」]/g, '');
        const candidates = docsByBasename.get(base);
        if (candidates === undefined) {
          broken.push(`${rel}: ${base}（docsに無い）`);
        } else if (!candidates.some((doc) => hasNamedSection(doc, name))) {
          broken.push(`${rel}: ${base} ${rawName}節`);
        }
      }
    }
    expect(broken, `節名の参照切れ:\n${broken.join('\n')}`).toEqual([]);
  });

  it('【未実装: 識別子】ラベルの識別子が、実装に現れていない（剥がし忘れ検知）', () => {
    const labels: { doc: string; ident: string }[] = [];
    for (const [rel, text] of docByPath) {
      for (const match of text.matchAll(/【未実装:\s*([\w.]+)\s*】/g)) {
        labels.push({ doc: rel, ident: match[1] });
      }
    }
    // コメントを除いた実装・データだけを見る（コメントはドキュメントへの言及でありうるため）。
    const sources = [
      ...listFiles('src', ['.ts']).map((rel) =>
        read(rel)
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, ''),
      ),
      ...listFiles('src', ['.yaml']).map((rel) => read(rel).replace(/#.*$/gm, '')),
    ].join('\n');
    const stale = labels.filter(({ ident }) => new RegExp(`\\b${ident}\\b`).test(sources));
    expect(
      stale,
      `実装済みの疑いがある【未実装】ラベル（ドキュメント側の剥がし忘れ？）:\n` +
        stale.map(({ doc, ident }) => `${doc}: ${ident}`).join('\n'),
    ).toEqual([]);
  });

  it('【確定】が見出しにだけ付いている（DocumentStyle.md 6節）', () => {
    const misplaced: string[] = [];
    for (const [rel, text] of docByPath) {
      for (const { line, text: body } of textLines(text)) {
        if (body.includes(CONFIRMED_LABEL) && !/^#{1,6}\s/.test(body)) {
          misplaced.push(`${rel}:${line}`);
        }
      }
    }
    expect(
      misplaced,
      `見出し以外の${CONFIRMED_LABEL}（本文に書いても印として働かない）:\n${misplaced.join('\n')}`,
    ).toEqual([]);
  });

  it('暫定の側に印を付けていない（DocumentStyle.md 6節）', () => {
    const found: string[] = [];
    for (const [rel, text] of docByPath) {
      for (const { line, text: body } of textLines(text)) {
        for (const label of PROVISIONAL_LABELS) {
          if (body.includes(label)) found.push(`${rel}:${line}: ${label}`);
        }
      }
    }
    expect(
      found,
      `暫定は既定なので印を付けない（印が多数側に付くと背景になって読めない）:\n${found.join('\n')}`,
    ).toEqual([]);
  });
});
