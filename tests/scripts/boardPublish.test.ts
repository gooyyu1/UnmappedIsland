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

function run(over: { body?: () => string | undefined; ghFails?: boolean } = {}): {
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

  it('書き込めなければ、そう答える', () => {
    const { ok } = run({ ghFails: true });

    expect(ok).toBe(false);
  });
});
