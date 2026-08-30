import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * 文書が `stats/*.yaml` から書き写した数値が、出どころとずれていないかの検査。
 *
 * 生成物の側には鮮度の試験がある（`tests/support/generatedReport.ts` の
 * `describeReportFreshness`）が、**そこから文書へ書き写した数値は誰も見ていない**——再生成すると
 * 文書だけが古い値を持ったまま緑になる（issue #860）。
 *
 * 文書側は、書き写した数値の直後に出どころの印を置く。**印の形・粗さの書き方・何を印で書いてよいかは
 * [`docs/diagnostics/README.md`](../../docs/diagnostics/README.md)「文書へ書き写した数値には、
 * 出どころの印を置く」。**
 */

const ROOT = resolve(__dirname, '../..');

const STATS_DIR = 'stats';

/** 書き写した数値の出どころを名乗る印。 */
const MARK_PATTERN = /<!--\s*stats:\s*([^>]*?)\s*-->/g;

/**
 * 印の直前に書かれている数と、そこから印までの隙間。隙間に数字と表の区切り（`|`）を許さないので、
 * 印は数値と同じセルの、単位や強調をまたぐ程度の近さに置くことになる。
 */
const WRITTEN_NUMBER_PATTERN = /(\d[\d,]*(?:\.\d+)?)[^\d|]{0,8}$/;

/** 印の末尾に置く粗さ。`±100` は出どころと同じ単位、`±5%` は書いた数に対する割合。 */
const COARSENESS_PATTERN = /^±(\d+(?:\.\d+)?)(%?)$/;

/** 印が指す、レポートの1つのセル。 */
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
  /** 粗さ。書かれていなければ null（書いた桁へ丸めた厳密一致）。 */
  readonly coarseness: Coarseness | null;
}

/** 文書の1つの印。 */
interface Citation {
  readonly doc: string;
  readonly line: number;
  readonly body: string;
  readonly mark: Mark | null;
  /** 印の直前に書かれている数（桁区切りのカンマを除いたもの）。無ければ null。 */
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

function parseMark(body: string): Mark | null {
  const tokens = body.split(/\s+/).filter((token) => token !== '');

  let coarseness: Coarseness | null = null;
  const last = tokens.at(-1);
  if (last !== undefined && last.startsWith('±')) {
    const matched = COARSENESS_PATTERN.exec(last);
    if (matched === null) return null;
    coarseness = { width: Number(matched[1]), relative: matched[2] === '%' };
    tokens.pop();
  }

  if (tokens.length < 3) return null;

  const [file, section, ...rest] = tokens;
  const column = rest.pop() as string;
  const selectors = rest.map((token) => token.split('='));
  if (selectors.some((pair) => pair.length !== 2 || pair[0] === '' || pair[1] === '')) return null;

  return { source: { file, section, selectors: selectors as [string, string][], column }, coarseness };
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
  return `許す幅は ${value - width}〜${value + width}`;
}

function citationsIn(rel: string): Citation[] {
  const found: Citation[] = [];
  let inFence = false;
  readFileSync(join(ROOT, rel), 'utf-8')
    .split('\n')
    .forEach((raw, index) => {
      // 印は本文の数値に付く。コードの中にあるのは書式の例なので、出どころを持たない。
      if (raw.trimStart().startsWith('```')) inFence = !inFence;
      if (inFence) return;
      const line = raw.replace(/`[^`]*`/g, '');

      for (const match of line.matchAll(MARK_PATTERN)) {
        // 先に置かれた印の中身は数として読まない（印の本文に数字が入りうる）。
        const before = line.slice(0, match.index).replace(/<!--[\s\S]*?-->/g, '');
        const written = WRITTEN_NUMBER_PATTERN.exec(before);
        found.push({
          doc: rel,
          line: index + 1,
          body: match[1],
          mark: parseMark(match[1]),
          written: written === null ? null : written[1].replace(/,/g, ''),
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

/** 印が指すセルの値。解決できなければ、なぜ解決できないかを文で返す。 */
function cellOf(source: Source): number | string {
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
  if (matched.length !== 1) return `条件に当てはまるレコードが${matched.length}件（1件に絞る）`;

  const cell = matched[0][source.column];
  if (typeof cell !== 'number') return 'そのレコードに、その名前の数の列が無い';
  return cell;
}

const CITATIONS = listMarkdown('docs').flatMap(citationsIn);

describe('文書が stats/*.yaml から書き写した数値', () => {
  it('印が、レポートの1つのセルに解決する', () => {
    // 印が1つも取れないこと自体が壊れた状態（印を消しても、値の照合は緑のままになる）。
    expect(CITATIONS.length, '出どころの印が1つも無い').toBeGreaterThan(0);

    const broken: string[] = [];
    for (const citation of CITATIONS) {
      const where = `${citation.doc}:${citation.line}: ${citation.body}`;
      if (citation.mark === null) {
        broken.push(`${where} → 印の形が読めない`);
        continue;
      }
      if (citation.written === null) broken.push(`${where} → 印の直前に数値が無い`);

      const cell = cellOf(citation.mark.source);
      if (typeof cell === 'string') broken.push(`${where} → ${cell}`);
    }
    expect(broken, `出どころへ解決しない印:\n${broken.join('\n')}`).toEqual([]);
  });

  it('書いた数が、印の許す粗さの中で出どころのセルと一致する', () => {
    const stale: string[] = [];
    for (const citation of CITATIONS) {
      if (citation.mark === null || citation.written === null) continue;

      const cell = cellOf(citation.mark.source);
      if (typeof cell === 'string') continue; // 解決しないことは前の試験が見る

      const gap = disagreement(citation.written, cell, citation.mark.coarseness);
      if (gap !== null) {
        stale.push(
          `${citation.doc}:${citation.line}: ${citation.written} と書いてあるが` +
            ` ${citation.body} は ${cell}（${gap}）`,
        );
      }
    }
    expect(stale, `出どころとずれた数値。文書を書き直す:\n${stale.join('\n')}`).toEqual([]);
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
      coarseness: null,
    });
  });

  it('読めない粗さは、印ごと読めないものとして赤くする', () => {
    for (const token of ['±', '±5％', '±5%%', '±-5', '±5分']) {
      expect(parseMark(`balance.yaml object_costs object=raft total_minutes ${token}`)).toBeNull();
    }
  });
});
