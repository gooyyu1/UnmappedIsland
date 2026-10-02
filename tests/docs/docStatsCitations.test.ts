import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { replaceAllOrFail } from '../support/textEdit';
import { WORLD_CODEX_DIR, worldCodexYamlPaths } from '../support/worldCodexFiles';

/**
 * 文書が `stats/*.yaml`（生成物）と `src/assets/world-codex/**.yaml`（人が書く定義）から書き写した
 * 数値が、出どころとずれていないかの検査。
 *
 * 生成物の側には鮮度の試験がある（`tests/support/generatedReport.ts` の
 * `describeReportFreshness`）が、**そこから文書へ書き写した数値は誰も見ていない**——再生成すると
 * 文書だけが古い値を持ったまま緑になる（issue #860）。定義も同じで、人が定義を動かせば、そこから
 * 書き写した文書は静かに嘘になる（issue #2357）。
 *
 * 文書側は、書き写した数値の直後に出どころの印を置く。**印の形・粗さの書き方・何を印で書いてよいかは
 * [`docs/diagnostics/README.md`](../../docs/diagnostics/README.md)「文書へ書き写した数値には、
 * 出どころの印を置く」。**
 */

const ROOT = resolve(__dirname, '../..');

const STATS_DIR = 'stats';

/** 書き写した数値の出どころを名乗る印。`stats:` は生成物のセル、`codex:` は定義の中の1つの値を指す。 */
const MARK_PATTERN = /<!--\s*(stats|codex):\s*([^>]*?)\s*-->/g;

/**
 * 印の直前に書かれている数と、そこから印までの隙間。隙間に数字と表の区切り（`|`）を許さないので、
 * 印は数値と同じセルの、単位や強調をまたぐ程度の近さに置くことになる。
 *
 * 数に**接している**負号は数の一部（`-0.20`）。離れていれば符号ではない（箇条書きの `- `）。
 */
const WRITTEN_NUMBER_PATTERN = /([-−]?\d[\d,]*(?:\.\d+)?)[^\d|]{0,8}$/;

/** 印の末尾に置く粗さ。`±100` は出どころと同じ単位、`±5%` は書いた数に対する割合。 */
const COARSENESS_PATTERN = /^±(\d+(?:\.\d+)?)(%?)$/;

/**
 * 条件で絞った**複数のレコード**を1つの数へ畳む読み方。列の名前と紛れないよう、名前は日本語で持つ
 * （生成物の列名はどれもASCII）。
 */
const FOLDS: Record<string, (cells: readonly number[]) => number> = {
  最小: (cells) => Math.min(...cells),
  最大: (cells) => Math.max(...cells),
  幅: (cells) => Math.max(...cells) - Math.min(...cells),
};

/** 印が指す、レポートのセル。畳み方を書かなければ1つに絞る。 */
interface Source {
  readonly file: string;
  readonly section: string;
  readonly selectors: readonly (readonly [string, string])[];
  readonly column: string;
}

/** 印が許す粗さ。 */
interface Coarseness {
  /** 幅の大きさ。`relative` なら書いた数に対する百分率、そうでなければ出どころと同じ単位。 */
  readonly width: number;
  readonly relative: boolean;
}

/** 印の中身。 */
interface Mark {
  readonly source: Source;
  /** 畳み方（`FOLDS` の名前）。書かれていなければ null（1つのセルの書き写し）。 */
  readonly fold: string | null;
  /** 粗さ。書かれていなければ null（書いた桁へ丸めた厳密一致）。 */
  readonly coarseness: Coarseness | null;
}

/** `codex:` の印が指す、定義の中の1つの値。 */
interface CodexSource {
  /** `WORLD_CODEX_DIR` からの相対パス。 */
  readonly file: string;
  /** トップレベルからのキーの道。リストの中は0始まりの添字で指す。 */
  readonly path: readonly string[];
}

/** `codex:` の印の中身。定義の値は丸めずに書かれているので、畳み方は持たない。 */
interface CodexMark {
  readonly source: CodexSource;
  readonly coarseness: Coarseness | null;
}

/** 読めた印。どちらの出どころかによらず、粗さと指す値だけで突き合わせる。 */
interface ReadMark {
  readonly coarseness: Coarseness | null;
  /** 指す値。解決できなければ、なぜできないかの文。 */
  readonly cell: number | string;
}

/** 文書の1つの印。 */
interface Citation {
  readonly doc: string;
  readonly line: number;
  readonly body: string;
  /** 読めなければ null。 */
  readonly mark: ReadMark | null;
  /**
   * 印の直前に書かれている数。桁区切りのカンマを除き、負号を `-`（U+002D）へ揃えたもの。
   * 無ければ null。
   */
  readonly written: string | null;
}

function listMarkdown(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...listMarkdown(rel));
    else if (entry.endsWith('.md')) found.push(rel);
  }
  return found;
}

/**
 * 印を空白で切る。**二重引用符で囲んだ中の空白では切らない**——選ぶ値には空白を含むものがある
 * （`route="grassland.explore → water_spinach.eat"`）。閉じない引用符は、印ごと読めないものとして null。
 */
function tokenize(body: string): string[] | null {
  const tokens: string[] = [];
  let token: string | null = null;
  let quoted = false;
  for (const char of body) {
    if (char === '"') {
      quoted = !quoted;
      token ??= '';
    } else if (!quoted && /\s/.test(char)) {
      if (token !== null) tokens.push(token);
      token = null;
    } else token = (token ?? '') + char;
  }
  if (quoted) return null;
  if (token !== null) tokens.push(token);
  return tokens;
}

/** `<列>=<値>`。**値の側にも `=` が入りうる**ので、最初の1つでだけ切る。 */
function splitSelector(token: string): readonly [string, string] | null {
  const index = token.indexOf('=');
  if (index <= 0 || index === token.length - 1) return null;
  return [token.slice(0, index), token.slice(index + 1)];
}

/**
 * 末尾の粗さを取り除いて返す。書かれていなければ null、`±` で始まるのに読めなければ undefined
 * （印ごと読めないものとして扱う）。
 */
function popCoarseness(tokens: string[]): Coarseness | null | undefined {
  const last = tokens.at(-1);
  if (last === undefined || !last.startsWith('±')) return null;
  const matched = COARSENESS_PATTERN.exec(last);
  if (matched === null) return undefined;
  tokens.pop();
  return { width: Number(matched[1]), relative: matched[2] === '%' };
}

function parseMark(body: string): Mark | null {
  const tokens = tokenize(body);
  if (tokens === null) return null;

  const coarseness = popCoarseness(tokens);
  if (coarseness === undefined) return null;

  let fold: string | null = null;
  const beforeCoarseness = tokens.at(-1);
  if (beforeCoarseness !== undefined && Object.hasOwn(FOLDS, beforeCoarseness)) {
    fold = beforeCoarseness;
    tokens.pop();
  }

  if (tokens.length < 3) return null;

  const [file, section, ...rest] = tokens;
  const column = rest.pop() as string;
  const selectors = rest.map(splitSelector);
  if (selectors.some((selector) => selector === null)) return null;

  return {
    source: { file, section, selectors: selectors as (readonly [string, string])[], column },
    fold,
    coarseness,
  };
}

/** `<ファイル> <道> [±<粗さ>]`。道はドットで区切り、空の区切りを持たない。 */
function parseCodexMark(body: string): CodexMark | null {
  const tokens = tokenize(body);
  if (tokens === null) return null;

  const coarseness = popCoarseness(tokens);
  if (coarseness === undefined || tokens.length !== 2) return null;

  const [file, dotted] = tokens;
  const path = dotted.split('.');
  if (path.some((key) => key === '')) return null;
  return { source: { file, path }, coarseness };
}

/**
 * 書いた数と出どころのずれ。粗さの中に収まっていれば null、外れていれば「どこまでなら良かったか」を
 * 返す。粗さを書かない印は、書いた桁へ丸めた値との厳密一致で見る（`170.45` を「170分」と書ける、
 * その丸めのぶんだけの幅）。
 */
function disagreement(written: string, cell: number, coarseness: Coarseness | null): string | null {
  if (coarseness === null) {
    const decimals = written.split('.')[1]?.length ?? 0;
    const rounded = cell.toFixed(decimals);
    return rounded === written ? null : `同じ桁で ${rounded}`;
  }

  const value = Number(written);
  const width = coarseness.relative ? (Math.abs(value) * coarseness.width) / 100 : coarseness.width;
  if (Math.abs(cell - value) <= width) return null;
  return `許す幅は ${readable(value - width)}〜${readable(value + width)}`;
}

/**
 * 人へ見せる数。**足し引きで出た端は、そのまま書くと浮動小数の屑が付く**（`0.2 + 0.1` が
 * `0.30000000000000004`）ので、読める桁で落とす。比べるほうはこれを通さない。
 */
function readable(value: number): number {
  return Number(value.toPrecision(12));
}

/**
 * 文書の本文から印を拾う。**コードとして囲んだ中——フェンスの中もバッククォートの中も——本文と
 * 同じに拾う。** 囲みは数の読み方にも効かない（`約`4,200`分<!-- … -->` の `4,200` は印の直前の数）。
 *
 * 出どころを持たない**書式そのもの**は、`<ファイル>` のようなプレースホルダで書く——`>` を含む
 * ので `MARK_PATTERN` に掛からない。
 */
function citationsIn(doc: string, text: string): Citation[] {
  const found: Citation[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.replace(/`([^`]*)`/g, '$1');

    for (const match of line.matchAll(MARK_PATTERN)) {
      // 先に置かれた印の中身は数として読まない（印の本文に数字が入りうる）。
      const before = line.slice(0, match.index).replace(/<!--[\s\S]*?-->/g, '');
      const written = WRITTEN_NUMBER_PATTERN.exec(before);
      found.push({
        doc,
        line: index + 1,
        body: `${match[1]}: ${match[2]}`,
        mark: readMark(match[1], match[2]),
        written: written === null ? null : written[1].replace(/,/g, '').replace(/^−/, '-'),
      });
    }
  });
  return found;
}

/** レポートの中身。読むのは `stats/` 直下のYAMLだけで、1ファイルにつき1回だけ解く。 */
const REPORTS = new Map(
  readdirSync(join(ROOT, STATS_DIR))
    .filter((entry) => entry.endsWith('.yaml'))
    .map((entry) => {
      const parsed: unknown = parse(readFileSync(join(ROOT, STATS_DIR, entry), 'utf-8'));
      const sections = typeof parsed === 'object' && parsed !== null ? parsed : {};
      return [entry, sections as Record<string, unknown>];
    }),
);

/** 印が指す値。解決できなければ、なぜ解決できないかを文で返す。 */
function cellOf({ source, fold }: Mark): number | string {
  const report = REPORTS.get(source.file);
  if (report === undefined) return `${STATS_DIR}/ に無いファイル`;

  const section = report[source.section];
  if (!Array.isArray(section)) return 'その節が無い';

  const records = section.filter(
    (record): record is Record<string, unknown> =>
      typeof record === 'object' && record !== null && !Array.isArray(record),
  );
  const matched = records.filter((record) =>
    source.selectors.every(([key, value]) => String(record[key]) === value),
  );
  if (fold === null ? matched.length !== 1 : matched.length < 2) {
    // 畳み方を書いた印が1件しか当てないなら、それは書き写しなので畳み方のほうが要らない。
    const wanted = fold === null ? '1件に絞る' : '畳むには2件以上要る';
    return `条件に当てはまるレコードが${matched.length}件（${wanted}）`;
  }

  const cells = matched.map((record) => record[source.column]).filter((cell) => typeof cell === 'number');
  if (cells.length !== matched.length) return 'そのレコードに、その名前の数の列が無い';
  return fold === null ? cells[0] : FOLDS[fold](cells);
}

/** 定義ファイルの中身。`WORLD_CODEX_DIR` からの相対パスで引き、1ファイルにつき1回だけ解く。 */
const CODEX_FILES = new Map<string, unknown>(
  worldCodexYamlPaths().map((path) => [
    relative(WORLD_CODEX_DIR, path).split(sep).join('/'),
    parse(readFileSync(join(ROOT, path), 'utf-8')),
  ]),
);

/** 道の先にある定義の中身。辿れなければ、なぜ辿れないかの文を `broken` に入れて返す。 */
function codexNodeAt({ file, path }: CodexSource): { readonly node: unknown } | { readonly broken: string } {
  if (!CODEX_FILES.has(file)) return { broken: `${WORLD_CODEX_DIR}/ に無いファイル` };

  let node = CODEX_FILES.get(file);
  for (const [depth, key] of path.entries()) {
    const next = Array.isArray(node)
      ? /^\d+$/.test(key)
        ? node[Number(key)]
        : undefined
      : typeof node === 'object' && node !== null && Object.hasOwn(node, key)
        ? (node as Record<string, unknown>)[key]
        : undefined;
    if (next === undefined) return { broken: `その道が ${path.slice(0, depth + 1).join('.')} で途切れる` };
    node = next;
  }
  return { node };
}

/** `codex:` の印が指す値。解決できなければ、なぜ解決できないかを文で返す。 */
function codexValueOf(source: CodexSource): number | string {
  const found = codexNodeAt(source);
  if ('broken' in found) return found.broken;
  return typeof found.node === 'number' ? found.node : 'その道の先が数ではない';
}

/** 印の種類ごとに読み、指す値まで解決する。形が読めなければ null。 */
function readMark(kind: string, body: string): ReadMark | null {
  if (kind === 'codex') {
    const mark = parseCodexMark(body);
    return mark === null ? null : { coarseness: mark.coarseness, cell: codexValueOf(mark.source) };
  }
  const mark = parseMark(body);
  return mark === null ? null : { coarseness: mark.coarseness, cell: cellOf(mark) };
}

/** 文書の中の YAML のフェンス1つ。 */
interface YamlBlock {
  readonly doc: string;
  /** 開きのフェンスの行（1始まり）。 */
  readonly line: number;
  /** 情報文字列の、言語名より後ろ。抜粋の出どころを名乗るならここに `codex:` が来る。 */
  readonly info: string;
  /** フェンスの字下げを除いた中身。 */
  readonly text: string;
}

function yamlBlocksIn(doc: string, text: string): YamlBlock[] {
  const found: YamlBlock[] = [];
  let open: { readonly line: number; readonly indent: string; readonly lang: string; readonly info: string } | null =
    null;
  let body: string[] = [];
  // `.` は `\r` に当たらないので、CRLF のまま切るとフェンスの行が `(.*)$` で読めなくなる。
  text.split(/\r?\n/).forEach((line, index) => {
    const fence = /^(\s*)```(\S*)\s*(.*)$/.exec(line);
    if (fence === null) {
      if (open !== null) body.push(line.startsWith(open.indent) ? line.slice(open.indent.length) : line);
      return;
    }
    if (open === null) {
      open = { line: index + 1, indent: fence[1], lang: fence[2], info: fence[3].trim() };
      body = [];
      return;
    }
    if (/^ya?ml$/.test(open.lang)) found.push({ doc, line: open.line, info: open.info, text: body.join('\n') });
    open = null;
  });
  return found;
}

/** フェンスの `codex: <ファイル> [<道>]`。道を書かなければ定義ファイルのトップレベルと突き合わせる。 */
function parseExcerptSource(info: string): CodexSource | null {
  const matched = /^codex:\s*(.*)$/.exec(info);
  if (matched === null) return null;
  const tokens = tokenize(matched[1]);
  if (tokens === null || tokens.length < 1 || tokens.length > 2) return null;
  const [file, ...dotted] = tokens;
  const path = dotted.flatMap((token) => token.split('.'));
  if (path.some((key) => key === '')) return null;
  return { file, path };
}

function isPlainMap(node: unknown): node is Record<string, unknown> {
  return typeof node === 'object' && node !== null && !Array.isArray(node);
}

/**
 * 抜粋が定義の部分集合になっていない箇所。**抜粋に書いた葉（スカラー）だけを見て、省いたキーは
 * 見ない。** 並びは、抜粋の要素が定義の要素へ**順を保って**1つずつ当たるかで見る——途中の要素を
 * 略した抜粋（段の1つだけ、候補の一部だけ）を、略したまま書けるようにするため。
 */
function excerptGaps(excerpt: unknown, actual: unknown, path: readonly string[] = []): string[] {
  const where = path.length === 0 ? '（抜粋の全体）' : path.join('.');
  if (Array.isArray(excerpt)) {
    if (!Array.isArray(actual)) return [`${where}: 定義の側が並びではない`];
    const gaps: string[] = [];
    let from = 0;
    excerpt.forEach((item, index) => {
      const at = actual.findIndex(
        (candidate, actualIndex) => actualIndex >= from && excerptGaps(item, candidate).length === 0,
      );
      if (at < 0) gaps.push(`${where} の ${index}番目（0始まり）: 定義の並びに、前の要素より後ろで一致するものが無い`);
      else from = at + 1;
    });
    return gaps;
  }
  if (isPlainMap(excerpt)) {
    if (!isPlainMap(actual)) return [`${where}: 定義の側がマップではない`];
    return Object.entries(excerpt).flatMap(([key, value]) =>
      Object.hasOwn(actual, key) ? excerptGaps(value, actual[key], [...path, key]) : [`${[...path, key].join('.')}: 定義に無いキー`],
    );
  }
  return excerpt === actual ? [] : [`${where}: 文書は ${JSON.stringify(excerpt)}、定義は ${JSON.stringify(actual)}`];
}

/** 抜粋に書いた葉（スカラー）の数。 */
function leafCount(node: unknown): number {
  if (typeof node !== 'object' || node === null) return 1;
  return Object.values(node).reduce((sum: number, child) => sum + leafCount(child), 0);
}

/** 定義の中の、マップと並びのすべて。 */
function* containersOf(node: unknown, path: readonly string[] = []): Generator<readonly [readonly string[], object]> {
  if (typeof node !== 'object' || node === null) return;
  yield [path, node];
  for (const [key, child] of Object.entries(node)) yield* containersOf(child, [...path, key]);
}

/**
 * 出どころを名乗っていない YAML が、定義のどこかの部分集合にそのまま当たるなら、その在り処。
 * **書き写したばかりの抜粋は現物と一致する**ので、名乗り忘れはこの形で見つかる。葉が1つだけの
 * ものは見ない（`duration: 15` のような断片は、例として書いても定義のどこかに当たる）。
 */
function unannouncedExcerptSource(block: YamlBlock): string | null {
  if (parseExcerptSource(block.info) !== null) return null;
  let parsed: unknown;
  try {
    parsed = parse(block.text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || leafCount(parsed) < 2) return null;
  for (const [file, root] of CODEX_FILES) {
    for (const [path, node] of containersOf(root)) {
      if (Array.isArray(node) === Array.isArray(parsed) && excerptGaps(parsed, node).length === 0) {
        return [file, ...(path.length === 0 ? [] : [path.join('.')])].join(' ');
      }
    }
  }
  return null;
}

/**
 * 定義が名前で置くもの。`<節>.<ID>`（`object_defs.raft`・`traits.location` など、トップレベルの節の
 * 項目）と `interactions.<ID>`（どこに置かれた操作か）で引き、同じ名前の現物をすべて持つ。
 */
const CODEX_ENTRIES = new Map<string, unknown[]>();
for (const root of CODEX_FILES.values()) {
  const add = (key: string, node: unknown) => CODEX_ENTRIES.set(key, [...(CODEX_ENTRIES.get(key) ?? []), node]);
  if (isPlainMap(root)) {
    for (const [section, entries] of Object.entries(root)) {
      if (isPlainMap(entries)) for (const [id, node] of Object.entries(entries)) add(`${section}.${id}`, node);
    }
  }
  for (const [path, node] of containersOf(root)) {
    if (path.at(-1) === 'interactions' && isPlainMap(node)) {
      for (const [id, entry] of Object.entries(node)) add(`interactions.${id}`, entry);
    }
  }
}

/**
 * 出どころを名乗っていない YAML が実在の名前を借り、**同じ名前のどの現物とも違う値を書いた**項目
 * （`<節>.<ID>`）。名乗らない YAML は例示として読む約束だが、実在の名前が出ていれば現物の写しとして
 * 読まれうる。見るのはトップレベルの節の直下だけ——架空の型の中に置いた操作は、型の名前が例示だと名乗る。
 */
function borrowedNamesWithForeignValues(block: YamlBlock): string[] {
  if (parseExcerptSource(block.info) !== null) return [];
  let parsed: unknown;
  try {
    parsed = parse(block.text);
  } catch {
    return [];
  }
  if (!isPlainMap(parsed)) return [];
  return Object.entries(parsed).flatMap(([section, entries]) =>
    isPlainMap(entries)
      ? Object.entries(entries).flatMap(([id, node]) => {
          const actuals = CODEX_ENTRIES.get(`${section}.${id}`);
          if (actuals === undefined) return [];
          return actuals.some((actual) => excerptGaps(node, actual).length === 0) ? [] : [`${section}.${id}`];
        })
      : [],
  );
}

/** 出どころを名乗った抜粋が、定義とずれている箇所。名乗りが読めない・解けないことも含む。 */
function staleExcerptLines(block: YamlBlock): string[] {
  const where = `${block.doc}:${block.line}: ${block.info}`;
  const source = parseExcerptSource(block.info);
  if (source === null) return block.info.startsWith('codex:') ? [`${where} → 出どころの形が読めない`] : [];

  let excerpt: unknown;
  try {
    excerpt = parse(block.text);
  } catch (error) {
    return [`${where} → YAML として読めない（${(error as Error).message.split('\n')[0]}）`];
  }
  if (typeof excerpt !== 'object' || excerpt === null) return [`${where} → 突き合わせる値が無い`];

  const found = codexNodeAt(source);
  if ('broken' in found) return [`${where} → ${found.broken}`];
  return excerptGaps(excerpt, found.node).map((gap) => `${where} → ${gap}`);
}

const YAML_BLOCKS = listMarkdown('docs').flatMap((rel) => yamlBlocksIn(rel, readFileSync(join(ROOT, rel), 'utf-8')));

const CITATIONS = listMarkdown('docs').flatMap((rel) =>
  citationsIn(rel, readFileSync(join(ROOT, rel), 'utf-8')),
);

describe('文書が stats/*.yaml と定義から書き写した数値', () => {
  it('印が、出どころの1つの値に解決する', () => {
    // 印が1つも取れないこと自体が壊れた状態（印を消しても、値の照合は緑のままになる）。
    for (const kind of ['stats', 'codex']) {
      expect(
        CITATIONS.filter((citation) => citation.body.startsWith(`${kind}:`)).length,
        `${kind}: の印が1つも無い`,
      ).toBeGreaterThan(0);
    }

    const broken: string[] = [];
    for (const citation of CITATIONS) {
      const where = `${citation.doc}:${citation.line}: ${citation.body}`;
      if (citation.mark === null) {
        broken.push(`${where} → 印の形が読めない`);
        continue;
      }
      if (citation.written === null) broken.push(`${where} → 印の直前に数値が無い`);
      if (typeof citation.mark.cell === 'string') broken.push(`${where} → ${citation.mark.cell}`);
    }
    expect(broken, `出どころへ解決しない印:\n${broken.join('\n')}`).toEqual([]);
  });

  it('出どころを名乗った YAML の抜粋は、定義の部分集合になっている', () => {
    // 名乗った抜粋が1つも取れないこと自体が壊れた状態（フェンスの読み方が変わっても緑のままになる）。
    expect(YAML_BLOCKS.filter((block) => parseExcerptSource(block.info) !== null).length).toBeGreaterThan(0);

    const stale = YAML_BLOCKS.flatMap(staleExcerptLines);
    expect(stale, `定義とずれた抜粋。文書を書き直す:\n${stale.join('\n')}`).toEqual([]);
  });

  it('定義にそのまま当たる YAML は、抜粋の出どころを名乗る', () => {
    const unannounced = YAML_BLOCKS.flatMap((block) => {
      const source = unannouncedExcerptSource(block);
      return source === null ? [] : [`${block.doc}:${block.line}: \`\`\`yaml codex: ${source}`];
    });
    expect(unannounced, `出どころを名乗っていない抜粋（フェンスへ置く印の候補）:\n${unannounced.join('\n')}`).toEqual(
      [],
    );
  });

  it('名乗らない YAML が実在の名前を借りるなら、現物と違う値を書かない', () => {
    const borrowed = YAML_BLOCKS.flatMap((block) =>
      borrowedNamesWithForeignValues(block).map((name) => `${block.doc}:${block.line}: ${name}`),
    );
    expect(
      borrowed,
      `実在の名前を借りて現物と違う値を書いた例示。実在しない名前へ付け替えるか、現物に合わせて出どころを名乗る:\n${borrowed.join('\n')}`,
    ).toEqual([]);
  });

  it('書いた数が、印の許す粗さの中で出どころの値と一致する', () => {
    const stale: string[] = [];
    for (const citation of CITATIONS) {
      if (citation.mark === null || citation.written === null) continue;

      const { cell } = citation.mark;
      if (typeof cell === 'string') continue; // 解決しないことは前の試験が見る

      const gap = disagreement(citation.written, cell, citation.mark.coarseness);
      if (gap !== null) {
        stale.push(
          `${citation.doc}:${citation.line}: ${citation.written} と書いてあるが` +
            ` ${citation.body} は ${readable(cell)}（${gap}）`,
        );
      }
    }
    expect(stale, `出どころとずれた数値。文書を書き直す:\n${stale.join('\n')}`).toEqual([]);
  });
});

/** 印を読んでセルまで解決する。解決できなければ、なぜできないかを文で返す（`cellOf` と同じ形）。 */
function cellOfMark(body: string): number | string {
  const mark = parseMark(body);
  return mark === null ? '印の形が読めない' : cellOf(mark);
}

describe('レコードを選ぶ条件', () => {
  /** 1日の献立の1品。工程をつないだ `route` に空白が入る（`balanceStatsReport` の `stepsText`）。 */
  const MARK =
    'balance.yaml daily_minimum_menu place=島全体 route="grassland.explore → water_spinach.eat" minutes';

  it('二重引用符で囲めば、空白を含む値でレコードを1件に絞れる', () => {
    expect(parseMark(MARK)?.source.selectors).toEqual([
      ['place', '島全体'],
      ['route', 'grassland.explore → water_spinach.eat'],
    ]);
    expect(cellOfMark(MARK)).toBeTypeOf('number');
  });

  it('囲まなければ、値の中の空白がトークンの切れ目になる', () => {
    // 切れた先（`→`）が`<列>=<値>`にならないので、絞る前に印そのものが読めなくなる。
    expect(cellOfMark(replaceAllOrFail(MARK, { from: '"', to: '', occurrences: 2 }))).toBe(
      '印の形が読めない',
    );
  });

  it('閉じない引用符は、印ごと読めないものとして赤くする', () => {
    expect(parseMark(replaceAllOrFail(MARK, { from: 'eat"', to: 'eat', occurrences: 1 }))).toBeNull();
  });

  it('値の中の `=` では、列と値に切らない', () => {
    expect(parseMark('balance.yaml consumption property=a=b per_tick')?.source.selectors).toEqual([
      ['property', 'a=b'],
    ]);
  });

  it('`=` で列と値に切れないトークンは、印ごと読めないものとして赤くする', () => {
    for (const selector of ['condition', '=robust', 'condition=']) {
      expect(parseMark(`balance.yaml consumption ${selector} per_tick`)).toBeNull();
    }
  });
});

describe('複数のレコードを畳む印', () => {
  it('生成物の列の名前が、畳み方と紛れない', () => {
    const columns = new Set<string>();
    for (const sections of REPORTS.values()) {
      for (const section of Object.values(sections)) {
        if (!Array.isArray(section)) continue;
        for (const record of section) {
          if (typeof record === 'object' && record !== null) Object.keys(record).forEach((key) => columns.add(key));
        }
      }
    }
    // 畳み方は読む列の次に置くので、同じ名前の列が生えると印が黙ってそちらを畳み方として読む。
    expect([...columns].filter((column) => Object.hasOwn(FOLDS, column))).toEqual([]);
  });

  /** 岸壁から近道で渡る所要日数。季節ごとに1件ずつ並ぶので、季節を選ばなければ畳める。 */
  const COURSE = 'voyage.yaml course_season coast=cliff_coast course=shortest';

  /** 畳んだ値。数に解決しなければ、その理由の文ごと落とす。 */
  function folded(fold: string): number {
    const value = cellOfMark(`${COURSE} days ${fold}`);
    if (typeof value !== 'number') throw new Error(value);
    return value;
  }

  it('幅は、当たったレコードの最大と最小の差', () => {
    expect(folded('幅')).toBeCloseTo(folded('最大') - folded('最小'));
    expect(folded('最小')).toBeLessThan(folded('最大'));
  });

  it('畳み方を書かない印は、2件以上に当たると赤くする', () => {
    expect(cellOfMark(`${COURSE} days`)).toBe('条件に当てはまるレコードが3件（1件に絞る）');
  });

  it('1件しか当たらない条件は、畳めないものとして赤くする', () => {
    expect(cellOfMark(`${COURSE} season=dry days 最小`)).toBe(
      '条件に当てはまるレコードが1件（畳むには2件以上要る）',
    );
  });

  it('当たったレコードの列が数でなければ、畳まずに赤くする', () => {
    expect(cellOfMark(`${COURSE} coast 最小`)).toBe('そのレコードに、その名前の数の列が無い');
  });

  it('畳み方と粗さは両方書ける', () => {
    expect(parseMark(`${COURSE} days 幅 ±0.1`)).toMatchObject({
      fold: '幅',
      coarseness: { width: 0.1 },
    });
  });

  it('知らない畳み方は、印ごと読めないものとして赤くする', () => {
    // 畳み方として読まれなければ列の名前になり、列だったトークンが `=` の無い条件になる。
    expect(cellOfMark(`${COURSE} days 平均`)).toBe('印の形が読めない');
  });
});

/** 粗さの部分だけを読む。印の他の部分は「粗さを足しても…」の試験が見る。 */
function coarsenessOf(token: string): Coarseness | null {
  return parseMark(`balance.yaml object_costs object=raft total_minutes ${token}`)?.coarseness ?? null;
}

describe('印の粗さ', () => {
  it('粗さを書かない印は、書いた桁へ丸めた値との厳密一致で見る', () => {
    expect(disagreement('170', 170.45, null)).toBeNull();
    expect(disagreement('170.5', 170.46, null)).toBeNull();
    expect(disagreement('4200', 4207, null)).toBe('同じ桁で 4207');
  });

  it('出どころと同じ単位の粗さは、書いた数からその幅まで離れてよい', () => {
    const coarseness = coarsenessOf('±100');
    expect(coarseness).toEqual({ width: 100, relative: false });
    expect(disagreement('4200', 4300, coarseness)).toBeNull();
    expect(disagreement('4200', 4301, coarseness)).toBe('許す幅は 4100〜4300');
  });

  it('外れたときに見せる幅は、浮動小数の屑を落とした桁で書く', () => {
    expect(disagreement('0.2', 1.22, coarsenessOf('±0.1'))).toBe('許す幅は 0.1〜0.3');
  });

  it('割合の粗さは、書いた数に対する百分率で幅を決める', () => {
    const coarseness = coarsenessOf('±5%');
    expect(coarseness).toEqual({ width: 5, relative: true });
    expect(disagreement('4200', 4410, coarseness)).toBeNull();
    expect(disagreement('4200', 3989, coarseness)).toBe('許す幅は 3990〜4410');
  });

  it('粗さを足しても、指すセルの読み方は変わらない', () => {
    const source = { file: 'balance.yaml', section: 'object_costs', column: 'total_minutes' };
    expect(parseMark('balance.yaml object_costs object=raft total_minutes ±5%')?.source).toEqual({
      ...source,
      selectors: [['object', 'raft']],
    });
    expect(parseMark('balance.yaml object_costs total_minutes')).toEqual({
      source: { ...source, selectors: [] },
      fold: null,
      coarseness: null,
    });
  });

  it('読めない粗さは、印ごと読めないものとして赤くする', () => {
    for (const token of ['±', '±5％', '±5%%', '±-5', '±5分']) {
      expect(parseMark(`balance.yaml object_costs object=raft total_minutes ${token}`)).toBeNull();
    }
  });
});

/** 本文に置く印。中身は `印の粗さ` と同じセルを指すもので、ここで見るのは印の外側だけ。 */
const RAFT_MARK = '<!-- stats: balance.yaml object_costs object=raft total_minutes -->';

/** 1行の本文から拾った、印の直前の数。印が拾えなければ undefined。 */
function writtenIn(text: string): string | null | undefined {
  return citationsIn('doc.md', text)[0]?.written;
}

describe('印の直前に書かれている数', () => {
  it('数に接している負号は、数の一部として読む', () => {
    expect(writtenIn(`免疫が立てば1tickに−0.20${RAFT_MARK}`)).toBe('-0.20');
    expect(writtenIn(`免疫が立てば1tickに-0.20${RAFT_MARK}`)).toBe('-0.20');
  });

  it('数から離れた `-` は符号ではない', () => {
    expect(writtenIn(`- 0.20${RAFT_MARK}`)).toBe('0.20');
  });

  it('負の数も、書いた桁へ丸めた値と比べる', () => {
    expect(disagreement('-0.20', -0.2, null)).toBeNull();
    expect(disagreement('-0.20', 0.2, null)).toBe('同じ桁で 0.20');
    expect(disagreement('-0.20', -0.25, coarsenessOf('±50%'))).toBeNull();
  });
});

describe('コードとして囲んだ印', () => {
  it('フェンスで囲んだブロックの中も、本文と同じに拾う', () => {
    expect(writtenIn(`\`\`\`text\n約4,200分${RAFT_MARK}\n\`\`\``)).toBe('4200');
  });

  it('バッククォートで囲んだ印も、本文と同じに拾う', () => {
    expect(citationsIn('doc.md', `形は \`${RAFT_MARK}\` です`)).toHaveLength(1);
  });

  it('バッククォートで囲んだ数は、印の直前の数として読む', () => {
    expect(writtenIn(`入力 約\`4,200\`分${RAFT_MARK}`)).toBe('4200');
  });

  it('出どころをプレースホルダで書いた形は、印として読まない', () => {
    expect(citationsIn('doc.md', '形は `<!-- stats: <ファイル> <節> <読む列> -->` です')).toEqual([]);
  });
});

/** `codex:` の印を読んで値まで解決する。解決できなければ、なぜできないかを文で返す。 */
function codexValueOfMark(body: string): number | string {
  const mark = parseCodexMark(body);
  return mark === null ? '印の形が読めない' : codexValueOf(mark.source);
}

describe('定義を指す印', () => {
  /** 刃物で割って編むと採れる枚数。マップの中のキーを辿った先の数。 */
  const SPLIT_COUNT = 'weaving.yaml object_defs.palm_frond.interactions.split_and_weave.spawn.count';

  it('キーの道を辿って、定義の中の1つの数に解決する', () => {
    expect(codexValueOfMark(SPLIT_COUNT)).toBe(2);
  });

  it('リストの中は、0始まりの添字で指せる', () => {
    expect(
      codexValueOfMark('clothing.yaml object_defs.bundled_leaf_clothing.passives.0.modify.parent.chill_point'),
    ).toBeTypeOf('number');
  });

  it('入れ子のフォルダの定義も、置き場からの相対パスで指せる', () => {
    expect(codexValueOfMark('characters/player_character.yaml traits')).toBe('その道の先が数ではない');
  });

  it('無いキーで途切れる道は、どこで途切れたかを添えて赤くする', () => {
    expect(codexValueOfMark('weaving.yaml object_defs.palm_frond.interactions.weave.spawn.count')).toBe(
      'その道が object_defs.palm_frond.interactions.weave.spawn.count で途切れる',
    );
  });

  it('リストをキーの名前で辿ろうとする道は、途切れたものとして赤くする', () => {
    expect(codexValueOfMark('clothing.yaml object_defs.bundled_leaf_clothing.passives.modify')).toBe(
      'その道が object_defs.bundled_leaf_clothing.passives.modify で途切れる',
    );
  });

  it('置き場に無いファイルは赤くする', () => {
    expect(codexValueOfMark('balance.yaml object_costs')).toBe(`${WORLD_CODEX_DIR}/ に無いファイル`);
  });

  it('粗さは生成物の印と同じに書ける', () => {
    expect(parseCodexMark(`${SPLIT_COUNT} ±5%`)?.coarseness).toEqual({ width: 5, relative: true });
  });

  it('空の区切りを持つ道・ファイルと道の2つに切れない印は、読めないものとして赤くする', () => {
    for (const body of ['weaving.yaml object_defs..palm_frond', 'weaving.yaml', `${SPLIT_COUNT} extra`, `${SPLIT_COUNT} ±`]) {
      expect(parseCodexMark(body), body).toBeNull();
    }
  });

  it('本文に置いた印は、生成物の印と同じく直前の数と突き合わせる', () => {
    expect(citationsIn('doc.md', `割れば2枚<!-- codex: ${SPLIT_COUNT} -->`)).toMatchObject([
      { written: '2', mark: { cell: 2, coarseness: null } },
    ]);
  });
});

describe('出どころを名乗った YAML の抜粋', () => {
  /** 1つのフェンスだけの文書から、抜粋のずれを拾う。 */
  function staleIn(info: string, ...lines: string[]): string[] {
    return yamlBlocksIn('doc.md', [`\`\`\`yaml ${info}`, ...lines, '```'].join('\n')).flatMap(staleExcerptLines);
  }

  /** 火口の湿り。段の並びを持つ。 */
  const MOISTURE = 'codex: fire.yaml traits.ignitable.props.moisture';

  it('書いた葉が定義と一致し、省いたキーは見ない', () => {
    expect(staleIn(MOISTURE, 'value: 0', '# 説明のコメントは解いた時点で落ちる', 'range: {max: 24}')).toEqual([]);
  });

  it('値の違う葉と、定義に無いキーを、道を添えて挙げる', () => {
    expect(staleIn(MOISTURE, 'value: 1', 'range: {max: 24, step: 1}')).toEqual([
      'doc.md:1: codex: fire.yaml traits.ignitable.props.moisture → value: 文書は 1、定義は 0',
      'doc.md:1: codex: fire.yaml traits.ignitable.props.moisture → range.step: 定義に無いキー',
    ]);
  });

  it('並びは、途中の要素を略してよいが、順は保つ', () => {
    expect(staleIn(MOISTURE, 'stages:', '  - {name: dry}', '  - {name: sodden, min: 16}')).toEqual([]);
    expect(staleIn(MOISTURE, 'stages:', '  - {name: sodden}', '  - {name: dry}')).toEqual([
      'doc.md:1: codex: fire.yaml traits.ignitable.props.moisture → stages の 1番目（0始まり）: 定義の並びに、前の要素より後ろで一致するものが無い',
    ]);
  });

  it('並びの要素は、書いた葉がすべて一致する要素にだけ当たる', () => {
    expect(staleIn(MOISTURE, 'stages:', '  - {name: damp, min: 16}')).toHaveLength(1);
  });

  it('道を書かなければ、定義ファイルのトップレベルと突き合わせる', () => {
    expect(staleIn('codex: fire.yaml', 'traits:', '  ignitable:', '    props:', '      moisture: {value: 0}')).toEqual(
      [],
    );
  });

  it('道が途切れる・置き場に無いファイル・読めない名乗りは赤くする', () => {
    expect(staleIn('codex: fire.yaml traits.nothing', 'value: 0')).toEqual([
      'doc.md:1: codex: fire.yaml traits.nothing → その道が traits.nothing で途切れる',
    ]);
    expect(staleIn('codex: balance.yaml', 'value: 0')).toEqual([
      `doc.md:1: codex: balance.yaml → ${WORLD_CODEX_DIR}/ に無いファイル`,
    ]);
    expect(staleIn('codex: fire.yaml traits..ignitable', 'value: 0')).toEqual([
      'doc.md:1: codex: fire.yaml traits..ignitable → 出どころの形が読めない',
    ]);
  });

  it('YAML として読めない・葉を持たない抜粋は赤くする', () => {
    expect(staleIn(MOISTURE, 'value: [0')).toHaveLength(1);
    expect(staleIn(MOISTURE, '# コメントだけ')).toEqual([
      'doc.md:1: codex: fire.yaml traits.ignitable.props.moisture → 突き合わせる値が無い',
    ]);
  });

  it('CRLF の行末でも、フェンスと名乗りを読む', () => {
    // Windows の作業ツリーは CRLF で取り出される（CLAUDE.md「実装スタイル」）。
    const text = [`\`\`\`yaml ${MOISTURE}`, 'value: 1', '```'].join('\r\n');
    expect(yamlBlocksIn('doc.md', text).flatMap(staleExcerptLines)).toEqual([
      'doc.md:1: codex: fire.yaml traits.ignitable.props.moisture → value: 文書は 1、定義は 0',
    ]);
  });

  it('字下げしたフェンスの中身も、字下げを除いて読む', () => {
    const text = ['- 箇条書きの中', `  \`\`\`yaml ${MOISTURE}`, '  value: 1', '  ```'].join('\n');
    expect(yamlBlocksIn('doc.md', text).flatMap(staleExcerptLines)).toHaveLength(1);
  });
});

describe('出どころを名乗っていない YAML', () => {
  function sourceOf(...lines: string[]): string | null {
    const [block] = yamlBlocksIn('doc.md', ['```yaml', ...lines, '```'].join('\n'));
    return unannouncedExcerptSource(block);
  }

  it('定義のどこかにそのまま当たるなら、その在り処を挙げる', () => {
    expect(sourceOf('moisture:', '  value: 0', '  range: {max: 24}')).toBe('fire.yaml traits.ignitable.props');
  });

  it('当たらないもの・葉が1つだけの断片は挙げない', () => {
    expect(sourceOf('moisture:', '  value: 0', '  range: {max: 25}')).toBeNull();
    expect(sourceOf('value: 0')).toBeNull();
  });

  describe('実在の名前を借りた例示', () => {
    function borrowedIn(info: string, ...lines: string[]): string[] {
      const [block] = yamlBlocksIn('doc.md', [`\`\`\`yaml ${info}`, ...lines, '```'].join('\n'));
      return borrowedNamesWithForeignValues(block);
    }

    it('現物と違う値を書いた型・trait・操作を挙げる', () => {
      expect(borrowedIn('', 'traits:', '  ignitable:', '    props:', '      moisture: {value: 1}')).toEqual([
        'traits.ignitable',
      ]);
      expect(borrowedIn('', 'interactions:', '  split_and_weave:', '    trigger: menu', '    spawn: {count: 99}')).toEqual([
        'interactions.split_and_weave',
      ]);
    });

    it('同じ名前の現物のどれかの部分集合なら挙げない', () => {
      expect(borrowedIn('', 'traits:', '  ignitable:', '    props:', '      moisture: {value: 0}')).toEqual([]);
    });

    it('実在しない名前と、出どころを名乗ったフェンスは見ない', () => {
      expect(borrowedIn('', 'traits:', '  made_up_trait:', '    props: {moisture: {value: 1}}')).toEqual([]);
      expect(borrowedIn('codex: fire.yaml', 'traits:', '  ignitable:', '    props: {moisture: {value: 1}}')).toEqual(
        [],
      );
    });
  });
});
