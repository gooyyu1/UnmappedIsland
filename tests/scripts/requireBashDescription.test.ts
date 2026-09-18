import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { runWithOnlyTheseCommands } from '../support/onlyTheseCommands';

/**
 * `.claude/hooks/require-bash-description.sh` の検査。
 *
 * このフックの仕事は**「見出しとして読めない description を通さない」**ことで、空でないかを見るだけ
 * では足りない——空白だけの `" "` は、実行ログでは空と見分けが付かない。
 *
 * **Bash 呼び出しのたびに走る**ので、ここで起きる外部プロセスは常時の固定費になる。**`jq` 1つだけ**
 * であることも、破れたら落ちる形で見張る（下の「絞った PATH」）。
 */

// 実プロセス（bash と jq）を起こすので、`npm test` 全体を並行実行したときのCPU競合だけで既定の
// 5秒を超えうる。
vi.setConfig({ testTimeout: 20000 });

const HOOK = resolve(__dirname, '../../.claude/hooks/require-bash-description.sh');

/** **`jq` 以外を呼べば `command not found` で落ちる**絞りで走らせる。 */
function run(input: unknown) {
  return runWithOnlyTheseCommands(HOOK, { real: ['jq'], input: JSON.stringify(input) });
}

interface Decision {
  readonly hookEventName?: string;
  readonly permissionDecision?: string;
  readonly permissionDecisionReason?: string;
}

function decisionFor(description: unknown): Decision | undefined {
  const out = run(description === undefined ? {} : { tool_input: { description } });

  expect(out.code, `フックが非0で終わった:\n${out.stderr}`).toBe(0);
  if (out.stdout === '') return undefined;
  const parsed: unknown = JSON.parse(out.stdout);
  return (parsed as { hookSpecificOutput?: Decision }).hookSpecificOutput;
}

describe('require-bash-description.sh', () => {
  it('description が書いてあれば、何も言わずに通す', () => {
    expect(decisionFor('Localizationの公開APIを調べる')).toBeUndefined();
  });

  // 空白だけの description は、実行ログの見出しとしては空と同じ。**ここが通ると、見出しの無い行が
  // 「description は書いた」の顔で残る。**
  it.each([
    ['空文字', ''],
    ['半角空白だけ', '   '],
    ['タブと改行だけ', '\t\n'],
    ['そもそも無い', undefined],
  ])('%s なら拒否する', (_name, description) => {
    const decision = decisionFor(description);

    expect(decision?.hookEventName).toBe('PreToolUse');
    expect(decision?.permissionDecision).toBe('deny');
    // 何を書けばよいかまで渡さないと、受け取った側はコマンドの言い換えを書き足して再実行する。
    expect(decision?.permissionDecisionReason).toContain('何のために何をするか');
  });

  /**
   * **絞った PATH で走らせる。** `jq` 以外の外部コマンドが1つでも生えれば、それは `command not
   * found` になり、`set -e` の下でフックごと非0で終わる——上の検査が揃って赤くなる。ここはそのうえで
   * **`jq` が1回しか起きていない**ことを見る。
   */
  it('起こす外部プロセスは jq 1つだけ', () => {
    const out = run({ tool_input: { description: 'x' } });

    expect(out.code, out.stderr).toBe(0);
    expect(out.calls.map((call) => call.name)).toEqual(['jq']);
  });

  it('拒否する側の経路でも、外部プロセスは増えない', () => {
    const out = run({});

    expect(out.code, out.stderr).toBe(0);
    expect(out.calls.map((call) => call.name)).toEqual(['jq']);
  });
});
