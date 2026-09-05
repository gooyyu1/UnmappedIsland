import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * `.claude/hooks/deny-ccr-meta-mcp.sh` が、メタMCPを呼んだところで正しい入口へ案内することの検査。
 *
 * **案内が出るかどうかは、`settings.json` の matcher が `mcp__ccr_meta__*` に当たるかで決まる。**
 * 当たらなければフックは呼ばれず、拒否もされないまま素通りする——そのとき起きるのは「使えなくて
 * 諦める」で、これは何も鳴らずに終わる（`policies.md`「仕組みの作り方」の、塞ぐより案内板にする）。
 */

// 実プロセス（bash）を起こすので、既定の5秒では足りないことがある。
vi.setConfig({ testTimeout: 20000 });

const REPO = resolve(__dirname, '../..');
const HOOK = resolve(REPO, '.claude/hooks/deny-ccr-meta-mcp.sh');

interface Matcher {
  readonly matcher?: string;
  readonly hooks?: readonly { readonly command?: string }[];
}

function preToolUse(): readonly Matcher[] {
  const settings: unknown = JSON.parse(readFileSync(resolve(REPO, '.claude/settings.json'), 'utf-8'));
  return (settings as { hooks?: { PreToolUse?: readonly Matcher[] } }).hooks?.PreToolUse ?? [];
}

describe('deny-ccr-meta-mcp.sh', () => {
  it('拒否して、正しい入口の呼び方を理由に書く', () => {
    const parsed: unknown = JSON.parse(execFileSync('bash', [HOOK], { encoding: 'utf-8' }));
    const output = (
      parsed as {
        hookSpecificOutput?: {
          hookEventName?: string;
          permissionDecision?: string;
          permissionDecisionReason?: string;
        };
      }
    ).hookSpecificOutput;

    expect(output?.hookEventName).toBe('PreToolUse');
    expect(output?.permissionDecision).toBe('deny');
    expect(output?.permissionDecisionReason).toContain('.claude/ccr-meta.sh');
    // 入口を名指しするだけでは、そこから先が分からず結局止まる。呼び方まで渡す。
    expect(output?.permissionDecisionReason).toContain('bash .claude/ccr-meta.sh');
  });

  it('メタMCPの道具名に当たる matcher から呼ばれている', () => {
    const registered = preToolUse().filter((entry) =>
      (entry.hooks ?? []).some((hook) => hook.command?.includes('deny-ccr-meta-mcp.sh') === true),
    );

    expect(registered).not.toHaveLength(0);
    for (const name of ['mcp__ccr_meta__create_session', 'mcp__ccr_meta__list_sessions']) {
      expect(registered.some((entry) => new RegExp(entry.matcher ?? '').test(name))).toBe(true);
    }
  });

  // `settings.json` はフックをパスで直に起動するので、POSIX側（クラウドのセッションはLinux）では
  // 実行ビットが要る。Windowsの作業ツリーでは欠けても動くため、gitのインデックスの側を見る。
  it('実行ビットが立っている', () => {
    const listed = execFileSync('git', ['ls-files', '-s', '.claude/hooks/deny-ccr-meta-mcp.sh'], {
      cwd: REPO,
      encoding: 'utf-8',
    });

    expect(listed.startsWith('100755 ')).toBe(true);
  });
});
