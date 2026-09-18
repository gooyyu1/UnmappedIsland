import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { runWithOnlyTheseCommands } from '../support/onlyTheseCommands';

/**
 * `.claude/hooks/record-decisions.sh` の検査。
 *
 * このフックの仕事は**プロンプトのたびに、記録を促す文をセッションへ渡す**こと。**落ちても
 * 気づけない**——促しが1文字も入らないまま会話が進むだけなので、ここが鳴らないことだけが手立て。
 */

// 実プロセス（bash）を起こすので、`npm test` 全体を並行実行したときのCPU競合だけで既定の5秒を
// 超えうる。
vi.setConfig({ testTimeout: 20000 });

const HOOK = resolve(__dirname, '../../.claude/hooks/record-decisions.sh');

/** **外部コマンドを1つも許さない**絞りで走らせる。 */
function run() {
  return runWithOnlyTheseCommands(HOOK, { input: '{}' });
}

function context(): string {
  const out = run();

  expect(out.code, `フックが非0で終わった:\n${out.stderr}`).toBe(0);
  const parsed: unknown = JSON.parse(out.stdout);
  const output = (parsed as { hookSpecificOutput?: { hookEventName?: string; additionalContext?: string } })
    .hookSpecificOutput;
  expect(output?.hookEventName).toBe('UserPromptSubmit');
  return output?.additionalContext ?? '';
}

describe('record-decisions.sh', () => {
  it('記録の置き場と、そこでの書き分けを渡す', () => {
    const text = context();

    expect(text).toContain('agent-ops/decisions/');
    // 置き場だけでは、こちらの読みがユーザーの判断そのものとして書かれる。
    expect(text).toContain('## ユーザーの発言');
    expect(text).toContain('## エージェントの解釈');
  });

  /**
   * **一般則への抽出は促さない。** 1件だけを見て「これは一般則か」は判断できないので、そこは
   * 棚卸しへ遅らせてある（フックの冒頭）。促し始めると、履歴を経ずに `policies.md` が育つ。
   */
  it('畳む先そのものへは書かせない', () => {
    const text = context();

    expect(text).toContain('agent-ops/policies.md');
    expect(text).toContain('へは書かない');
  });

  /**
   * **絞った PATH で走らせる。** 出すのは定数なので、外部コマンドが1つでも生えれば
   * `command not found` になり、`set -e` の下でフックごと非0で終わる——上の検査が揃って赤くなる。
   */
  it('外部プロセスを1つも起こさない', () => {
    const out = run();

    expect(out.code, out.stderr).toBe(0);
    expect(out.calls).toEqual([]);
  });
});
