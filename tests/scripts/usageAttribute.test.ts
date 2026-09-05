import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/agent/usage-attribute.mjs` の検査。
 *
 * ここが守るのは**積んだ値が消費として読めること**。APIはセッション単位の消費を返さないので
 * （`.claude/board-design.md` 2.8）、割り当てを間違えると 2.5 の自動の手綱がしきい値ごと狂う。
 * 負の消費が積まれないこと（枠が変わった周）と、手が空いているセッションが分母に入らないことを見る。
 */

const SCRIPT = resolve(__dirname, '../../scripts/agent/usage-attribute.mjs');

interface Live {
  readonly id: string;
  readonly tags: readonly string[];
  readonly working: boolean;
}

interface State {
  readonly utilization: number;
  readonly resetsAt: string;
  readonly sessions: Record<string, { readonly kind: string; readonly spent: number }>;
}

interface Result {
  readonly state: State;
  readonly finished: string;
}

/** 状態のファイルを引き継ぎながら、割り当てを1回走らせる。 */
function attribute(
  work: string,
  input: { utilization: number; resetsAt: string; now: string; live: readonly Live[] },
): Result {
  const statePath = join(work, 'usage.json');
  const spentPath = join(work, 'spent.tsv');
  execFileSync('node', [SCRIPT, statePath, spentPath], {
    input: JSON.stringify(input),
    encoding: 'utf-8',
  });
  return {
    state: JSON.parse(readFileSync(statePath, 'utf-8')) as State,
    finished: existsSync(spentPath) ? readFileSync(spentPath, 'utf-8') : '',
  };
}

function withWork<T>(body: (work: string) => T): T {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-usage-'));
  try {
    return body(work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const WINDOW = '2026-09-05T05:00:00Z';

describe('usage-attribute.mjs', () => {
  it('初回は基準を置くだけで、消費を積まない', () => {
    withWork((work) => {
      const result = attribute(work, {
        utilization: 30,
        resetsAt: WINDOW,
        now: '2026-09-05T01:00:00Z',
        live: [{ id: 'cse_a', tags: ['task-1'], working: true }],
      });

      expect(result.state.utilization).toBe(30);
      expect(result.state.sessions.cse_a.spent).toBe(0);
    });
  });

  it('増分は、動いていたセッションで等分する', () => {
    withWork((work) => {
      const live = [
        { id: 'cse_a', tags: ['task-1'], working: true },
        { id: 'cse_b', tags: ['review-2'], working: true },
      ];
      attribute(work, { utilization: 10, resetsAt: WINDOW, now: '2026-09-05T01:00:00Z', live });
      const result = attribute(work, {
        utilization: 16,
        resetsAt: WINDOW,
        now: '2026-09-05T01:05:00Z',
        live,
      });

      expect(result.state.sessions.cse_a.spent).toBe(3);
      expect(result.state.sessions.cse_b.spent).toBe(3);
      expect(result.state.sessions.cse_a.kind).toBe('new-task');
      expect(result.state.sessions.cse_b.kind).toBe('review');
    });
  });

  // 畳まれていないセッションには、手が空いて次の指示を待っているものが混ざる（board-design 1.2）。
  it('手が空いているセッションは、分母にも入らず積まれもしない', () => {
    withWork((work) => {
      const live = [
        { id: 'cse_a', tags: ['task-1'], working: true },
        { id: 'cse_b', tags: ['task-2'], working: false },
      ];
      attribute(work, { utilization: 10, resetsAt: WINDOW, now: '2026-09-05T01:00:00Z', live });
      const result = attribute(work, {
        utilization: 16,
        resetsAt: WINDOW,
        now: '2026-09-05T01:05:00Z',
        live,
      });

      expect(result.state.sessions.cse_a.spent).toBe(6);
      expect(result.state.sessions.cse_b.spent).toBe(0);
    });
  });

  // 一覧に載らない手元の Claude Code が食ったぶん。投入したセッションのせいにはしない。
  it('1本も動いていない周の増分は、誰にも積まない', () => {
    withWork((work) => {
      const live = [{ id: 'cse_a', tags: ['task-1'], working: false }];
      attribute(work, { utilization: 10, resetsAt: WINDOW, now: '2026-09-05T01:00:00Z', live });
      const result = attribute(work, {
        utilization: 40,
        resetsAt: WINDOW,
        now: '2026-09-05T01:05:00Z',
        live,
      });

      expect(result.state.sessions.cse_a.spent).toBe(0);
      expect(result.state.utilization).toBe(40);
    });
  });

  it('畳まれて一覧から消えたら、積み上がった値を記録へ出す', () => {
    withWork((work) => {
      const live = [{ id: 'cse_a', tags: ['task-1'], working: true }];
      attribute(work, { utilization: 10, resetsAt: WINDOW, now: '2026-09-05T01:00:00Z', live });
      attribute(work, { utilization: 12, resetsAt: WINDOW, now: '2026-09-05T01:05:00Z', live });
      const result = attribute(work, {
        utilization: 12,
        resetsAt: WINDOW,
        now: '2026-09-05T01:10:00Z',
        live: [],
      });

      expect(result.finished).toBe('2026-09-05T01:10:00Z\tnew-task\t2.0000\tcse_a\n');
      expect(result.state.sessions).toEqual({});
    });
  });

  // `resets_at` が変われば `utilization` は下がる。引き算をそのまま使うと負の消費が積まれる。
  it('枠が変わった周は、増分を0にする', () => {
    withWork((work) => {
      const live = [{ id: 'cse_a', tags: ['task-1'], working: true }];
      attribute(work, { utilization: 80, resetsAt: WINDOW, now: '2026-09-05T04:55:00Z', live });
      const result = attribute(work, {
        utilization: 3,
        resetsAt: '2026-09-05T10:00:00Z',
        now: '2026-09-05T05:05:00Z',
        live,
      });

      expect(result.state.sessions.cse_a.spent).toBe(0);
      expect(result.state.utilization).toBe(3);
    });
  });

  // APIは同じ枠でも呼び出しごとに違う秒未満を返す。丸ごと比べると一致する周が一度も来ず、
  // 増分が永久に0になって計測が溜まらない（2026-09-05 に実測）。
  it('秒未満だけが違う resets_at は、同じ枠として増分を積む', () => {
    withWork((work) => {
      const live = [{ id: 'cse_a', tags: ['task-1'], working: true }];
      attribute(work, {
        utilization: 10,
        resetsAt: '2026-09-05T07:20:00.939340+00:00',
        now: '2026-09-05T01:00:00Z',
        live,
      });
      const result = attribute(work, {
        utilization: 16,
        resetsAt: '2026-09-05T07:20:00.358630+00:00',
        now: '2026-09-05T01:05:00Z',
        live,
      });

      expect(result.state.sessions.cse_a.spent).toBe(6);
    });
  });

  it('枠が同じでも utilization が下がった周は、増分を0にする', () => {
    withWork((work) => {
      const live = [{ id: 'cse_a', tags: ['task-1'], working: true }];
      attribute(work, { utilization: 40, resetsAt: WINDOW, now: '2026-09-05T01:00:00Z', live });
      const result = attribute(work, {
        utilization: 39,
        resetsAt: WINDOW,
        now: '2026-09-05T01:05:00Z',
        live,
      });

      expect(result.state.sessions.cse_a.spent).toBe(0);
    });
  });

  it('タグの無いセッションは、投入したものと分けて数える', () => {
    withWork((work) => {
      const live = [{ id: 'cse_x', tags: [], working: true }];
      const result = attribute(work, {
        utilization: 5,
        resetsAt: WINDOW,
        now: '2026-09-05T01:00:00Z',
        live,
      });

      expect(result.state.sessions.cse_x.kind).toBe('untagged');
    });
  });
});
