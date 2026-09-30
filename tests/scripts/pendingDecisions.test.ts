import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  countPendingDecisions,
  DECISIONS_THRESHOLD,
} from '../../.github/extensions/session-bootstrap/pendingDecisions.mjs';
import { runScript } from '../support/runScript';

/**
 * 未処理の判断の履歴を、Claude Code 側（`.claude/hooks/inject-policies.sh`）と Copilot CLI 側
 * （`.github/extensions/session-bootstrap/pendingDecisions.mjs`）が同じに数えることの検査。
 *
 * 実装が2つ要るのは、読み込む側がそれぞれ別の言語でしか呼べないため。**同じ置き場を両方に数えさせて
 * 突き合わせる**——片方だけに書いた検査は、もう片方が黙って違う数を出しても緑のまま。
 */

const HOOK = resolve(__dirname, '../../.claude/hooks/inject-policies.sh');

/** 置き場に足す、数えるかどうかが分かれうるもの。 */
const EDGES: Record<string, (decisions: string, outside: string) => void> = {
  何も足さない: () => {},
  名前がドットで始まる履歴: (dir) => writeFileSync(join(dir, '.2026-09-05-hidden.md'), '> 発言。\n'),
  シンボリックリンク: (dir, outside) => {
    writeFileSync(join(outside, 'target.md'), '> 発言。\n');
    symlinkSync(join(outside, 'target.md'), join(dir, '2026-09-05-link.md'));
  },
  名前が_md_で終わるディレクトリ: (dir) => mkdirSync(join(dir, '2026-09-05-dir.md')),
  md_でないファイル: (dir) => writeFileSync(join(dir, 'README.txt'), 'x\n'),
  棚卸し済みの履歴: (dir) => {
    mkdirSync(join(dir, 'archive'));
    writeFileSync(join(dir, 'archive', '2026-09-05-done.md'), '> 発言。\n');
  },
};

interface Counted {
  /** Copilot CLI 側の件数。 */
  readonly extension: number;
  /** Claude Code 側が告げた件数。しきい値に届かず告げなかったなら `null`。 */
  readonly hook: number | null;
}

async function countBoth(
  regular: number,
  edge: (decisions: string, outside: string) => void,
): Promise<Counted> {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-pending-decisions-'));
  try {
    const decisions = join(work, 'agent-ops', 'decisions');
    mkdirSync(decisions, { recursive: true });
    // フックは入れるものが無いと何も出さないので、件数を告げない側でも JSON を受けるために置く。
    writeFileSync(join(work, 'agent-ops', 'policies.md'), '## 場面\n');
    for (let index = 0; index < regular; index += 1) {
      writeFileSync(join(decisions, `2026-09-05-item-${index}.md`), '> 発言。\n');
    }
    const outside = join(work, 'outside');
    mkdirSync(outside);
    edge(decisions, outside);

    const parsed: unknown = JSON.parse(
      runScript(HOOK, [], { env: { ...process.env, CLAUDE_PROJECT_DIR: work } }),
    );
    const context =
      (parsed as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput
        ?.additionalContext ?? '';
    const told = /棚卸ししていない判断の履歴が (\d+) 件/.exec(context);

    return { extension: await countPendingDecisions(work), hook: told ? Number(told[1]) : null };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe('未処理の判断の履歴の数え方', () => {
  // しきい値ちょうどの履歴に1つ足すので、どちらかが数えればフックは必ず件数を告げる。
  // シンボリックリンクは Windows では権限が無いと作れないので、その場だけ外す（CI は Linux で必ず通る）。
  it.each(Object.keys(EDGES))('%s: 両方が同じ件数を出す', async (name) => {
    if (name === 'シンボリックリンク' && process.platform === 'win32') return;
    const counted = await countBoth(DECISIONS_THRESHOLD, EDGES[name]);

    expect(counted.hook).toBe(counted.extension);
  });

  it('しきい値が同じ', async () => {
    const below = await countBoth(DECISIONS_THRESHOLD - 1, EDGES['何も足さない']);
    const reached = await countBoth(DECISIONS_THRESHOLD, EDGES['何も足さない']);

    expect(below).toEqual({ extension: DECISIONS_THRESHOLD - 1, hook: null });
    expect(reached).toEqual({ extension: DECISIONS_THRESHOLD, hook: DECISIONS_THRESHOLD });
  });
});
