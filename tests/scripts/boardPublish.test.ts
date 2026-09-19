import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { publish } from '../../scripts/daemon/board-publish.mjs';

/**
 * `scripts/daemon/board-publish.mjs` の検査。
 *
 * ここが持つのは**届け先**だけ（並べる形は `board.mjs`、周期は `daemon.sh`）。守るのは2つ——
 * 組んだ本文がそのまま issue の本文になること、**引けなかった周は書き込まないこと**
 * （`agent-ops/board-design.md` 2.20.2）。欠けた盤面で上書きすると、在るはずのものが消えた盤面が残る。
 */

interface Call {
  readonly args: readonly string[];
  /** `--body-file` で渡されたファイルの中身（呼び出しの中でしか読めない）。 */
  readonly body: string;
}

/** 盤面を引けていない区間（`board-state.mjs` の `readUnreadable`）。 */
interface Unreadable {
  since: string;
  until: string;
  rounds: number;
  reason: string;
}

interface Given {
  unreadable?: Unreadable;
  patrol?: { at: string; verdict: string; summary: string };
  blockedNotes?: readonly { text: string; since: string }[];
  partialNotes?: readonly string[];
  events?: readonly Record<string, unknown>[];
}

async function run(
  over: {
    body?: (given: Given) => string | undefined;
    ghFails?: boolean;
  } & Given = {},
): Promise<{
  ok: boolean;
  calls: Call[];
}> {
  const calls: Call[] = [];
  const ok = await publish({
    gh: (args: readonly string[]) => {
      const at = args.indexOf('--body-file');
      calls.push({ args, body: at < 0 ? '' : readFileSync(args[at + 1] ?? '', 'utf-8') });
      return over.ghFails === true ? undefined : '';
    },
    body: over.body ?? (() => '盤面\n'),
    issue: '99',
    warn: () => {},
    unreadable: over.unreadable,
    patrol: over.patrol,
    blockedNotes: over.blockedNotes,
    partialNotes: over.partialNotes,
    events: over.events,
  });
  return { ok, calls };
}

describe('board-publish.mjs', () => {
  it('組んだ本文で、issue の本文を丸ごと書き換える', async () => {
    const { ok, calls } = await run();

    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args.slice(0, 4)).toEqual(['issue', 'edit', '99', '--body-file']);
    expect(calls[0]?.body).toBe('盤面\n');
  });

  // **古いままのほうが、欠けた盤面より正しい。** 読む側は最終更新の時刻で気づける。
  it('盤面を引けなければ、書き込まない', async () => {
    const { ok, calls } = await run({ body: () => undefined });

    expect(ok).toBe(false);
    expect(calls).toEqual([]);
  });

  // **印と記録と帳面を置くのはデーモンの側で、人へ見せるのはここ**（`agent-ops/board-design.md`
  // 2.21・2.20.3）。渡らなければ、盤面が引けていないことも、見回りが途切れたことも、**周の出来事
  // そのものも**誰にも届かない——周と書き出しは別の周期で走る別のプロセスなので、ここが唯一の道。
  it('引けていない印・最後の見回り・周の出来事を、本文を組む側へ渡す', async () => {
    const unreadable = {
      since: '2026-09-11T00:39:08Z',
      until: '2026-09-11T00:44:08Z',
      rounds: 11,
      reason: 'list_sessions: 失敗: HTTP 401',
    };
    const blockedNotes = [{ text: '3件の task が錠待ち', since: '2026-09-11T00:20:00Z' }];
    const partialNotes = ['マージ済みPRを引けなかった'];
    const events = [{ at: '2026-09-11T00:38:00Z', kind: 'move', move: 'MERGE', result: 'played' }];
    let given: Given | undefined;
    await run({
      unreadable,
      patrol: { at: '2026-09-11T00:30:00Z', verdict: '異常なし', summary: '' },
      blockedNotes,
      partialNotes,
      events,
      body: (args) => {
        given = args;
        return '盤面\n';
      },
    });

    expect(given?.unreadable).toEqual(unreadable);
    expect(given?.patrol?.at).toBe('2026-09-11T00:30:00Z');
    expect(given?.blockedNotes).toEqual(blockedNotes);
    expect(given?.partialNotes).toEqual(partialNotes);
    expect(given?.events).toEqual(events);
  });

  it('書き込めなければ、そう答える', async () => {
    const { ok } = await run({ ghFails: true });

    expect(ok).toBe(false);
  });
});
