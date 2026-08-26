import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { statusOfMarkdown } from '../../scripts/docStatus.mjs';

/**
 * `npm run stats:docs`（`scripts/docStatus.mjs`）が空を返していないかの検査。
 *
 * この表は「14,000行を通しで読む代わりに、どこへ注意を向けるかを選ぶ」道具（`docs/README.md`）
 * なので、**全部0になっても表の形は保たれ、壊れたことが表から読み取れない**。CRLFの作業ツリーで
 * 見出しが1つも拾えなくなっていたのに気づかれなかったのがこれ（issue #867）。
 *
 * 見るのは**数え方の当たり外れではなく、空になっていないこと**。値の妥当性は見ない——重ねて
 * 見ると、赤くなったときにどちらの意味か決まらなくなる。
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
  readonly unimplemented: number;
}

/** `npm run stats:docs` と同じ経路で数えたもの。 */
const REPORTED = JSON.parse(
  execFileSync('node', [join(ROOT, 'scripts/docStatus.mjs'), '--json'], {
    cwd: ROOT,
    encoding: 'utf-8',
  }),
) as DocumentStatus[];

function sumOf(key: 'sections' | 'confirmed'): number {
  return REPORTED.reduce((sum, doc) => sum + doc[key], 0);
}

describe('docs/ の確定度と実装状況の表', () => {
  it('節と【確定】を数えられている', () => {
    expect(REPORTED.length, '文書が1つも見つかっていない').toBeGreaterThan(0);
    expect(sumOf('sections'), '節が1つも拾えていない').toBeGreaterThan(0);
    expect(sumOf('confirmed'), '【確定】が1つも拾えていない').toBeGreaterThan(0);
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
