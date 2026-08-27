// gitの追跡ファイルの行数を拡張子別に集計する。
//
// 対象を `git ls-files` から取るので、node_modules/ や dist/ などgitignore対象は自動で外れる。
// バイナリは除外する。`wc -l` は改行バイト(0x0A)の個数を数えるだけなので、PNGのような
// 圧縮データを含めると「サイズ÷256」程度の無意味な行数が積み上がってしまう。
//
// 使い方:
//   node scripts/countLines.mjs             全追跡ファイル
//   node scripts/countLines.mjs 'src/**'    pathspecで絞り込み（git ls-filesにそのまま渡す）

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// gitがバイナリ判定に使う先頭8000バイトの範囲にNULがあればバイナリとみなす。
const BINARY_SNIFF_BYTES = 8000;
const NO_EXTENSION = '(拡張子なし)';

function listTrackedFiles(pathspecs) {
  const stdout = execFileSync('git', ['ls-files', '-z', '--', ...pathspecs], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.split('\0').filter((entry) => entry !== '');
}

function isBinary(contents) {
  return contents.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

function countLines(contents) {
  const lines = contents.toString('utf8').split('\n');
  // 末尾が改行で終わるファイルではsplitの最後の要素が空文字になる。これは行ではないので落とす。
  // 逆に末尾に改行がないファイルでは最後の要素が残り、`wc -l` と違って最終行を数えられる。
  if (lines.at(-1) === '') lines.pop();

  return { total: lines.length, blank: lines.filter((line) => line.trim() === '').length };
}

function formatTable(rows) {
  const headers = ['拡張子', 'ファイル', '総行数', '空行', '実質行数'];
  const cells = [headers, ...rows];
  // 全角文字は半角2つ分の幅で表示されるため、桁合わせでもそのように数える。
  const displayWidth = (text) => [...text].reduce((w, c) => w + (c.charCodeAt(0) < 0x100 ? 1 : 2), 0);
  const widths = headers.map((_, column) => Math.max(...cells.map((row) => displayWidth(row[column]))));
  const pad = (text, column) =>
    column === 0
      ? text + ' '.repeat(widths[column] - displayWidth(text))
      : ' '.repeat(widths[column] - displayWidth(text)) + text;

  const lines = cells.map((row) => row.map(pad).join('  '));
  lines.splice(1, 0, widths.map((width) => '-'.repeat(width)).join('  '));
  return lines.join('\n');
}

const files = listTrackedFiles(process.argv.slice(2));
if (files.length === 0) {
  console.error('対象のファイルがありません。pathspecを確認してください。');
  process.exit(1);
}

/** 拡張子 -> 集計。 */
const stats = new Map();
let binaryFiles = 0;

for (const file of files) {
  const contents = readFileSync(file);
  if (isBinary(contents)) {
    binaryFiles += 1;
    continue;
  }

  const extension = path.extname(file) || NO_EXTENSION;
  const stat = stats.get(extension) ?? { files: 0, total: 0, blank: 0 };
  const { total, blank } = countLines(contents);
  stats.set(extension, { files: stat.files + 1, total: stat.total + total, blank: stat.blank + blank });
}

const sorted = [...stats].sort(([, a], [, b]) => b.total - a.total);
const sum = sorted.reduce(
  (acc, [, stat]) => ({
    files: acc.files + stat.files,
    total: acc.total + stat.total,
    blank: acc.blank + stat.blank,
  }),
  { files: 0, total: 0, blank: 0 },
);

const toRow = (label, stat) =>
  [label, stat.files, stat.total, stat.blank, stat.total - stat.blank].map(String);

console.log(formatTable([...sorted.map(([ext, stat]) => toRow(ext, stat)), toRow('合計', sum)]));
if (binaryFiles > 0) {
  console.log(`\nバイナリ ${binaryFiles} ファイルを除外しました。`);
}
