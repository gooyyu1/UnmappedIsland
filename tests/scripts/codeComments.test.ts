import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commentParts, commentsOnly } from '../../scripts/codeComments.mjs';
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

/**
 * 「その行がコメントか」を行頭の印で決めている、`commentParts` の外の箇所。**判定がもう1つに
 * 割れたら、ここが赤くなる**——写しは規則が少しずつずれ、検査ごとに見ているものが変わる。
 *
 * 拾うのは `startsWith` に印を渡す形だけ。`#` は私的な名前（`#field`）の判定にも使うので見ない。
 */
function copiesOfCommentJudgement(): string[] {
  const self = join('tests', 'scripts', 'codeComments.test.ts');
  const owner = join('scripts', 'codeComments.mjs');
  const pattern = /\.startsWith\(\s*(['"])(\/\/|\/\*|\*)\1\s*\)/;
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

describe('コメントの判定', () => {
  it('`scripts/codeComments.mjs` の外に写しが無い', () => {
    expect(copiesOfCommentJudgement(), 'commentParts を通さずにコメントを見分けている').toEqual([]);
  });
});
