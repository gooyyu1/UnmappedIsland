import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runWithOnlyTheseCommands } from '../support/onlyTheseCommands';

/**
 * `.claude/hooks/deny-ask-user-question.sh` の検査。
 *
 * 選択肢UIは同じ問いを繰り返して会話が進まなくなるので使わない（`CLAUDE.md`「訊きたいことは普通の
 * チャットで訊く」）。**拒否の理由に代わりの訊き方まで書いてあるか**を見る——理由が「使うな」だけ
 * だと、受け取った側は訊くこと自体をやめる。
 */

const HOOK = resolve(__dirname, '../../.claude/hooks/deny-ask-user-question.sh');

/** **外部コマンドを1つも許さない**絞りで走らせる。 */
function run() {
  return runWithOnlyTheseCommands(HOOK, { input: '{}' });
}

describe('deny-ask-user-question.sh', () => {
  it('拒否して、代わりの訊き方を理由に書く', () => {
    const out = run();

    expect(out.code, `フックが非0で終わった:\n${out.stderr}`).toBe(0);
    const parsed: unknown = JSON.parse(out.stdout);
    const decision = (
      parsed as {
        hookSpecificOutput?: {
          hookEventName?: string;
          permissionDecision?: string;
          permissionDecisionReason?: string;
        };
      }
    ).hookSpecificOutput;

    expect(decision?.hookEventName).toBe('PreToolUse');
    expect(decision?.permissionDecision).toBe('deny');
    expect(decision?.permissionDecisionReason).toContain('チャット');
  });

  /**
   * **絞った PATH で走らせる。** 出すのは定数なので、外部コマンドが1つでも生えれば
   * `command not found` になり、`set -e` の下でフックごと非0で終わる——上の検査が赤くなる。
   */
  it('外部プロセスを1つも起こさない', () => {
    const out = run();

    expect(out.code, out.stderr).toBe(0);
    expect(out.calls).toEqual([]);
  });
});
