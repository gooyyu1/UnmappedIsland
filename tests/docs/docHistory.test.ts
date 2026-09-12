import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 経緯を主題としない文書とコメントに、過去の姿を語る記述が生えていないかの検査
 * （[`docs/DocumentStyle.md`](../../docs/DocumentStyle.md) 9.1節、
 * [`CLAUDE.md`](../../CLAUDE.md)「ドキュメント・コメントのスタイル」）。
 *
 * **書いてよい文書の別は、9.1節の表からだけ引く。** ここへ写すと、表を増やしたときに2箇所が
 * ずれる。表に無い文書やコメントで過去の姿から書き始めた記述は、旧仕様を知らない読み手には
 * 要らないものになる（issue #1936）。
 */

const ROOT = resolve(__dirname, '../..');

const DOCUMENT_STYLE = 'docs/DocumentStyle.md';

/**
 * リポジトリルートからの相対パスを `/` 区切りで持つ。**照合する両側を揃えるため**——`path.join` は
 * Windows で `\` を返すので、片側だけそれで組むと一致が一度も起きない。
 */
function repoPath(path: string): string {
  return path.split(sep).join('/');
}

/** 印そのものを持つこのファイル。中身が印と一致するので、自分自身は見られない。 */
const SELF = repoPath(relative(ROOT, __filename));

/**
 * 過去の姿を語り出す印。**過去の姿を指すことがその語の意味であるものだけを挙げる。** 単なる
 * 過去形（「〜でした」）は測定の報告にも使うので、見ない。
 */
const MARKERS = ['かつて', '以前は', 'ていた頃', 'だった頃', '時期があ'];

/** 9.1節の表が挙げる文書を、リポジトリルートからの相対パスで返す。 */
function documentsAllowedToTellHistory(): Set<string> {
  const text = readFileSync(join(ROOT, DOCUMENT_STYLE), 'utf-8');
  const section = /\n### 9\.1 [^\n]*\n([\s\S]*?)(?=\n#{2,3} |$)/.exec(text);
  if (section === null) throw new Error(`${DOCUMENT_STYLE} に 9.1 節が無い`);
  const allowed = new Set<string>();
  for (const [, target] of section[1].matchAll(/^\| \[[^\]]+\]\(([^)\s]+)\)/gm)) {
    // リンクの綴りは `/` 区切りなので、`posix` で畳んで先頭の `./` だけを落とす。
    allowed.add(posix.join('docs', target.split('#')[0]));
  }
  if (allowed.size === 0) throw new Error(`${DOCUMENT_STYLE} 9.1 節の表から文書を引けない`);
  return allowed;
}

function filesIn(dir: string, extension: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...filesIn(rel, extension));
    else if (entry.endsWith(extension)) found.push(rel);
  }
  return found;
}

/** その行がコメントの一部か（ブロックの途中も含む）。データの中の語まで見ないための線。 */
function isComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

function historyIn(file: string, lookAt: (line: string) => boolean): string[] {
  const found: string[] = [];
  readFileSync(join(ROOT, file), 'utf-8')
    .split('\n')
    .forEach((line, index) => {
      if (!lookAt(line)) return;
      for (const marker of MARKERS) {
        if (line.includes(marker)) found.push(`${file}:${index + 1} 「${marker}」 ${line.trim()}`);
      }
    });
  return found;
}

const ALLOWED = documentsAllowedToTellHistory();
const ALL_DOCUMENTS = filesIn('docs', '.md');
const DOCUMENTS = ALL_DOCUMENTS.filter((doc) => !ALLOWED.has(doc));
const SOURCES = [...filesIn('src', '.ts'), ...filesIn('tests', '.ts')].filter(
  (source) => source !== SELF,
);

describe('9.1節の表から引いた文書が、走査した文書と噛み合っている', () => {
  // 噛み合っていないと**除外が1つも当たらない**が、赤くなるのは表の文書がマーカー語を持つときだけ
  // ——綴りの取り違えもパス区切りのずれも、ここで落ちる。
  it.each([...ALLOWED])('%s が `docs/` の走査結果に在る', (doc) => {
    expect(ALL_DOCUMENTS).toContain(doc);
  });
});

describe('経緯を主題としない文書は、過去の姿を語らない', () => {
  it.each(DOCUMENTS)('%s', (doc) => {
    expect(historyIn(doc, () => true)).toEqual([]);
  });
});

describe('コメントは、過去の姿を語らない', () => {
  it.each(SOURCES)('%s', (source) => {
    expect(historyIn(source, isComment)).toEqual([]);
  });
});
