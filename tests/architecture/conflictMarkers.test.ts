import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trackedFiles } from '../../scripts/docScope.mjs';

/**
 * 解消し損ねたコンフリクトの印の検査。
 *
 * **`git merge` は衝突したファイルを1行ずつ標準出力へ並べる**ので、出力を切って読むと、畳んだ側だけを
 * 見て「解消した」と思い込める。**印が入ったまま `npm run lint` / `npm run typecheck` / `npm test` /
 * `npm run format:check` は4つとも緑になる**（PR #2391 で実際にレビューまで届いた）——どれも印の行を
 * ただの本文として読むので、**Markdownでも、コメントの中でも、誰も止めない。**
 *
 * **見るのは行頭だけ。** 打とうとするコマンドの文字列から印を探すと、引用の中と外を見分けられず
 * **読み出しのコマンドまで拒否する**（`CLAUDE.md`「ファイルの編集は編集ツールで行う」）が、
 * **追跡下のファイルの中身を行頭で見る**この形はその誤検知を取らない——`grep '>>>>>>>'` のような
 * コマンドは、印が行頭に来ない。
 */

const ROOT = resolve(__dirname, '../..');

/**
 * コンフリクトの印（`merge.conflictStyle` の既定 `merge` と、`diff3`・`zdiff3` が足す `|||||||`）。
 *
 * **行頭で、長さちょうどで見る。** `=======` は Markdown の見出しの下線にも使われるが、印のほうは
 * **7文字ちょうどで行が終わる**ので、下線（見出しの幅ぶん伸びる）とは長さで分かれる。
 */
const MARKERS = [/^<<<<<<< /, /^\|\|\|\|\|\|\| /, /^=======$/, /^>>>>>>> /];

/**
 * 中身を行で読む相手。**この検査自身は外す**——印の綴りを持っているので、自分で自分を止める。
 *
 * **拡張子の一覧は持たない**（追跡しているものには絵も zip も在るが、印はテキストにしか入らない）
 * ——読めたものだけを見て、読めなければ飛ばす。
 */
const SELF = join('tests', 'architecture', 'conflictMarkers.test.ts');

function lines(rel: string): string[] | undefined {
  let text: string;
  try {
    text = readFileSync(join(ROOT, rel), 'utf-8');
  } catch {
    return undefined;
  }
  // **中身がテキストでなければ見ない。** 読めてしまう二進のファイルは、置換文字が混ざる。
  if (text.includes('\u0000')) return undefined;
  return text.split(/\r?\n/);
}

describe('コンフリクトの印', () => {
  const targets = trackedFiles(ROOT).filter((rel) => rel !== SELF);

  // 集める側が黙って0件になると、**1つも見ていない状態と、全部が正しい状態が同じ緑**になる。
  it('検査する対象が在る', () => {
    expect(targets).not.toEqual([]);
  });

  it('解消し損ねた印が残っていない', () => {
    const found: string[] = [];
    for (const rel of targets) {
      const read = lines(rel);
      if (read === undefined) continue;
      read.forEach((line, at) => {
        if (MARKERS.some((marker) => marker.test(line))) found.push(`${rel}:${at + 1}: ${line}`);
      });
    }

    expect(
      found,
      `コンフリクトの印が残っている（取り込みの解消が途中で止まっている）:\n${found.join('\n')}`,
    ).toEqual([]);
  });
});
