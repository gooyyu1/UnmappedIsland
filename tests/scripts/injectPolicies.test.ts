import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * `.claude/hooks/inject-policies.sh` が、記録済みの価値観をセッションへ流し込めることの検査。
 *
 * **落ちても気づけない**フックなので（理由はフックのコメント）、ここが鳴らないことだけが手立て。
 */

// 実際に bash と jq のプロセスを起こすので、`npm test` 全体を並行実行したときのCPU競合だけで
// 既定の5秒を超えうる。
vi.setConfig({ testTimeout: 20000 });

const HOOK = resolve(__dirname, '../../.claude/hooks/inject-policies.sh');

interface World {
  /** `.claude/policies.md` の中身。`undefined` は「ファイルが無い」。 */
  readonly policies?: string;
  /** `docs/concept/DesignPrinciples.md` の中身。`undefined` は「ファイルが無い」。 */
  readonly principles?: string;
}

function run(world: World): string {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-inject-policies-'));
  try {
    if (world.policies !== undefined) {
      mkdirSync(join(work, '.claude'), { recursive: true });
      writeFileSync(join(work, '.claude', 'policies.md'), world.policies, 'utf-8');
    }
    if (world.principles !== undefined) {
      mkdirSync(join(work, 'docs', 'concept'), { recursive: true });
      writeFileSync(join(work, 'docs', 'concept', 'DesignPrinciples.md'), world.principles, 'utf-8');
    }

    return execFileSync('bash', [HOOK], {
      encoding: 'utf-8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: work },
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function contextOf(world: World): string {
  const parsed: unknown = JSON.parse(run(world));
  const output = (parsed as { hookSpecificOutput?: { hookEventName?: string; additionalContext?: string } })
    .hookSpecificOutput;
  expect(output?.hookEventName).toBe('SessionStart');
  return output?.additionalContext ?? '';
}

describe('inject-policies.sh', () => {
  it('価値観の記録を全文入れる', () => {
    expect(contextOf({ policies: '## 場面\n\n本文。' })).toContain('## 場面\n\n本文。');
  });

  // 上限は Git Bash のほうが Linux よりずっと低い。低いほうに合わせるとCI（Linux）では踏まないので、
  // **Linuxの上限（単一引数で128KB）も越える大きさ**にする。
  it('argvの上限を越える大きさでも落ちない', () => {
    const huge = '## 場面\n\n' + 'あ'.repeat(200_000) + '\n';

    expect(contextOf({ policies: huge })).toContain(huge);
  });

  it('判断基準は見出しだけを入れる', () => {
    const context = contextOf({ principles: '# 題\n\n## 結論A\n\n本文は入れない。\n\n## 結論B\n' });

    expect(context).toContain('- 結論A');
    expect(context).toContain('- 結論B');
    expect(context).not.toContain('本文は入れない');
  });

  it('どちらも無ければ何も出さない', () => {
    expect(run({})).toBe('');
  });
});
