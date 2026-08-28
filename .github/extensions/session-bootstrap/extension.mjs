// Extension: session-bootstrap
//
// Claude Code の .claude/hooks/ を Copilot CLI 向けに移植したもの。いずれも「気づいたら読む／
// 気づいたら整形する／気づいたらやめる」に頼れない（気づきに依存しない形で入れる、というのが
// 元のフックの設計意図）。
//
// - onSessionStart: .claude/policies.md（全文）と docs/concept/DesignPrinciples.md（見出しのみ）を
//   セッション開始時に無条件でコンテキストへ注入する。
// - onPreToolUse: シェルの呼び出しを bash に限り、シェルからのファイル書き換えを拒否する。
// - onPostToolUse: create/edit で書き込んだファイルへ prettier --write を掛ける。

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { joinSession } from '@github/copilot-sdk/extension';

const execAsync = promisify(exec);

async function readIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function buildPoliciesContext(repoDir) {
  let context = '';

  const policies = await readIfExists(path.join(repoDir, '.claude', 'policies.md'));
  if (policies !== null) {
    context +=
      '過去のセッションで記録した、ユーザーの価値観。A・Bどちらもあり得る場面ではこれに従い、訊き直さない。\n\n';
    context += policies;
    context += '\n\n';
  }

  const principles = await readIfExists(path.join(repoDir, 'docs', 'concept', 'DesignPrinciples.md'));
  if (principles !== null) {
    const headings = principles
      .split('\n')
      .filter((line) => line.startsWith('## '))
      .map((line) => '- ' + line.slice(3));
    if (headings.length > 0) {
      context +=
        'ゲーム内容の判断基準（docs/concept/DesignPrinciples.md の結論一覧。' +
        'ゲーム内容に関わる判断をするときは本文も読む）:\n';
      context += headings.join('\n');
      context += '\n';
    }
  }

  return context.length > 0 ? context : undefined;
}

// Windowsのシェルツールは PowerShell だが、**PowerShell は UTF-8 のファイルを ANSI として読む**
// ので、素の Get-Content や Select-String は日本語を壊す。壊れたことは出力を見ても分からず、
// 読めたつもりのまま次の判断へ積まれる。bash（Git Bash）は同じ内容を正しく扱う。
//
// そのため、シェルツールは **bash の起動にだけ使わせる**。npm・git・gh・テストはすべて
// `bash -lc "..."` から通る（実測）。判定は「bash で始まるか」だけなので、キーワードの拾い漏れが
// 起きる形にはなっていない。
const BASH_INVOCATION = /^\s*(&\s*)?"?[^"\s]*\bbash(\.exe)?"?(\s|$)/;

const SHELL_TOOLS = new Set(['powershell', 'bash', 'shell']);

const DENY_NOT_BASH =
  'PowerShell は UTF-8 のファイルを ANSI として読むため、日本語のファイルを黙って壊す。' +
  'シェルは bash 経由でだけ使うこと: bash -lc "..."（npm・git・gh はそのまま通る）。' +
  'パスに空白があるときは bash 側をシングルクォートにする: bash -lc "cd \'/c/...\' && ..."';

await joinSession({
  hooks: {
    onSessionStart: async (input) => {
      const context = await buildPoliciesContext(input.workingDirectory);
      return context ? { additionalContext: context } : undefined;
    },
    onPreToolUse: async (input) => {
      if (!SHELL_TOOLS.has(input.toolName)) return;

      const args = typeof input.toolArgs === 'string' ? JSON.parse(input.toolArgs) : input.toolArgs;
      const command = args?.command;
      if (typeof command !== 'string' || command.trim() === '') return;

      if (!BASH_INVOCATION.test(command)) {
        return { permissionDecision: 'deny', permissionDecisionReason: DENY_NOT_BASH };
      }
    },
    onPostToolUse: async (input) => {
      if (input.toolName !== 'create' && input.toolName !== 'edit') return;

      const args = typeof input.toolArgs === 'string' ? JSON.parse(input.toolArgs) : input.toolArgs;
      const filePath = args?.path;
      if (!filePath) return;

      const repoDir = input.workingDirectory;
      const relative = path.relative(repoDir, filePath);
      // リポジトリの外（スクラッチパッド等）には触らない。
      if (relative.startsWith('..') || path.isAbsolute(relative)) return;

      try {
        await execAsync(`npx --no-install prettier --write --ignore-unknown "${filePath}"`, { cwd: repoDir });
      } catch {
        // prettierが扱えない拡張子・.prettierignore対象などは黙って飛ばす。
      }
    },
  },
});
