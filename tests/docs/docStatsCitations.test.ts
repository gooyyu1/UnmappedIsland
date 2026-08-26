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
 * 文書側は、書き写した数値の直後に出どころの印を置く。
 *
 * ```text
 * **片道の平均は86.43分**<!-- stats: terrain.yaml base_one_way base=shortest_mean mean -->
 * ```
 *
 * 印の形は `<!-- stats: <ファイル> <節> [<列>=<値> …] <読む列> -->` で、`<列>=<値>` はレコードを
 * 選ぶ条件。**1件に絞れなければ赤くする**ので、選ぶ鍵が増えた（節に別の `base` が入った等）ことも
 * 見つかる。
 *
 * **見るのは「YAMLの1つのセルを、丸めだけを挟んで書き写した数値」だけ。** 文書が書いた桁数へ
 * 丸めた値と突き合わせるので、`170.45` を「170分」と書いてよい。**複数のセルや仮置きから導いた
 * 数値（158日・176日・48,700分など）は対象外**——導出は書き写しではなく文書の主張で、式を印に
 * 書けるようにすると同じ計算が文書と生成器の2箇所に立つ。対象は生成物だけで、人が書く定義
 * （`src/assets/world-codex/*.yaml`）は再生成でずれる問題を持たないので見ない。
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

/** 印が指す、レポートの1つのセル。 */
interface Source {
  readonly file: string;
  readonly section: string;
  readonly selectors: readonly (readonly [string, string])[];
  readonly column: string;
}

/** 文書の1つの印。 */
interface Citation {
  readonly doc: string;
  readonly line: number;
  readonly body: string;
  readonly source: Source | null;
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

function parseSource(body: string): Source | null {
  const tokens = body.split(/\s+/).filter((token) => token !== '');
  if (tokens.length < 3) return null;

  const [file, section, ...rest] = tokens;
  const column = rest.pop() as string;
  const selectors = rest.map((token) => token.split('='));
  if (selectors.some((pair) => pair.length !== 2 || pair[0] === '' || pair[1] === '')) return null;

  return { file, section, selectors: selectors as [string, string][], column };
}

function citationsIn(rel: string): Citation[] {
  const found: Citation[] = [];
  readFileSync(join(ROOT, rel), 'utf-8')
    .split('\n')
    .forEach((raw, index) => {
      for (const match of raw.matchAll(MARK_PATTERN)) {
        // 先に置かれた印の中身は数として読まない（印の本文に数字が入りうる）。
        const before = raw.slice(0, match.index).replace(/<!--[\s\S]*?-->/g, '');
        const written = WRITTEN_NUMBER_PATTERN.exec(before);
        found.push({
          doc: rel,
          line: index + 1,
          body: match[1],
          source: parseSource(match[1]),
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
      if (citation.source === null) {
        broken.push(`${where} → 印の形が読めない`);
        continue;
      }
      if (citation.written === null) broken.push(`${where} → 印の直前に数値が無い`);

      const cell = cellOf(citation.source);
      if (typeof cell === 'string') broken.push(`${where} → ${cell}`);
    }
    expect(broken, `出どころへ解決しない印:\n${broken.join('\n')}`).toEqual([]);
  });

  it('書いた桁へ丸めた値が、出どころのセルと一致する', () => {
    const stale: string[] = [];
    for (const citation of CITATIONS) {
      if (citation.source === null || citation.written === null) continue;

      const cell = cellOf(citation.source);
      if (typeof cell === 'string') continue; // 解決しないことは前の試験が見る

      const decimals = citation.written.split('.')[1]?.length ?? 0;
      const rounded = cell.toFixed(decimals);
      if (rounded !== citation.written) {
        stale.push(
          `${citation.doc}:${citation.line}: ${citation.written} と書いてあるが` +
            ` ${citation.body} は ${cell}（同じ桁で ${rounded}）`,
        );
      }
    }
    expect(stale, `出どころとずれた数値。文書を書き直す:\n${stale.join('\n')}`).toEqual([]);
  });
});
