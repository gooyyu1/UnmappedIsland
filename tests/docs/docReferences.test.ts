import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { promptBody } from '../../scripts/agent/prompt-body.mjs';
import { declaresWholeDocument, WHOLE_DOCUMENT_CONFIRMED } from '../../scripts/docStatus.mjs';
import { githubSlugs } from '../../scripts/githubSlugs.mjs';
import { linesOutsideFence } from '../../scripts/markdownFences.mjs';

/**
 * ドキュメントの参照が実在の対象へ解決するかの検査（docs/DocumentStyle.md 5節）。
 *
 * **見るのは `docs/` だけではない。** `.claude/**` は互いを節名で引き合っており、そちらの節を畳んだ
 * ときに嘘になる。指し先も `docs/` の外（`CLAUDE.md`・`.claude/**`）まで広げてある。
 *
 * - Markdownリンク（ファイル・アンカー）が実在すること
 * - コード・YAML・ドキュメント中の「Foo.md N節」「Foo.md 〇〇節」が実在の節を指すこと
 * - 見出しの【未実装: 識別子】ラベルが、実装後に剥がし忘れられていないこと
 * - 【いつか: 識別子】の印と docs/Someday.md の項目が1対1で対応すること（DocumentStyle.md 4.1節）
 * - 確定度の印が、印として働く形で付いていること（DocumentStyle.md 6節）
 * - 確定節が射程・中身・出どころの条件を満たすこと（同 6.1節）
 *
 * アンカーの照合には、公開サイトが実際にIDを振るのと同じ {@link githubSlugs} を使う。
 */

const ROOT = resolve(__dirname, '../..');

/**
 * 降りない場所。`worktrees` には各セッションのリポジトリが丸ごと入っていて、追跡もされていない。
 */
const SKIP_DIRS = new Set(['node_modules', 'worktrees']);

function listFiles(dir: string, exts: readonly string[]): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry);
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
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

/** 確定節が本文に置く、印の根拠の行（DocumentStyle.md 6.1節）。 */
const SOURCE_LINE_PREFIX = '**出どころ**:';

/** 確定待ちの issue。項目番号は詰め替わるので、出どころが指せるのはこの issue そのものだけ。 */
const PENDING_ISSUE = '#656';

/**
 * 項目を**番号で**指す形（DocumentStyle.md 6.1節）。`の 21`・`の 9・10` のほか、2件目を受ける
 * `同 13` と、語を挟む `の項目18` も同じ形。
 *
 * 数字の手前に空白か「項目」を要求して、決定の文言の中の数（`難易度の3段目`）を外す。数字が節番号
 * （`同 6.4節`・`の 5 節`）なら指しているのは文書なので、これも外す。
 */
const ITEM_NUMBER = /(?:の|同)(?:\s+|\s*項目\s*)(?=[0-9])(?![0-9.]*\s*節)/;

/**
 * 本文が暫定であることを自白する語（DocumentStyle.md 6.1節）。確定節の射程には現れない——
 * 印は見出しに付くので、但し書きを本文へ添えても印を弱められない。
 *
 * 日本語には語の境界が無いので、他の語の一部として現れるものは個別に除く（`未定義` は語彙の説明）。
 */
const PROVISIONAL_WORD = /目安|仮置き|仮決め|まだ決め|未定(?!義)|かもしれ|暫定/g;

/** 「いつか実装したいもの」の実体の一覧（DocumentStyle.md 4.1節）。 */
const SOMEDAY_DOC = join('docs', 'Someday.md');

/** 参照を検査する対象。ドキュメント自身と、節番号でドキュメントを指すコード・データ。 */
const REF_FILES = [
  ...DOC_FILES,
  'CLAUDE.md',
  ...listFiles('.claude', ['.md', '.sh']),
  ...listFiles('scripts', ['.sh', '.mjs']),
  ...listFiles('src', ['.ts', '.yaml']),
  ...listFiles('tests', ['.ts']),
  ...listFiles('tools', ['.md', '.json']),
].filter(
  (rel) =>
    !rel.startsWith(join('tests', 'docs')) && // 本テスト自身の例・正規表現は対象外
    // 判断の履歴は、当時の発言と当時の文脈を原文のまま残す場所。後から直すものではない。
    !rel.startsWith(join('.claude', 'decisions')),
);

/**
 * コードフェンスの外の各行と、原文での行番号。`text` はインラインコードも除いた本文
 * （例示の印を検査対象から外す）、`raw` は原文のまま。
 *
 * **フェンスを落としてよいのは、文書が何を宣言しているかを見るとき。** 見出し・印と、その印の
 * 射程に入る本文がこれで、フェンスの中に在る `#` や `【確定】` は規約が見せている書式そのもの
 * ——拾うと、書式を説明した文書が印を持つ文書になる（`docStatus.mjs` の `declaresWholeDocument`
 * と同じ理由）。**参照は逆で、フェンスの中の `Foo.md N節` もリンクも実在の対象を指している**ので、
 * 原文を読む。書式の例示は囲みではなく、指し先として読めない書き方で外す（{@link isPlaceholder}）。
 *
 * **例外はひな形（`.claude/*-prompt.md`）で、そこの囲みは例示ではなく渡す本体**——中の見出しは
 * その文書の節なので、別に拾う（{@link namedSectionsOf}）。
 *
 * **どの行がフェンスの外かを決めるのは [`markdownFences.mjs`](../../scripts/markdownFences.mjs)**
 * ——確定度の表を出す側と同じ1つ。ここが足すのは、インラインコードを除いた `text` だけ。
 */
function textLines(markdown: string): { line: number; text: string; raw: string }[] {
  return linesOutsideFence(markdown).map(({ line, raw }) => ({
    line,
    text: raw.replace(/`[^`]*`/g, ''),
    raw,
  }));
}

/** インラインコード・コードフェンスを除いた本文。印を探すのはここ（{@link textLines}）。 */
function withoutCode(markdown: string): string {
  return textLines(markdown)
    .map(({ text }) => text)
    .join('\n');
}

/**
 * リンクの指し先が、実在のパスではなく**書式そのもの**を見せている箇所か
 * （docs/DocumentStyle.md 5節。`docStatsCitations` が出どころの書式を `<ファイル>` と書くのと同じ規約）。
 *
 * **判定が要るのはリンクだけ。** 節番号・節名の参照は `文書名.md N節` のように書けば
 * {@link brokenNumberedRefsIn} の `tokenPattern` が最初から拾わない（ファイル名の先頭に
 * `[A-Za-z]` を要求している）が、リンクの指し先は何が入っていても形が崩れないので、ここで外す。
 *
 * **囲み（インラインコード・コードフェンス）は、どちらの側でも逃げ道にならない。**
 */
function isPlaceholder(text: string): boolean {
  return text.includes('<') || text.includes('>');
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf-8');
}

/**
 * 見出しと、次の見出しまでの本文。`【確定】` の射程はこの本文だけ（DocumentStyle.md 6.1節）。
 *
 * 見出しは**原文のまま**持つ——失敗メッセージに出す名前であり、アンカーの照合にも使うので、
 * インラインコードのバッククォートを落とすと元の見出しを指せなくなる。
 */
interface Section {
  /** 見出しの行番号（1始まり）。 */
  line: number;
  /** 見出しの `#` の数。 */
  depth: number;
  heading: string;
  /** 次の見出しまでの本文。インラインコード・コードフェンスは除いてある（例示を拾わないため）。 */
  body: { line: number; text: string }[];
  /** より深い見出しが直後に続くか（＝下位節を抱えているか）。 */
  hasSubsections: boolean;
}

function sectionsOf(markdown: string): Section[] {
  const sections: Section[] = [];
  for (const { line, text, raw } of textLines(markdown)) {
    const match = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (match !== null) {
      sections.push({
        line,
        depth: match[1].length,
        heading: match[2].trim(),
        body: [],
        hasSubsections: false,
      });
    } else {
      sections[sections.length - 1]?.body.push({ line, text });
    }
  }
  return sections.map((section, index) => ({
    ...section,
    hasSubsections: (sections[index + 1]?.depth ?? 0) > section.depth,
  }));
}

/** 見出し行（コードフェンス内は除外）。 */
function headingsOf(markdown: string): string[] {
  return sectionsOf(markdown).map((section) => section.heading);
}

function slugsOf(headings: readonly string[]): Set<string> {
  return new Set(githubSlugs(headings));
}

const docByPath = new Map(DOC_FILES.map((rel) => [rel, read(rel)]));

/**
 * 参照の指し先になりうる文書。**`docs/` の外にも在る**（`CLAUDE.md`・`.claude/**`）ので、
 * `DocumentStyle.md` の規約を課す対象（`docByPath`）とは別に持つ。
 */
const REF_TARGETS = [...DOC_FILES, 'CLAUDE.md', ...listFiles('.claude', ['.md'])];

/** ひな形。セッションへ渡す本体を囲みに入れて持つ（`scripts/agent/prompt-body.mjs`）。 */
function isPromptTemplate(rel: string): boolean {
  return rel.startsWith(`.claude${sep}`) && rel.endsWith('-prompt.md');
}

/**
 * その文書が持つ、**名前・番号で引ける節**の見出し。
 *
 * ひな形は囲みの中が本体なので、そこの見出しも節として引ける。取り出しは渡す側と同じ1つを呼ぶ
 * （`scripts/agent/prompt-body.mjs`）——別に持つと、**渡る本文と、節を引ける範囲がずれる。**
 * 本体の中のさらなる囲みは今までどおり例示で、{@link headingsOf} が落とす。
 */
function namedSectionsOf(rel: string, markdown: string): string[] {
  const headings = headingsOf(markdown);
  if (!isPromptTemplate(rel)) return headings;
  return [...headings, ...headingsOf(promptBody(markdown) ?? '')];
}

/**
 * 公開の頁がIDを振る見出し。アンカーの照合はこちらだけを見る——**囲みの中の見出しは頁では
 * コードのまま**なので、節として引けてもアンカーは無い。混ぜると、開けないリンクが緑で通る。
 */
const anchorHeadingsByPath = new Map(REF_TARGETS.map((rel) => [rel, headingsOf(read(rel))]));

const namedSectionsByPath = new Map(
  REF_TARGETS.map((rel) => [rel, namedSectionsOf(rel, read(rel))]),
);

/** `【確定】` の付いた節（DocumentStyle.md 6.1節の4条件を課される対象）。 */
const confirmedSections = [...docByPath].flatMap(([doc, text]) =>
  sectionsOf(text)
    .filter((section) => section.heading.includes(CONFIRMED_LABEL))
    .map((section) => ({ doc, ...section })),
);

/**
 * 全体が確定であることを宣言した文書（DocumentStyle.md 6.2節の条件を課される対象）。
 *
 * 宣言の判定は `stats:docs` が確定欄を `全` と出すのに使うものと**同じ1つ**を呼ぶ。別々に持つと、
 * 表では全体が確定と出るのに 6.2 節の条件は掛かっていない、が成立する。
 */
const wholeDocumentConfirmed = [...docByPath].filter(([, text]) => declaresWholeDocument(text));

/** ファイル名（basename）→ 指し先の候補パス。 */
const docsByBasename = new Map<string, string[]>();
for (const rel of REF_TARGETS) {
  const base = rel.split(sep).pop() as string;
  docsByBasename.set(base, [...(docsByBasename.get(base) ?? []), rel]);
}

/** その文書が番号 `num` の節を持つか。 */
function hasNumberedSection(docRel: string, num: string): boolean {
  return (namedSectionsByPath.get(docRel) ?? []).some((h) => {
    const match = /^(\d+(?:\.\d+)*)[.\s]/.exec(h);
    return match !== null && match[1] === num;
  });
}

/** `source` の中で、指し先のファイルが無いMarkdownリンク。`rel` はリンクを解決する起点。 */
function brokenLinkFilesIn(rel: string, source: string): string[] {
  const broken: string[] = [];
  for (const match of source.matchAll(/\]\(([^)#\s]+)(#[^)\s]*)?\)/g)) {
    const target = match[1];
    if (/^[a-z]+:/.test(target)) continue; // http(s):等
    if (isPlaceholder(target)) continue;
    if (!existsSync(resolve(ROOT, dirname(rel), target))) broken.push(`${rel}: ${target}`);
  }
  return broken;
}

/** `source` の中で、リンク先の見出しに解決しないアンカー。`rel` はリンクを解決する起点。 */
function brokenLinkAnchorsIn(rel: string, source: string): string[] {
  const broken: string[] = [];
  for (const match of source.matchAll(/\]\(([^)#\s]*)#([^)\s]+)\)/g)) {
    const [, file, anchor] = match;
    if (/^[a-z]+:/.test(file)) continue;
    if (isPlaceholder(file) || isPlaceholder(anchor)) continue;
    let targetRel = rel;
    if (file !== '') {
      if (!file.endsWith('.md')) continue; // HTML等のアンカーは対象外
      targetRel = resolve(ROOT, dirname(rel), file).slice(ROOT.length + 1);
    }
    const headings = anchorHeadingsByPath.get(targetRel);
    if (headings === undefined || !slugsOf(headings).has(decodeURIComponent(anchor))) {
      broken.push(`${rel}: ${file}#${anchor}`);
    }
  }
  return broken;
}

/**
 * `source` の中で、実在の節へ解決しない節番号の参照。`rel` は自文書の判定と失敗メッセージに使う。
 *
 * 指し先の規約（docs/DocumentStyle.md 5節）:
 * - 「Foo.md N節」= その文書の節
 * - 「同 N節」= 同じファイル内で直前に名前を挙げた文書の節
 * - 裸の「N節」= 読み手の解釈と同じ優先順で、自文書 → 直前に名前を挙げた文書 →
 *   GameElementDefinition.md（WorldCodex文法の節）のどれか
 * - 「・」「、」で続く番号の列挙は、直前の参照と同じ文書
 *
 * **原文をそのまま読む。** 見るのは `.md` 以外も含む（{@link REF_FILES}）ので、Markdownの囲みで
 * 削れない——フェンスの中のYAMLコメントも実在の節を指している。
 */
function brokenNumberedRefsIn(rel: string, source: string): string[] {
  const broken: string[] = [];
  const tokenPattern =
    /([A-Za-z][\w.-]*\.md)`?(?:\]\([^)]*\))?|(同\s*)?(\d+(?:\.\d+)*)(?:\s*[〜～]\s*(\d+(?:\.\d+)*))?\s*節/g;
  const resolves = (base: string, nums: readonly string[]): boolean => {
    const candidates = docsByBasename.get(base);
    return (
      candidates !== undefined &&
      nums.every((n) => candidates.some((doc) => hasNumberedSection(doc, n)))
    );
  };
  const text = source.replace(/\n[\s*/#-]*/g, ' '); // コメントの継続行をまたぐ参照を繋ぐ
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
  return broken;
}

/**
 * 見出しと参照を突き合わせる形へ揃える。**引用の記号と強調は、引く側と引かれる側で揃わない**
 * ——見出しの `` `main` `` を、引く側は素の `main` と書く。
 */
function normalizeName(name: string): string {
  return name.replace(/[\s「」`*]/g, '');
}

/** その文書が、名前 `name`（`normalizeName` 済み）を含む見出しを持つか。 */
function hasNamedSection(docRel: string, name: string): boolean {
  return (namedSectionsByPath.get(docRel) ?? []).some((h) => normalizeName(h).includes(name));
}

/**
 * 識別子が実装に現れているか。
 *
 * 語の境界を要求するのは識別子の端が `\w` の側だけ。`\b` は `\w` の境目なので、日本語の識別子に
 * 付けると前後に何があっても成立しない（`\b海図\b` はどんな文脈にも当たらない）。
 */
function appearsInSources(ident: string, sources: string): boolean {
  const escaped = ident.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = /\w/.test(ident.slice(0, 1)) ? '\\b' : '';
  const tail = /\w/.test(ident.slice(-1)) ? '\\b' : '';
  return new RegExp(`${head}${escaped}${tail}`).test(sources);
}

/**
 * 見出しに【未実装】の印が現れる行。**捕獲側の正規表現は使わない**——同じ経路で数えると、
 * 両方が同じように落ちたときに気づけない（`docStatus.test.ts` と同じ考え方）。
 */
function unimplementedHeadingLines(): string[] {
  const found: string[] = [];
  for (const [rel, text] of docByPath) {
    text.split(/\r?\n/).forEach((line, index) => {
      if (/^#{1,6}\s/.test(line) && line.includes('【未実装')) {
        found.push(`${rel}:${index + 1} ${line.trim()}`);
      }
    });
  }
  return found;
}

describe('ドキュメントの参照', () => {
  it('Markdownリンクの先のファイルが存在する', () => {
    const broken = [...docByPath].flatMap(([rel, text]) => brokenLinkFilesIn(rel, text));
    expect(broken, `リンク切れ:\n${broken.join('\n')}`).toEqual([]);
  });

  it('Markdownリンクのアンカーが、リンク先の見出しに解決する', () => {
    const broken = [...docByPath].flatMap(([rel, text]) => brokenLinkAnchorsIn(rel, text));
    expect(broken, `アンカー切れ:\n${broken.join('\n')}`).toEqual([]);
  });

  it('節番号の参照が実在の節に解決する（明示・同・裸の全形式）', () => {
    const broken = REF_FILES.flatMap((rel) => brokenNumberedRefsIn(rel, read(rel)));
    expect(broken, `節番号の参照切れ:\n${broken.join('\n')}`).toEqual([]);
  });

  it('「Foo.md 〇〇節」（名前指し）が実在の見出しに解決する', () => {
    const broken: string[] = [];
    for (const rel of REF_FILES) {
      const text = read(rel).replace(/\n[\s*/#-]*/g, ' ');
      for (const match of text.matchAll(
        /([A-Za-z][\w.-]*\.md)`?(?:\]\([^)]*\))?[ ]*(?:の)?[ ]*「?([^\s\d「」、。：:（）()*`・—〜～-][^「」、。：:（）()*`・—〜～]{0,30}?)」?[ ]*節/g,
      )) {
        const [, base, rawName] = match;
        if (/^の?\d/.test(rawName.trim())) continue; // 番号・範囲指しは前のテストが見る
        const name = normalizeName(rawName);
        const candidates = docsByBasename.get(base);
        if (candidates === undefined) {
          broken.push(`${rel}: ${base}（そのファイルが無い）`);
        } else if (!candidates.some((doc) => hasNamedSection(doc, name))) {
          broken.push(`${rel}: ${base} ${rawName}節`);
        }
      }
    }
    expect(broken, `節名の参照切れ:\n${broken.join('\n')}`).toEqual([]);
  });

  /**
   * `Foo.md`「〇〇」の形（末尾に「節」を伴わない）。**指し先が `.claude/**` のときだけ見る。**
   *
   * この形は節の参照にも本文の引用にも使われていて、字面では見分けられない（`Characters.md`
   * 「`max` の80%で安全域を外れる」は仕様の1文の引用）。**`.claude/**` を指すものは節の参照しかない**
   * ので、そこだけ確かめられる——そして、畳んだ節を引いたまま残るのがここ。
   *
   * **裏返すと、`.claude/**` の文言をそのまま引くことをこの検査が禁じる。** 引きたくなったら、
   * 節名で指して要旨を自分の言葉で書く（本文の写しは、写した先が古くなるので元から避けたい形）。
   */
  it('`.claude/**` を指す鉤括弧が、実在の見出しに解決する', () => {
    const broken: string[] = [];
    for (const rel of REF_FILES) {
      const text = read(rel).replace(/\n[\s*/#-]*/g, ' ');
      for (const match of text.matchAll(
        // 「〇〇」節 と「〇〇N節」は上の2つが見る。**除外は先読みで書く**——マッチの側は必ず `」` で
        // 終わるので、マッチ後の文字列を見ないと「節」が続くかは分からない。
        /([A-Za-z][\w.-]*\.md)`?(?:\]\([^)]*\))?[ ]*(?:の)?[ ]*「(?!\d)([^「」]{1,40})」(?![ ]*節)/g,
      )) {
        const [, base, rawName] = match;
        const candidates = (docsByBasename.get(base) ?? []).filter((doc: string) =>
          doc.startsWith(`.claude${sep}`),
        );
        if (candidates.length === 0) continue;
        if (!candidates.some((doc) => hasNamedSection(doc, normalizeName(rawName)))) {
          broken.push(`${rel}: ${base}「${rawName}」`);
        }
      }
    }
    expect(broken, `節名の参照切れ:\n${broken.join('\n')}`).toEqual([]);
  });

  it('【未実装: 識別子】ラベルの識別子が、実装に現れていない（剥がし忘れ検知）', () => {
    const labels: { doc: string; ident: string }[] = [];
    for (const [rel, text] of docByPath) {
      for (const match of withoutCode(text).matchAll(/【未実装:\s*([^\s】]+)\s*】/g)) {
        labels.push({ doc: rel, ident: match[1] });
      }
    }
    // 捕獲側が黙って0件になると、**1つも拾えていない状態と、全部が正しい状態が同じ緑**になる。
    // 別の数え方と突き合わせておけば、ラベルが全部消える日が来ても両方0で通る。
    const inHeadings = unimplementedHeadingLines();
    expect(
      labels.map(({ ident }) => ident),
      `見出しに付いた【未実装】:\n${inHeadings.join('\n')}`,
    ).toHaveLength(inHeadings.length);
    // コメントを除いた実装・データだけを見る（コメントはドキュメントへの言及でありうるため）。
    const sources = [
      ...listFiles('src', ['.ts']).map((rel) =>
        read(rel)
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, ''),
      ),
      ...listFiles('src', ['.yaml']).map((rel) => read(rel).replace(/#.*$/gm, '')),
    ].join('\n');
    const stale = labels.filter(({ ident }) => appearsInSources(ident, sources));
    expect(
      stale,
      `実装済みの疑いがある【未実装】ラベル（ドキュメント側の剥がし忘れ？）:\n` +
        stale.map(({ doc, ident }) => `${doc}: ${ident}`).join('\n'),
    ).toEqual([]);
  });

  it('剥がし忘れの照合が、日本語の識別子にも効く', () => {
    // 上の検査は「照合が当たらない」と「まだ実装されていない」を区別できないので、既知の入力で
    // 別に確かめる。日本語の識別子に `\b` を付けると、当たるべき場面でも常に false になる。
    expect(appearsInSources('海図', 'const chart = 海図を描く;')).toBe(true);
    expect(appearsInSources('暖と明かり', 'warmth: 暖と明かり')).toBe(true);
    expect(appearsInSources('海図', 'const chart = 1;')).toBe(false);
    expect(appearsInSources('ambient_temperature', 'ambient_temperature: 0')).toBe(true);
    expect(appearsInSources('ambient_temperature', 'x_ambient_temperature_y: 0')).toBe(false);
  });

  it('【いつか: 識別子】と Someday.md の項目が1対1で対応する（DocumentStyle.md 4.1節）', () => {
    // 一覧の項目は Someday.md の第3レベルの見出しで、先頭の語が識別子。
    const items = new Set(
      [...read(SOMEDAY_DOC).matchAll(/^### (\S+)/gm)].map((match) => match[1]),
    );
    const labels: { doc: string; ident: string }[] = [];
    for (const [rel, text] of docByPath) {
      if (rel === SOMEDAY_DOC) continue; // 一覧自身は印を持たない
      for (const match of withoutCode(text).matchAll(/【いつか:\s*([^\s】]+)\s*】/g)) {
        labels.push({ doc: rel, ident: match[1] });
      }
    }
    const missing = labels.filter(({ ident }) => !items.has(ident));
    expect(
      missing,
      `${SOMEDAY_DOC} に項目の無い【いつか】:\n` +
        missing.map(({ doc, ident }) => `${doc}: ${ident}`).join('\n'),
    ).toEqual([]);
    const orphans = [...items].filter((ident) => !labels.some((l) => l.ident === ident));
    expect(
      orphans,
      `どの文書からも印で指されていない${SOMEDAY_DOC}の項目（読み手に届かない）:\n${orphans.join('\n')}`,
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

  it('参照の照合が、コードフェンスの中の行も見る', () => {
    // フェンスの中のYAMLコメントは実在の節・ファイルを指している。落とすと、指し先が動いても
    // 緑のままで、**読み手には本文の参照と見分けが付かない**（issue #1773）。
    const fenced = (body: string): string => `\`\`\`yaml\n# ${body}\n\`\`\`\n`;
    const probe = join('docs', 'DocumentStyle.md');
    // 「解決しない」と「1つも拾えていない」は同じ0件になるので、両向きを見る。
    expect(brokenNumberedRefsIn(probe, fenced('GameElementDefinition.md 999節'))).toHaveLength(1);
    expect(brokenNumberedRefsIn(probe, fenced('GameElementDefinition.md 1節'))).toHaveLength(0);
    expect(brokenLinkFilesIn(probe, fenced('[表示名](./NoSuchFile.md)'))).toHaveLength(1);
    expect(brokenLinkFilesIn(probe, fenced('[表示名](./DocumentStyle.md)'))).toHaveLength(0);
    expect(brokenLinkAnchorsIn(probe, fenced('[表示名](#no-such-anchor)'))).toHaveLength(1);
    const anchor = githubSlugs(anchorHeadingsByPath.get(probe) ?? [])[0];
    expect(brokenLinkAnchorsIn(probe, fenced(`[表示名](#${anchor})`))).toHaveLength(0);
  });

  it('書式の例示は指し先として読めない形で外し、囲みでは外れない（DocumentStyle.md 5節）', () => {
    const probe = join('docs', 'DocumentStyle.md');
    // 外れる形。リンクは `isPlaceholder` が、節の参照は `tokenPattern` が拾わないことで外れる。
    expect(brokenLinkFilesIn(probe, '[<表示名>](<パス>)')).toHaveLength(0);
    expect(brokenLinkAnchorsIn(probe, '[<表示名>](#<アンカー>)')).toHaveLength(0);
    expect(brokenNumberedRefsIn(probe, '文書名.md N節')).toHaveLength(0);
    // 囲みは逃げ道ではない——囲んだだけの参照も、指し先を明示したものとして検査する。
    expect(brokenLinkFilesIn(probe, '`[表示名](./NoSuchFile.md)`')).toHaveLength(1);
    expect(brokenNumberedRefsIn(probe, '`GameElementDefinition.md 999節`')).toHaveLength(1);
    // 節の参照に `<...>` は効かない（リンクと同じ形で書けると読まれないよう、ここで固定する）。
    expect(brokenNumberedRefsIn(probe, '<GameElementDefinition.md> 999節')).toHaveLength(1);
  });

  it('ひな形の囲みの中の見出しが、その文書の節として引ける', () => {
    // ひな形は渡す本体を囲みに入れて持つので、囲みを落として拾うと**題名のほかに節が1つも無い
    // 文書**になり、節名で指した記述が必ず赤くなる（issue #1845）。本体の中の囲みは今までどおり
    // 例示なので、そこの見出しは拾わない。
    const template = ['# 題名', '````', '## 本体の節', '```', '## 例の中の節', '```', '````'];
    const rel = join('.claude', 'probe-prompt.md');

    expect(namedSectionsOf(rel, template.join('\n'))).toEqual(['題名', '本体の節']);
    // ひな形でない文書では、囲みの中は今までどおり例示のまま。
    expect(namedSectionsOf(join('docs', 'DocumentStyle.md'), template.join('\n'))).toEqual(['題名']);
  });

  it('ひな形の囲みの中から、実際に節を拾えている', () => {
    // 拾えていない状態は、どの参照も節名で指していない状態と同じ緑になる。
    const gained = REF_TARGETS.filter(
      (rel) => (namedSectionsByPath.get(rel) ?? []).length > (anchorHeadingsByPath.get(rel) ?? []).length,
    );

    expect(gained.every(isPromptTemplate)).toBe(true);
    expect(gained.length).toBeGreaterThan(0);
  });

  it('囲みの中の見出しは、アンカーの照合には入らない', () => {
    // 頁ではコードのままなのでIDが振られない。節として引けることを理由に混ぜると、**開けない
    // リンクが緑で通る。**
    const probe = REF_TARGETS.find(
      (rel) =>
        isPromptTemplate(rel) &&
        (namedSectionsByPath.get(rel) ?? []).length > (anchorHeadingsByPath.get(rel) ?? []).length,
    ) as string;
    const inside = (namedSectionsByPath.get(probe) ?? []).slice(
      (anchorHeadingsByPath.get(probe) ?? []).length,
    );
    const [anchor] = githubSlugs(inside);

    // 拾えていないと、下は「アンカーが無い」ではなく「見出しが無い」で1件になる。
    expect(anchor).toBeTypeOf('string');
    expect(brokenLinkAnchorsIn(probe, `[表示名](${probe.split(sep).pop()}#${anchor})`)).toHaveLength(
      1,
    );
  });

  it('印を探す本文は、コードフェンスの中を落とす（規約が書式を例示する）', () => {
    // 参照と逆の扱い（上）。フェンスの中の `【確定】` は規約が見せている書式そのものなので、
    // 拾うと書式を説明した文書が印を持つ文書になる。
    const fenced = '```\n### 節番号 見出し【確定】【未実装: 識別子】\n```\n';
    expect(withoutCode(fenced)).not.toContain('【');
  });

  it('見出しの解析が、CRLFの作業ツリーでも効く', () => {
    // 行末に `\r` が残ると、見出しを見る検査（アンカー・節番号・印）が**揃って空振りし、
    // 違反ゼロと同じ緑になる**。Linuxで走るCIでは気づけないので、既知の入力で確かめる。
    expect(headingsOf('# 題名\r\n\r\n## 1. 節\r\n本文\r\n')).toEqual(['題名', '1. 節']);
    const [section] = sectionsOf('## 1. 節\r\n本文\r\n### 1.1 枝\r\n');
    expect(section.hasSubsections).toBe(true);
    expect(section.body.map(({ text }) => text)).toEqual(['本文']);
  });

  it('確定節を1つ以上拾えている（下の6.1節の検査の土台）', () => {
    // 拾えていないと、全部が規約どおりの状態と見分けが付かないまま緑になる。
    expect(confirmedSections.length).toBeGreaterThan(0);
  });

  it('暫定を表す語の照合が、他の語の一部を拾わない', () => {
    // 6.1節の検査は「当たらない」と「規約どおり」を区別できないので、既知の入力で別に確かめる。
    expect('未定です'.match(PROVISIONAL_WORD)).toEqual(['未定']);
    expect('未定義の語彙'.match(PROVISIONAL_WORD)).toBeNull();
  });
});

/** `【確定】` を付けてよい節の条件（DocumentStyle.md 6.1節）。 */
describe('【確定】を付けてよい節の条件（DocumentStyle.md 6.1節）', () => {
  it('確定節が下位節を抱えていない（射程はその節の本文だけ）', () => {
    const nested = confirmedSections
      .filter((section) => section.hasSubsections)
      .map((section) => `${section.doc}:${section.line} ${section.heading}`);
    expect(
      nested,
      `下位節を抱えた確定節（親に付けると、見出し1つで子の全行が確定になる）:\n${nested.join('\n')}`,
    ).toEqual([]);
  });

  it('確定節の本文に、暫定を表す語が無い（但し書きは印の内側にある）', () => {
    const found: string[] = [];
    for (const section of confirmedSections) {
      for (const { line, text } of section.body) {
        for (const match of text.matchAll(PROVISIONAL_WORD)) {
          found.push(`${section.doc}:${line}: 「${match[0]}」`);
        }
      }
    }
    expect(
      found,
      `確定節に残った仮決め（印の外——枝番の節・未決事項——へ出す）:\n${found.join('\n')}`,
    ).toEqual([]);
  });

  it('確定節が、本文に出どころの1行を持つ', () => {
    // 置き場は縛らない。本文の先頭は結論の1文の場所（DocumentStyle.md 3節）なので、そこを
    // 出どころで取ると、節の書き方の規約が2箇所に割れる。
    const missing = confirmedSections
      .filter((section) => !section.body.some(({ text }) => text.startsWith(SOURCE_LINE_PREFIX)))
      .map((section) => `${section.doc}:${section.line} ${section.heading}`);
    expect(
      missing,
      `出どころの無い確定節（人間の判断の在処が節から読めない）:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it(`出どころが、${PENDING_ISSUE} を項目番号で指していない`, () => {
    // 番号は答えの済んだものから詰め替わるので、書いた当時に正しくても後から別の決定を指す
    // （#1834 の時点で13箇所あり、うち1つは既にずれていた）。指すのは決めた中身で。
    const found: string[] = [];
    for (const [rel, text] of docByPath) {
      for (const { line, text: body } of textLines(text)) {
        if (body.startsWith(SOURCE_LINE_PREFIX) && body.includes(PENDING_ISSUE) && ITEM_NUMBER.test(body)) {
          found.push(`${rel}:${line}: ${body}`);
        }
      }
    }
    expect(
      found,
      `${PENDING_ISSUE} を番号で指した出どころ（何を決めたかで指す）:\n${found.join('\n')}`,
    ).toEqual([]);
  });

  it('項目番号の照合が、決定の文言の中の数と節番号を拾わない', () => {
    // 当たらなくなっても違反ゼロと同じ緑になるので、当たる側と外す側を既知の入力で確かめる。
    expect(ITEM_NUMBER.test('**出どころ**: #656 の 21')).toBe(true);
    expect(ITEM_NUMBER.test('**出どころ**: [#656](https://x/issues/656) の 9・10')).toBe(true);
    // 2件目を受ける `同 <番号>`。#1841 がこの綴りで、`の <番号>` だけを見ていた頃は素通りした。
    expect(ITEM_NUMBER.test('**出どころ**: #656（難易度の線）と、同 13（3段目の呼び名）')).toBe(true);
    expect(ITEM_NUMBER.test('**出どころ**: #656 の項目18')).toBe(true);
    expect(ITEM_NUMBER.test('**出どころ**: #656（難易度の3段目を「熟練者」に改める）')).toBe(false);
    expect(ITEM_NUMBER.test('**出どころ**: #656（同 6.4節の照合に使う）')).toBe(false);
    expect(ITEM_NUMBER.test('**出どころ**: #656（同 5 節の火口）')).toBe(false);
  });
});

/**
 * 文書まるごとの確定宣言が満たす条件（DocumentStyle.md 6.2節）。
 *
 * 6.1節の検査（上）と違って今から走らせる——宣言の形は規約と同時に入るので、規約より先に書かれた
 * 文書が無い。
 */
describe('文書まるごとの確定宣言（DocumentStyle.md 6.2節）', () => {
  it('宣言のある文書を1つ以上拾えている（下の検査の土台）', () => {
    // 拾えていないと、全部が規約どおりの状態と見分けが付かないまま緑になる。
    expect(wholeDocumentConfirmed.length).toBeGreaterThan(0);
  });

  it('宣言の照合が、書式を例示した行を拾わない', () => {
    // 規約（DocumentStyle.md 6.2節）は書式そのものを本文に書くので、例示を宣言と読むと、規約を
    // 書いた文書が全体確定になる。**文書の一覧では確かめられない**——今は例示が行頭に無いので、
    // 拾い方を間違えていても一覧は同じ結果になる。既知の入力で照合の形を見る。
    expect(declaresWholeDocument(`${WHOLE_DOCUMENT_CONFIRMED} 記述を覆すには人間の判断が要ります。`)).toBe(
      true,
    );
    expect(declaresWholeDocument(`- **書式は \`${WHOLE_DOCUMENT_CONFIRMED}\` で始まる段落**です。`)).toBe(
      false,
    );
    expect(declaresWholeDocument(`\`\`\`\n${WHOLE_DOCUMENT_CONFIRMED} 例示です。\n\`\`\`\n`)).toBe(false);
  });

  it('宣言のある文書が、節ごとの【確定】を持たない（射程が重なる）', () => {
    const overlapping = confirmedSections
      .filter((section) => wholeDocumentConfirmed.some(([doc]) => doc === section.doc))
      .map((section) => `${section.doc}:${section.line} ${section.heading}`);
    expect(
      overlapping,
      `宣言のある文書に残った節の印（印の有る節と無い節の差が何も意味しなくなる）:\n` +
        overlapping.join('\n'),
    ).toEqual([]);
  });

  it('宣言のある文書の全行に、暫定を表す語が無い', () => {
    const found: string[] = [];
    for (const [doc, text] of wholeDocumentConfirmed) {
      for (const { line, text: body } of textLines(text)) {
        for (const match of body.matchAll(PROVISIONAL_WORD)) {
          found.push(`${doc}:${line}: 「${match[0]}」`);
        }
      }
    }
    expect(
      found,
      `宣言のある文書に残った仮決め（文書の射程に外側は無いので、持つべき仕様書へ移す）:\n` +
        found.join('\n'),
    ).toEqual([]);
  });

  it('宣言のある文書が、出どころの1行を持つ', () => {
    const missing = wholeDocumentConfirmed
      .filter(
        ([, text]) => !textLines(text).some(({ text: body }) => body.startsWith(SOURCE_LINE_PREFIX)),
      )
      .map(([doc]) => doc);
    expect(
      missing,
      `出どころの無い宣言（人間の判断の在処が文書から読めない）:\n${missing.join('\n')}`,
    ).toEqual([]);
  });
});
