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

/** 棚卸しを促し始める未処理の件数（フックの `DECISIONS_THRESHOLD`）。 */
const THRESHOLD = 10;

interface World {
  /** `.claude/policies.md` の中身。`undefined` は「ファイルが無い」。 */
  readonly policies?: string;
  /** `docs/concept/DesignPrinciples.md` の中身。`undefined` は「ファイルが無い」。 */
  readonly principles?: string;
  /** `.claude/decisions/` に置く未処理の履歴の件数。 */
  readonly decisions?: number;
  /** `.claude/decisions/archive/` に置く棚卸し済みの履歴の件数。 */
  readonly archived?: number;
}

function writeDecisions(dir: string, count: number): void {
  mkdirSync(dir, { recursive: true });
  for (let index = 0; index < count; index += 1) {
    writeFileSync(join(dir, `2026-09-05-item-${index}.md`), '> 発言。\n', 'utf-8');
  }
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
    if (world.decisions !== undefined) {
      writeDecisions(join(work, '.claude', 'decisions'), world.decisions);
    }
    if (world.archived !== undefined) {
      writeDecisions(join(work, '.claude', 'decisions', 'archive'), world.archived);
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

  it('どれも無ければ何も出さない', () => {
    expect(run({})).toBe('');
  });

  // 履歴そのものは入れない。入れると全セッションが、溜まった分を毎回払う。
  it('判断の履歴は中身を入れず、しきい値に届くまでは触れもしない', () => {
    const context = contextOf({ policies: '## 場面', decisions: THRESHOLD - 1 });

    expect(context).not.toContain('発言。');
    expect(context).not.toContain('棚卸し');
  });

  it('未処理がしきい値に達したら件数だけ入れる', () => {
    const context = contextOf({ policies: '## 場面', decisions: THRESHOLD });

    expect(context).toContain(`${THRESHOLD} 件`);
    expect(context).not.toContain('発言。');
  });

  it('棚卸し済みの履歴は数えない', () => {
    const context = contextOf({ policies: '## 場面', decisions: 1, archived: THRESHOLD });

    expect(context).not.toContain('棚卸ししていない');
  });
});
