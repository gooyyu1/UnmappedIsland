import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * エージェントを動かすものの置き場が、2つに分かれたままであることの検査
 * （`agent-ops/parallel-work.md`「エージェントを選ばない道具は `.claude/` に置かない」）。
 *
 * **分け目は、Claude Code が置き場と名前で拾うかどうか。** 拾うものは動かすと働かなくなるので
 * `.claude/` に残し、どのエージェントが読んでも同じ意味を持つものは `agent-ops/` へ置く。
 * **境界は字面では守られない**——`.claude/` は Claude Code が勝手に作る場所でもあるので、
 * 「ここに置けば読まれる」で足されたものが、そのまま Copilot CLI から見えないまま残る。
 *
 * 見るのは追跡されているファイルだけ。`settings.local.json`・`worktrees/`・`.credentials.json` は
 * 手元にしか無く、リポジトリの取り決めの外。
 */

const ROOT = resolve(__dirname, '../..');

/**
 * `.claude/` 直下に在ってよいもの。**Claude Code が置き場と名前で拾うもの**だけ
 * ——設定と、フック・skill の置き場、メタMCPとCCRの入口。
 */
const CLAUDE_OWNED = [
  'ccr-check-prompt.d.mts',
  'ccr-check-prompt.mjs',
  'ccr-check-prompt.sh',
  'ccr-meta.mjs',
  'ccr-meta.sh',
  'hooks',
  'launch.json',
  'settings.json',
  'skills',
];

function trackedUnder(dir: string): readonly string[] {
  return execFileSync('git', ['ls-files', '-z', dir], { cwd: ROOT, encoding: 'utf-8' })
    .split('\0')
    .filter(Boolean);
}

describe('エージェントを動かすものの置き場', () => {
  it('`.claude/` 直下に在るのは、Claude Code が拾うものだけ', () => {
    const entries = [...new Set(trackedUnder('.claude').map((rel) => rel.split('/')[1]))].sort();

    expect(entries).toEqual(CLAUDE_OWNED);
  });

  it('`agent-ops/` には、実行されるものを置かない', () => {
    const executable = trackedUnder('agent-ops').filter((rel) => !rel.endsWith('.md'));

    expect(executable, '読まれる文書だけを置く。動く道具は `scripts/agent/`').toEqual([]);
  });

  it('取り決めとひな形と記録が、`agent-ops/` に在る', () => {
    // 上の2つは、`agent-ops/` が空でも緑になる。
    const tracked = trackedUnder('agent-ops');

    expect(tracked).toContain('agent-ops/parallel-work.md');
    expect(tracked).toContain('agent-ops/prompts/dispatch-prompt.md');
    expect(tracked.some((rel) => rel.startsWith('agent-ops/decisions/'))).toBe(true);
    expect(tracked.some((rel) => rel.startsWith('agent-ops/analysis/'))).toBe(true);
  });
});
