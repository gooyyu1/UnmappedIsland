import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnScript } from '../support/runScript';

/**
 * `.claude/hooks/flag-tree-changed-by-subagent.sh` の検査。
 *
 * このフックの仕事は**「子が走っている間に変わった作業ツリーを、親へ告げる」**こと。一時リポジトリで
 * Pre → 子の書き換え → Post を実際に通し、告げる／告げないの両側を見る。
 */

const HOOK = resolve(__dirname, '../../.claude/hooks/flag-tree-changed-by-subagent.sh');

let repo: string;

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

function hook(event: 'PreToolUse' | 'PostToolUse', id = 'toolu_1'): string {
  const out = spawnScript(HOOK, [], {
    input: JSON.stringify({ hook_event_name: event, tool_name: 'Agent', tool_use_id: id, cwd: repo }),
  });
  expect(out.status, `フックが非0で終わった:\n${out.stderr}`).toBe(0);
  return out.stdout;
}

/** Pre と Post の間に `during` を挟み、Post が親へ渡した理由を返す（告げなければ undefined）。 */
function around(during: () => void): string | undefined {
  hook('PreToolUse');
  during();
  const out = hook('PostToolUse');
  if (out === '') return undefined;
  const parsed = JSON.parse(out) as { decision?: string; reason?: string };
  expect(parsed.decision).toBe('block');
  return parsed.reason;
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'subagent-tree-'));
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(repo, 'code.ts'), 'requireKnownKeys(rangeNode);\n');
  writeFileSync(join(repo, 'other.ts'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  // 親が書きかけの変更を抱えたまま子を立てる、がいつもの形。
  writeFileSync(join(repo, 'other.ts'), 'parent edit\n');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('flag-tree-changed-by-subagent.sh', () => {
  it('子が何も書かなければ、何も言わない', () => {
    expect(around(() => undefined)).toBeUndefined();
  });

  it('子が書き換えて戻したなら、何も言わない', () => {
    expect(
      around(() => {
        writeFileSync(join(repo, 'code.ts'), '// requireKnownKeys(rangeNode);\n');
        writeFileSync(join(repo, 'code.ts'), 'requireKnownKeys(rangeNode);\n');
      }),
    ).toBeUndefined();
  });

  // issue #2300 の形: 検査の効きを確かめるために本番コードを1行外し、戻さないまま返った。
  it('子が書き換えたまま返ったら、そのファイルを名指しで告げる', () => {
    const reason = around(() => writeFileSync(join(repo, 'code.ts'), '// requireKnownKeys(rangeNode);\n'));

    expect(reason).toContain('code.ts');
    expect(reason).not.toContain('other.ts');
  });

  // 親が抱えていた変更の上に子が重ねた形。比べるのが「HEADとの差の有無」だと、ここを見逃す。
  it('親が書きかけのファイルを子が書き換えても、告げる', () => {
    expect(around(() => writeFileSync(join(repo, 'other.ts'), 'child edit\n'))).toContain('other.ts');
  });

  it('子が作ったファイル・消したファイルも告げる', () => {
    const reason = around(() => {
      writeFileSync(join(repo, 'probe.ts'), 'x\n');
      unlinkSync(join(repo, 'code.ts'));
    });

    expect(reason).toContain('probe.ts');
    expect(reason).toContain('code.ts');
  });

  it('子がコミットしたら、HEAD が動いたと告げる', () => {
    expect(
      around(() => {
        git('commit', '-q', '-am', 'by child');
      }),
    ).toContain('HEAD');
  });

  // 背景へ回した子や、Pre を通らなかった呼び出しで、別の控えと比べて誤って告げないこと。
  it('控えの無い呼び出しには何も言わない', () => {
    hook('PreToolUse', 'toolu_a');
    writeFileSync(join(repo, 'code.ts'), 'changed\n');
    expect(hook('PostToolUse', 'toolu_b')).toBe('');
  });
});
