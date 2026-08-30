import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { statusOfMarkdown } from '../../scripts/docStatus.mjs';

/**
 * `npm run stats:docs`（`scripts/docStatus.mjs`）が数え落としていないかの検査。
 *
 * この表は「14,000行を通しで読む代わりに、どこへ注意を向けるかを選ぶ」道具（`docs/README.md`）
 * なので、**全部0になっても、印が1つ落ちても、表の形は保たれ、壊れたことが表から読み取れない**。
 * CRLFの作業ツリーで見出しが1つも拾えなくなっていたのが前者（issue #867）、深さ4の見出しに付いた
 * `【確定】` が落ちていたのが後者（issue #869）。
 *
 * 見るのは**数え方の当たり外れではなく、空になっていないことと、印が落ちていないこと**。値の
 * 妥当性は見ない——重ねて見ると、赤くなったときにどちらの意味か決まらなくなる。
 */

const ROOT = resolve(__dirname, '../..');

function listMarkdown(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...listMarkdown(rel));
    else if (entry.endsWith('.md')) found.push(rel);
  }
  return found;
}

interface DocumentStatus {
  readonly path: string;
  readonly lines: number;
  readonly sections: number;
  readonly confirmed: number;
  readonly wholeDocumentConfirmed: boolean;
  readonly unimplemented: number;
}

/** `npm run stats:docs` と同じ経路で数えたもの。 */
const REPORTED = JSON.parse(
  execFileSync('node', [join(ROOT, 'scripts/docStatus.mjs'), '--json'], {
    cwd: ROOT,
    encoding: 'utf-8',
  }),
) as DocumentStatus[];

function sumOf(key: 'sections' | 'confirmed' | 'unimplemented'): number {
  return REPORTED.reduce((sum, doc) => sum + doc[key], 0);
}

/**
 * その印の付いた見出し行。**`docStatus.mjs` の数え方は使わない**——同じ関数で数えると、両方が
 * 同じように落ちたときに気づけない。
 *
 * 見出しかどうかは行頭の`#`だけで決める。コードフェンスを追わないのは、`docs/`のフェンスに現れる
 * `#`がYAMLのコメント（深さ1）で、節の深さ（2以上）と重ならないため。
 */
function headingLinesWith(mark: string): string[] {
  const found: string[] = [];
  for (const rel of listMarkdown('docs')) {
    readFileSync(join(ROOT, rel), 'utf-8')
      .split(/\r?\n/)
      .forEach((line, index) => {
        if (/^#{2,6}\s/.test(line) && line.includes(mark)) found.push(`${rel}:${index + 1} ${line}`);
      });
  }
  return found;
}

describe('docs/ の確定度と実装状況の表', () => {
  it('節と【確定】を数えられている', () => {
    expect(REPORTED.length, '文書が1つも見つかっていない').toBeGreaterThan(0);
    expect(sumOf('sections'), '節が1つも拾えていない').toBeGreaterThan(0);
    expect(sumOf('confirmed'), '【確定】が1つも拾えていない').toBeGreaterThan(0);
  });

  it('見出しに付いた印を、1つも数え落としていない', () => {
    // 落ちた印は、印の無い節と見分けが付かない（`【確定】`は「覆すには人間の判断が要る」という
    // 変更権限の宣言なので、表から消えると誰でも覆せることになる）。
    for (const [mark, key] of [
      ['【確定】', 'confirmed'],
      ['【未実装', 'unimplemented'],
    ] as const) {
      const inHeadings = headingLinesWith(mark);
      expect(sumOf(key), `${mark} の付いた見出し:\n${inHeadings.join('\n')}`).toBe(
        inHeadings.length,
      );
    }
  });

  it('文書まるごとの確定宣言を、数え落としていない（DocumentStyle.md 6.2節）', () => {
    // 落ちると、その文書は確定欄が0の暫定な文書として並ぶ——表の上では、印を1つも持たない
    // 文書と見分けが付かない。**`docStatus.mjs` の判定は呼ばない**（上の見出しと同じ理由）ので、
    // フェンスの外を採る形だけを変えて書く——あちらは行を1本ずつ状態機械で追い、こちらは
    // フェンスの行で割って偶数番の断片を採る。
    const declaring = listMarkdown('docs')
      .filter((rel) =>
        readFileSync(join(ROOT, rel), 'utf-8')
          .replace(/\r\n/g, '\n')
          .split(/^\s*```.*$/m)
          .filter((_, index) => index % 2 === 0)
          .some((outsideFence) =>
            outsideFence.split('\n').some((line) => line.startsWith('**本書は全体が確定です。**')),
          ),
      )
      .map((rel) => rel.split(/[\\/]/).join('/'))
      .sort();
    expect(declaring.length, '宣言のある文書が1つも無い').toBeGreaterThan(0);
    expect(
      REPORTED.filter((doc) => doc.wholeDocumentConfirmed)
        .map((doc) => doc.path)
        .sort(),
    ).toEqual(declaring);
  });

  it('同じ本文をLFとCRLFで数えて、同じ数になる', () => {
    // 作業ツリーの改行は取り出し方（gitの`core.autocrlf`）で変わるので、CRLFで数が変わると
    // **CIだけが緑のまま**になる。
    const differing: string[] = [];
    for (const rel of listMarkdown('docs')) {
      const lf = readFileSync(join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
      const crlf = lf.replace(/\n/g, '\r\n');
      const counted = statusOfMarkdown(lf);
      const countedAsCrlf = statusOfMarkdown(crlf);
      if (JSON.stringify(counted) !== JSON.stringify(countedAsCrlf)) {
        differing.push(
          `${rel}: LF ${JSON.stringify(counted)} / CRLF ${JSON.stringify(countedAsCrlf)}`,
        );
      }
    }
    expect(differing, `改行の形で数が変わる文書:\n${differing.join('\n')}`).toEqual([]);
  });
});
