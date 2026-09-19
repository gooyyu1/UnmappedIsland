import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 環境を見て飛ぶ試験の見張り。
 *
 * 条件付きのスイート（vitestの `runIf`・`skipIf`）は、条件が偽のとき丸ごと飛ぶ。**飛んだことは緑と
 * 区別が付かない**ので、走る環境をどこにも持たないまま置かれた検査が、誰にも気づかれずに残る
 * （CLAUDE.md「置いた主張は、破れたときに落ちるものと対で置く」の「必ず走る」）。気候の設定値の
 * 検査が実際にその形で、`npm test` にも CI にも一度も入っていなかった（issue #2124）。
 *
 * そこで、**飛べるのは下の一覧に在るものだけ**にする。足すときは、飛んだぶんをどこが拾うかを
 * ここへ書くことになる。
 */

const ROOT = resolve(__dirname, '../..');

/**
 * 条件付きのスイートの呼び出し。**この綴りがこのファイル自身に現れない書き方**にしてあるので、
 * 自分を除く必要が無い（除くと、除き方の誤りが「飛ぶ試験が1つも無い」と同じ緑になる）。
 */
const GATE = /\.(?:run|skip)If\(/;

/** 飛んでよい試験と、飛んだぶんをどこが拾うか。 */
const GATED: Record<string, string> = {
  'tests/support/generatedReport.ts':
    'レポートの再生成。飛んだぶんは `main` への push で regenerate-stats.yml が丸ごと作り直して拾う' +
    '（docs/diagnostics/README.md「再生成し忘れると赤くなる」）',
  'tests/scripts/historyStats.test.ts':
    '浅いクローンかどうかで見るものが変わる。飛ぶ側と飛ばない側が対になっているので、' +
    'どちらの環境でも一方が必ず走る',
  'tests/scripts/usageTimeline.test.ts':
    'Pythonの有無。CIでは在ることを要求する（無ければ読み込みの時点で落ちる）ので、飛ぶのは手元だけ',
};

/** そのディレクトリ以下の.tsファイル（リポジトリ相対）。 */
function filesIn(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...filesIn(rel));
    else if (entry.endsWith('.ts')) found.push(rel);
  }
  return found;
}

describe('環境を見て飛ぶ試験', () => {
  it('飛べるのは、飛んだぶんの拾い先が書いてあるものだけ', () => {
    const gated = filesIn('tests').filter((rel) => GATE.test(readFileSync(join(ROOT, rel), 'utf-8')));

    // 一覧から落ちたものも挙げる——飛ばさなくなった試験が一覧に残ると、次に足す人が
    // 「ここへ書けば通る」だけを読んで、拾い先の無いものを足す。
    expect(gated.sort()).toEqual(Object.keys(GATED).sort());
  });
});
