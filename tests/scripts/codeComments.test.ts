import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commentParts, commentsOnly, withoutComments } from '../../scripts/codeComments.mjs';
import { trackedFiles } from '../../scripts/docScope.mjs';

const ROOT = resolve(__dirname, '../..');

describe('commentParts', () => {
  it('ブロックの外で行頭が `*` の行（ジェネレータの宣言）はコードとして読む', () => {
    const source = ['class A {', '  *[Symbol.iterator]() {', '    yield 1;', '  }', '}'].join('\n');
    expect(commentParts(source, 'a.ts')).toEqual([null, null, null, null, null]);
  });

  it('ブロックの中は、印の無い行も閉じる行も本文', () => {
    const source = ['/**', ' * 説明', '   印の無い行', ' */', 'const x = 1;'].join('\n');
    expect(commentParts(source, 'a.ts').map((part) => part !== null)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it('行の途中から始まるコメントは拾わない', () => {
    expect(commentParts('const x = 1; // 説明', 'a.ts')).toEqual([null]);
  });

  it('JS・TS以外は行頭の `#` だけを見る', () => {
    expect(commentParts('# 説明\nkey: value\n// 値', 'a.yaml')).toEqual(['# 説明', null, null]);
  });

  it('`commentsOnly` は同じ判定で、落とした行を空行にする', () => {
    expect(commentsOnly('// a\nconst x = 1;\n/* b */', 'a.ts')).toEqual('// a\n\n/* b ');
  });
});

describe('withoutComments', () => {
  it('JS・TSは、ブロックと行の途中からのコメントも落とし、行番号を揃える', () => {
    const source = ['/**', ' * 説明 hidden', ' */', 'const x = 1; // hidden', 'x();'].join('\n');
    const code = withoutComments(source, 'a.ts');
    expect(code).not.toContain('hidden');
    expect(code.split('\n')).toHaveLength(5);
    expect(code.split('\n')[3]).toBe('const x = 1; ');
  });

  it('`:` の直後の `//` は残す（`https://…`）', () => {
    expect(withoutComments("const url = 'https://example.com';", 'a.mjs')).toBe(
      "const url = 'https://example.com';",
    );
  });

  it('JS・TS以外は、行頭か空白に続く `#` から落とし、語へ続く `#` は残す', () => {
    expect(withoutComments('color: "#fff" # hidden\n# hidden\necho ${#arr}', 'a.sh')).toBe(
      'color: "#fff" \n\necho ${#arr}',
    );
  });

  it('落ち方が、改行コードで変わらない', () => {
    const lf = 'node "$HERE/board.mjs" # live-sessions.mjs は呼ばない\nconst a = 1; // b.mjs\n';
    for (const rel of ['a.sh', 'a.mjs']) {
      // 一致だけでは、両方が同じに壊れていても緑になる。落ちていることを先に見る。
      expect(withoutComments(lf, rel), 'コメントが落ちている').not.toMatch(
        rel === 'a.sh' ? /live-sessions/ : /b\.mjs/,
      );
      expect(withoutComments(lf.replace(/\n/g, '\r\n'), rel).replace(/\r/g, '')).toBe(
        withoutComments(lf, rel),
      );
    }
  });
});

/**
 * 「その行がコメントか」を行頭の印で決めている、`commentParts` の外の箇所。**判定がもう1つに
 * 割れたら、ここが赤くなる**——写しは規則が少しずつずれ、検査ごとに見ているものが変わる。
 *
 * 拾うのは `startsWith` に印を渡す形。印ではない `#` の判定（私的な名前 `#field`）は
 * {@link NOT_COMMENT_MARKS} で行ごとに名指しして外す——`#` ごと外すと、シェルや YAML の写しが緑で通る。
 */
function copiesOfCommentJudgement(): string[] {
  const self = join('tests', 'scripts', 'codeComments.test.ts');
  const owner = join('scripts', 'codeComments.mjs');
  const pattern = /\.startsWith\(\s*(['"])(\/\/|\/\*|\*|#)\1\s*\)/;
  return ['.ts', '.mts', '.mjs', '.js', '.cjs']
    .flatMap((ext) => trackedFiles(ROOT, `*${ext}`))
    .filter((rel) => rel !== self && rel !== owner)
    .flatMap((rel) =>
      readFileSync(join(ROOT, rel), 'utf-8')
        .split('\n')
        .flatMap((line, index) =>
          pattern.test(line) && !isNotCommentMark(rel, line)
            ? [`${rel.split(sep).join('/')}:${index + 1} ${line.trim()}`]
            : [],
        ),
    );
}

/** 行頭の `#` を見ているが、コメントの判定ではない行。 */
const NOT_COMMENT_MARKS = [
  {
    // 私的な名前（`#field`）
    file: join('scripts', 'declarationInventory.mjs'),
    line: "if (modifiers.includes('private') || name.startsWith('#')) return 'private';",
  },
];

function isNotCommentMark(rel: string, line: string): boolean {
  return NOT_COMMENT_MARKS.some((mark) => mark.file === rel && mark.line === line.trim());
}

describe('コメントの判定', () => {
  it('`scripts/codeComments.mjs` の外に写しが無い', () => {
    expect(copiesOfCommentJudgement(), 'commentParts を通さずにコメントを見分けている').toEqual([]);
  });

  it('名指しで外した行が今も在る（消えた行の除外を残さない）', () => {
    const missing = NOT_COMMENT_MARKS.filter(
      ({ file, line }) =>
        !readFileSync(join(ROOT, file), 'utf-8')
          .split('\n')
          .some((raw) => raw.trim() === line),
    );
    expect(missing).toEqual([]);
  });
});

/**
 * コードからコメントを剥がす正規表現を、`withoutComments` の外で書いている箇所。**剥がす処理がもう
 * 1つに割れたら、ここが赤くなる**——写しは剥がす範囲が少しずつずれ、同じ説明が検査によってコードに
 * 数えられたり数えられなかったりする。
 *
 * 拾うのは、ブロック（`\/\*[\s\S]`）・`//` から行末（`\/\/.*`・`\/\/[^\n]*`）・`#` から行末
 * （`#.*`・`#[^\n]*`）を正規表現で書いた行。
 */
function copiesOfCommentStripping(): string[] {
  const self = join('tests', 'scripts', 'codeComments.test.ts');
  const owner = join('scripts', 'codeComments.mjs');
  const pattern = /\\\/\\\*\[\\s\\S\]|(?:\\\/\\\/|#)(?:\.\*|\[\^\\n\]\*)/;
  return ['.ts', '.mts', '.mjs', '.js', '.cjs']
    .flatMap((ext) => trackedFiles(ROOT, `*${ext}`))
    .filter((rel) => rel !== self && rel !== owner)
    .flatMap((rel) =>
      readFileSync(join(ROOT, rel), 'utf-8')
        .split('\n')
        .flatMap((line, index) =>
          pattern.test(line) ? [`${rel.split(sep).join('/')}:${index + 1} ${line.trim()}`] : [],
        ),
    );
}

describe('コメントの剥がし方', () => {
  it('`scripts/codeComments.mjs` の外に写しが無い', () => {
    expect(copiesOfCommentStripping(), 'withoutComments を通さずにコメントを剥がしている').toEqual([]);
  });
});
