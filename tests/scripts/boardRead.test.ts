import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readBoard } from '../../scripts/agent/board-read.mjs';

/**
 * `scripts/agent/board-read.mjs` の検査。
 *
 * 盤面を組み立てる手のうち、**GitHub と CCR の外を見る1つ**——判断の履歴の数え方——だけをここで見る。
 * `gh` と一覧から作る分は `boardRound.test.ts` が通し、手を決める分は `boardMove.test.ts` が持つ。
 *
 * **数え方だけは、差し替えの口を通さずに実物を通す。** あちらは `pendingDecisions` を渡して数を
 * 決めてしまうので、**既定の経路（`archive/` を除く・`.md` だけ数える）は誰も通らない。**
 */

const ROOT = resolve(__dirname, '../..');
const DECISIONS = join(ROOT, '.claude', 'decisions');

/** 盤面のうち、履歴の数え方に関わらない部分。引けたことにして先へ通す。 */
const EMPTY_GH = (args: readonly string[]): string | undefined =>
  args[0] === 'api' && args[1] === 'graphql' ? '{"data":{}}' : '[]';

function pendingDecisions(): unknown {
  return readBoard({
    gh: EMPTY_GH,
    sessions: () => [],
    log: () => {},
    now: new Date('2026-09-06T00:00:00Z'),
    settleMinutes: 10,
    taken: {},
  })?.pendingDecisions;
}

describe('board-read.mjs', () => {
  const direct = readdirSync(DECISIONS, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith('.md'),
  );
  const archived = readdirSync(join(DECISIONS, 'archive')).filter((name) => name.endsWith('.md'));

  // 除く対象が実在しないと、下の検査は「除けている」と「そもそも無い」を区別できない。
  it('棚卸しを通った履歴が実際に置いてある', () => {
    expect(archived.length).toBeGreaterThan(0);
  });

  it('数えるのは、archive に入っていない履歴だけ', () => {
    expect(pendingDecisions()).toBe(direct.length);
  });

  // `archive` はディレクトリなので `.md` で終わらず、名前での絞りだけでも落ちる。**数え方を
  // `withFileTypes` から名前へ変えても気づけない**ので、入れ子の中身を数えていないことを別に見る。
  it('archive の中の件数を足していない', () => {
    expect(pendingDecisions()).toBeLessThan(direct.length + archived.length);
  });
});
