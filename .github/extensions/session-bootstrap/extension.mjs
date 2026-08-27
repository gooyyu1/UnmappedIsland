// Extension: session-bootstrap
//
// Claude Code の .claude/hooks/inject-policies.sh と .claude/hooks/format-after-edit.sh を
// Copilot CLI 向けに移植したもの。この2つは「気づいたら読む／気づいたら整形する」に頼れない
// （気づきに依存しない形で入れる、というのが元のフックの設計意図）。
//
// - onSessionStart: .claude/policies.md（全文）と docs/concept/DesignPrinciples.md（見出しのみ）を
//   セッション開始時に無条件でコンテキストへ注入する。
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

await joinSession({
  hooks: {
    onSessionStart: async (input) => {
      const context = await buildPoliciesContext(input.workingDirectory);
      return context ? { additionalContext: context } : undefined;
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
