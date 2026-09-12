import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runScript } from '../support/runScript';

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
  /** `agent-ops/policies.md` の中身。`undefined` は「ファイルが無い」。 */
  readonly policies?: string;
  /** `docs/concept/DesignPrinciples.md` の中身。`undefined` は「ファイルが無い」。 */
  readonly principles?: string;
  /** `agent-ops/decisions/` に置く未処理の履歴の件数。 */
  readonly decisions?: number;
  /** `agent-ops/decisions/archive/` に置く棚卸し済みの履歴の件数。 */
  readonly archived?: number;
  /** `agent-ops/decisions/` の直下に置く、名前がドットで始まる履歴の件数。 */
  readonly hidden?: number;
}

function writeDecisions(dir: string, count: number, prefix = '2026-09-05-item-'): void {
  mkdirSync(dir, { recursive: true });
  for (let index = 0; index < count; index += 1) {
    writeFileSync(join(dir, `${prefix}${index}.md`), '> 発言。\n', 'utf-8');
  }
}

function run(world: World): string {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-inject-policies-'));
  try {
    if (world.policies !== undefined) {
      mkdirSync(join(work, 'agent-ops'), { recursive: true });
      writeFileSync(join(work, 'agent-ops', 'policies.md'), world.policies, 'utf-8');
    }
    if (world.principles !== undefined) {
      mkdirSync(join(work, 'docs', 'concept'), { recursive: true });
      writeFileSync(join(work, 'docs', 'concept', 'DesignPrinciples.md'), world.principles, 'utf-8');
    }
    if (world.decisions !== undefined) {
      writeDecisions(join(work, 'agent-ops', 'decisions'), world.decisions);
    }
    if (world.archived !== undefined) {
      writeDecisions(join(work, 'agent-ops', 'decisions', 'archive'), world.archived);
    }
    if (world.hidden !== undefined) {
      writeDecisions(join(work, 'agent-ops', 'decisions'), world.hidden, '.2026-09-05-hidden-');
    }

    return runScript(HOOK, [], {
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

  // 名前がドットで始まっていても履歴。**グロブは既定でそれを拾わない**ので、数え方を変えると
  // 件数だけが静かに減り、棚卸しの促しが出ないまま溜まり続ける。
  it('名前がドットで始まる履歴も数える', () => {
    const context = contextOf({ policies: '## 場面', decisions: THRESHOLD - 1, hidden: 1 });

    expect(context).toContain(`${THRESHOLD} 件`);
  });

  it('棚卸し済みの履歴は数えない', () => {
    const context = contextOf({ policies: '## 場面', decisions: 1, archived: THRESHOLD });

    expect(context).not.toContain('棚卸ししていない');
  });
});
