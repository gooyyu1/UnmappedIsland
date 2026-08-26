#!/usr/bin/env node
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

/** 節とみなす見出しの深さ。`#`は文書題名、`####`以下は節の内訳。 */
const SECTION_DEPTHS = [2, 3];

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
    if (!inFence && match !== null && SECTION_DEPTHS.includes(match[1].length)) {
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

  console.log('# ドキュメントの確定度と実装状況\n');
  console.log(
    `全 ${documents.length} 文書 / ${total.lines} 行 / ${total.sections} 節。` +
      `**確定 ${total.confirmed} 節**、未実装 ${total.unimplemented} 節。` +
      '印の無い節は暫定（docs/DocumentStyle.md 6節）。\n',
  );
  console.log('| 文書 | 節 | 確定 | 未実装 | 未決事項節 | 行 |');
  console.log('| --- | --: | --: | --: | :-: | --: |');
  for (const doc of documents) {
    console.log(
      `| ${doc.path} | ${doc.sections} | ${doc.confirmed} | ${doc.unimplemented} | ` +
        `${doc.hasOpenQuestions ? 'あり' : ''} | ${doc.lines} |`,
    );
  }
}

// 数える部分だけを試験から読み込めるように、表を出すのは直接実行したときだけにする。
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  printDocuments();
