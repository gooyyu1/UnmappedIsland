import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { publish } from '../../scripts/agent/board-publish.mjs';

/**
 * `scripts/agent/board-publish.mjs` の検査。
 *
 * ここが持つのは**届け先**だけ（並べる形は `board.mjs`、周期は `daemon.sh`）。守るのは2つ——
 * 組んだ本文がそのまま issue の本文になること、**引けなかった周は書き込まないこと**
 * （`.claude/board-design.md` 2.20.2）。欠けた盤面で上書きすると、在るはずのものが消えた盤面が残る。
 */

interface Call {
  readonly args: readonly string[];
  /** `--body-file` で渡されたファイルの中身（呼び出しの中でしか読めない）。 */
  readonly body: string;
}

function run(
  over: {
    body?: (given: {
      unreadableSince?: string;
      patrol?: { at: string; verdict: string; summary: string };
    }) => string | undefined;
    ghFails?: boolean;
    unreadableSince?: string;
    patrol?: { at: string; verdict: string; summary: string };
  } = {},
): {
  ok: boolean;
  calls: Call[];
} {
  const calls: Call[] = [];
  const ok = publish({
    gh: (args: readonly string[]) => {
      const at = args.indexOf('--body-file');
      calls.push({ args, body: at < 0 ? '' : readFileSync(args[at + 1] ?? '', 'utf-8') });
      return over.ghFails === true ? undefined : '';
    },
    body: over.body ?? (() => '盤面\n'),
    issue: '99',
    warn: () => {},
    unreadableSince: over.unreadableSince,
    patrol: over.patrol,
  });
  return { ok, calls };
}

describe('board-publish.mjs', () => {
  it('組んだ本文で、issue の本文を丸ごと書き換える', () => {
    const { ok, calls } = run();

    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args.slice(0, 4)).toEqual(['issue', 'edit', '99', '--body-file']);
    expect(calls[0]?.body).toBe('盤面\n');
  });

  // **古いままのほうが、欠けた盤面より正しい。** 読む側は最終更新の時刻で気づける。
  it('盤面を引けなければ、書き込まない', () => {
    const { ok, calls } = run({ body: () => undefined });

    expect(ok).toBe(false);
    expect(calls).toEqual([]);
  });

  // **印と記録を置くのはデーモンの側で、人へ見せるのはここ**（`.claude/board-design.md` 2.21）。
  // 渡らなければ、盤面が引けていないことも、見回りが途切れたことも誰にも届かない。
  it('引けていない印と、最後の見回りを、本文を組む側へ渡す', () => {
    const given: { unreadableSince?: string; patrolAt?: string } = {};
    run({
      unreadableSince: '2026-09-11T00:39:08Z',
      patrol: { at: '2026-09-11T00:30:00Z', verdict: '異常なし', summary: '' },
      body: (args) => {
        given.unreadableSince = args.unreadableSince;
        given.patrolAt = args.patrol?.at;
        return '盤面\n';
      },
    });

    expect(given).toEqual({
      unreadableSince: '2026-09-11T00:39:08Z',
      patrolAt: '2026-09-11T00:30:00Z',
    });
  });

  it('書き込めなければ、そう答える', () => {
    const { ok } = run({ ghFails: true });

    expect(ok).toBe(false);
  });
});
