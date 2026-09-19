import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { replaceAllOrFail } from '../support/textEdit';

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

/** 文書の1つの印。 */
interface Citation {
  readonly doc: string;
  readonly line: number;
  readonly body: string;
  readonly mark: Mark | null;
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
 * （`condition="段 immunity=robust"`）。閉じない引用符は、印ごと読めないものとして null。
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

/** `<列>=<値>`。**値の側に `=` が入りうる**（`段 immunity=robust`）ので、最初の1つでだけ切る。 */
function splitSelector(token: string): readonly [string, string] | null {
  const index = token.indexOf('=');
  if (index <= 0 || index === token.length - 1) return null;
  return [token.slice(0, index), token.slice(index + 1)];
}

function parseMark(body: string): Mark | null {
  const tokens = tokenize(body);
  if (tokens === null) return null;

  let coarseness: Coarseness | null = null;
  const last = tokens.at(-1);
  if (last !== undefined && last.startsWith('±')) {
    const matched = COARSENESS_PATTERN.exec(last);
    if (matched === null) return null;
    coarseness = { width: Number(matched[1]), relative: matched[2] === '%' };
    tokens.pop();
  }

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
        body: match[1],
        mark: parseMark(match[1]),
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

const CITATIONS = listMarkdown('docs').flatMap((rel) =>
  citationsIn(rel, readFileSync(join(ROOT, rel), 'utf-8')),
);

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

      const cell = cellOf(citation.mark);
      if (typeof cell === 'string') broken.push(`${where} → ${cell}`);
    }
    expect(broken, `出どころへ解決しない印:\n${broken.join('\n')}`).toEqual([]);
  });

  it('書いた数が、印の許す粗さの中で出どころのセルと一致する', () => {
    const stale: string[] = [];
    for (const citation of CITATIONS) {
      if (citation.mark === null || citation.written === null) continue;

      const cell = cellOf(citation.mark);
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
  /** 免疫の段ごとに菌が引かれる量。`condition` に空白が入る（`balanceTables` の `conditionLabel`）。 */
  const MARK =
    'balance.yaml consumption property=pathogen condition="段 immunity=robust" character=medic per_tick';

  it('二重引用符で囲めば、空白を含む値でレコードを1件に絞れる', () => {
    expect(parseMark(MARK)?.source.selectors).toEqual([
      ['property', 'pathogen'],
      ['condition', '段 immunity=robust'],
      ['character', 'medic'],
    ]);
    expect(cellOfMark(MARK)).toBeTypeOf('number');
  });

  it('囲まなければ、値の中の空白がトークンの切れ目になる', () => {
    expect(cellOfMark(replaceAllOrFail(MARK, { from: '"', to: '', occurrences: 2 }))).toBe(
      '条件に当てはまるレコードが0件（1件に絞る）',
    );
  });

  it('閉じない引用符は、印ごと読めないものとして赤くする', () => {
    expect(parseMark(replaceAllOrFail(MARK, { from: 'robust"', to: 'robust', occurrences: 1 }))).toBeNull();
  });

  it('`=` で列と値に切れないトークンは、印ごと読めないものとして赤くする', () => {
    for (const selector of ['condition', '=robust', 'condition=']) {
      expect(parseMark(`balance.yaml consumption ${selector} per_tick`)).toBeNull();
    }
  });
});

describe('複数のレコードを畳む印', () => {
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
