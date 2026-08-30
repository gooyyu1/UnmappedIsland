// docs/配下の節を数え、確定度と実装状況の一覧を出す（docs/DocumentStyle.md 4節・6節）。
//
// 確定の印を付けられるのは人間だけなので、**どこへ注意を向けるかを1画面で選べる**ことが要る。
// 14,000行を通しで読む代わりにこの表を読む。Markdownで出すのは、スマホのGitHub上でそのまま
// 読める形にするため。
//
// 数えるのは印の有無だけで、中身の正しさは見ない。【確定】は「覆すには人間の判断が要る」という
// 変更権限の宣言であって、内容が正しいという主張ではない（6節）。
//
// 使い方:
//   node scripts/docStatus.mjs            フォルダ別の表
//   node scripts/docStatus.mjs --json     JSON（他のスクリプトから読む用）

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = 'docs';

/** 節とみなす見出しの最も浅い深さ。`#`は文書題名なので数えない。 */
const SHALLOWEST_SECTION_DEPTH = 2;

/** 文書まるごとが確定であることの宣言（docs/DocumentStyle.md 6.2節）。射程はその文書の全行。 */
export const WHOLE_DOCUMENT_CONFIRMED = '**本書は全体が確定です。**';

/**
 * 文書まるごとの確定を宣言しているか（docs/DocumentStyle.md 6.2節）。
 *
 * 見るのは**コードフェンスの外の行頭**だけ。規約そのものが書式を例示するので、フェンスの中まで
 * 見ると、書式を説明した文書が宣言した文書になる。
 *
 * **判定はここにしか無い。** 表を出す側と 6.2 節の条件を検査する側が別々に判定すると、条件が
 * 食い違ったとき——確定欄は `全` と出るのに条件は掛かっていない、が成立する。
 */
export function declaresWholeDocument(markdown) {
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    else if (!inFence && line.startsWith(WHOLE_DOCUMENT_CONFIRMED)) return true;
  }
  return false;
}

function markdownFilesIn(dir) {
  const found = [];
  for (const entry of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, entry);
    if (statSync(path.join(ROOT, rel)).isDirectory()) found.push(...markdownFilesIn(rel));
    else if (entry.endsWith('.md')) found.push(rel);
  }
  return found;
}

/** コードフェンスの外の見出し行（`#`を除いた本文）。 */
function headingsOf(lines) {
  const headings = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!inFence && match !== null && match[1].length >= SHALLOWEST_SECTION_DEPTH) {
      headings.push(match[2].trim());
    }
  }
  return headings;
}

/**
 * 1つの文書の中身から数えたもの。
 *
 * **改行を割るのはここだけ。** 作業ツリーがCRLFのとき、行末に`\r`が残ると行末を見る判定
 * （見出しの`$`）が一致しなくなる（issue #867）。
 */
export function statusOfMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const headings = headingsOf(lines);
  return {
    lines: lines.length,
    sections: headings.length,
    confirmed: headings.filter((heading) => heading.includes('【確定】')).length,
    wholeDocumentConfirmed: declaresWholeDocument(markdown),
    unimplemented: headings.filter((heading) => heading.includes('【未実装')).length,
    hasOpenQuestions: headings.some((heading) => heading.includes('未決事項')),
  };
}

function statusOf(rel) {
  return {
    path: rel.split(path.sep).join('/'),
    ...statusOfMarkdown(readFileSync(path.join(ROOT, rel), 'utf-8')),
  };
}

function printDocuments() {
  const documents = markdownFilesIn(DOCS)
    .map(statusOf)
    .sort((a, b) => a.path.localeCompare(b.path));

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(documents, null, 2));
    return;
  }

  const total = documents.reduce(
    (sum, doc) => ({
      lines: sum.lines + doc.lines,
      sections: sum.sections + doc.sections,
      confirmed: sum.confirmed + doc.confirmed,
      unimplemented: sum.unimplemented + doc.unimplemented,
    }),
    { lines: 0, sections: 0, confirmed: 0, unimplemented: 0 },
  );

  const wholeDocuments = documents.filter((doc) => doc.wholeDocumentConfirmed).length;

  console.log('# ドキュメントの確定度と実装状況\n');
  console.log(
    `全 ${documents.length} 文書 / ${total.lines} 行 / ${total.sections} 節。` +
      `**確定 ${total.confirmed} 節**、未実装 ${total.unimplemented} 節。` +
      '印の無い節は暫定（docs/DocumentStyle.md 6節）。' +
      `ほかに全体が確定の文書が ${wholeDocuments} 件あり、確定欄を \`全\` と出す（同 6.2節）。\n`,
  );
  console.log('| 文書 | 節 | 確定 | 未実装 | 未決事項節 | 行 |');
  console.log('| --- | --: | --: | --: | :-: | --: |');
  for (const doc of documents) {
    console.log(
      `| ${doc.path} | ${doc.sections} | ${doc.wholeDocumentConfirmed ? '全' : doc.confirmed} | ` +
        `${doc.unimplemented} | ` +
        `${doc.hasOpenQuestions ? 'あり' : ''} | ${doc.lines} |`,
    );
  }
}

// 数える部分だけを試験から読み込めるように、表を出すのは直接実行したときだけにする。
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  printDocuments();
