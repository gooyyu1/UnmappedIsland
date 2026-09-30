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
          pattern.test(line) && !NOT_COMMENT_MARKS.includes(line.trim())
            ? [`${rel.split(sep).join('/')}:${index + 1} ${line.trim()}`]
            : [],
        ),
    );
}

/** 行頭の `#` を見ているが、コメントの判定ではない行（`scripts/declarationInventory.mjs` の私的な名前）。 */
const NOT_COMMENT_MARKS = ["if (modifiers.includes('private') || name.startsWith('#')) return 'private';"];

describe('コメントの判定', () => {
  it('`scripts/codeComments.mjs` の外に写しが無い', () => {
    expect(copiesOfCommentJudgement(), 'commentParts を通さずにコメントを見分けている').toEqual([]);
  });

  it('名指しで外した行が今も在る（消えた行の除外を残さない）', () => {
    const source = readFileSync(join(ROOT, 'scripts', 'declarationInventory.mjs'), 'utf-8');
    const lines = source.split('\n').map((line) => line.trim());
    expect(NOT_COMMENT_MARKS.filter((mark) => !lines.includes(mark))).toEqual([]);
  });
});
