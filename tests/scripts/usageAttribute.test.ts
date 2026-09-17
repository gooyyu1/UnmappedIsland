import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/daemon/usage-attribute.mjs` の検査。
 *
 * ここが守るのは**積んだ値が消費として読めること**。APIはセッション単位の消費を返さないので
 * （`agent-ops/board-design.md` 2.8）、割り当てを間違えると 2.5 の自動の手綱がしきい値ごと狂う。
 * 負の消費が積まれないこと・手が空いているセッションが分母に入らないこと・**枠どうしが混ざらない
 * こと**を見る。
 */

const SCRIPT = resolve(__dirname, '../../scripts/daemon/usage-attribute.mjs');

interface Live {
  readonly id: string;
  readonly tags: readonly string[];
  readonly working: boolean;
}

/** 枠ごとの値。鍵は `scripts/daemon/usage-windows.mjs` の `WINDOWS`。 */
type ByWindow = Record<string, number>;

interface State {
  readonly utilization: ByWindow;
  readonly sessions: Record<string, { readonly kind: string; readonly spent: ByWindow }>;
}

interface Result {
  readonly state: State;
  readonly finished: string;
}

interface Round {
  /** `five_hour` の `utilization`。 */
  readonly five: number;
  /** `seven_day` の `utilization`。省けば `five` と同じ。 */
  readonly seven?: number;
  readonly now: string;
  readonly live: readonly Live[];
}

/** 状態のファイルを引き継ぎながら、割り当てを1回走らせる。 */
function attribute(work: string, round: Round): Result {
  const statePath = join(work, 'usage.json');
  const spentPath = join(work, 'spent.tsv');
  const seven = round.seven ?? round.five;
  execFileSync('node', [SCRIPT, statePath, spentPath], {
    input: JSON.stringify({
      usage: `five_hour ${round.five} - -\nseven_day ${seven} - -`,
      now: round.now,
      live: round.live,
    }),
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

describe('usage-attribute.mjs', () => {
  it('初回は基準を置くだけで、消費を積まない', () => {
    withWork((work) => {
      const result = attribute(work, {
        five: 30,
        now: '2026-09-05T01:00:00Z',
        live: [{ id: 'cse_a', tags: ['task-1'], working: true }],
      });

      expect(result.state.utilization.five_hour).toBe(30);
      expect(result.state.sessions.cse_a.spent.five_hour).toBe(0);
    });
  });

  it('増分は、動いていたセッションで等分する', () => {
    withWork((work) => {
      const live = [
        { id: 'cse_a', tags: ['task-1'], working: true },
        { id: 'cse_b', tags: ['review-2'], working: true },
      ];
      attribute(work, { five: 10, now: '2026-09-05T01:00:00Z', live });
      const result = attribute(work, {
        five: 16,
        now: '2026-09-05T01:05:00Z',
        live,
      });

      expect(result.state.sessions.cse_a.spent.five_hour).toBe(3);
      expect(result.state.sessions.cse_b.spent.five_hour).toBe(3);
      expect(result.state.sessions.cse_a.kind).toBe('new-task');
      expect(result.state.sessions.cse_b.kind).toBe('review');
    });
  });

  // **枠ごとに別々に積む**（board-design 2.5.2）。片方の増分をもう片方の単位で数えると、手綱が
  // 比べる先（残り余力）と桁が合わなくなる。
  it('枠ごとに別々の増分を積む', () => {
    withWork((work) => {
      const live = [{ id: 'cse_a', tags: ['task-1'], working: true }];
      attribute(work, { five: 10, seven: 40, now: '2026-09-05T01:00:00Z', live });
      const result = attribute(work, {
        five: 18,
        seven: 41,
        now: '2026-09-05T01:05:00Z',
        live,
      });

      expect(result.state.sessions.cse_a.spent).toEqual({ five_hour: 8, seven_day: 1 });
    });
  });

  // 5時間の枠は明けても、週次はそのまま伸び続ける。片方の下がりでもう片方の増分を捨てない。
  it('片方の枠だけが下がった周は、その枠の増分だけを0にする', () => {
    withWork((work) => {
      const live = [{ id: 'cse_a', tags: ['task-1'], working: true }];
      attribute(work, { five: 80, seven: 40, now: '2026-09-05T04:55:00Z', live });
      const result = attribute(work, {
        five: 3,
        seven: 45,
        now: '2026-09-05T05:05:00Z',
        live,
      });

      expect(result.state.sessions.cse_a.spent).toEqual({ five_hour: 0, seven_day: 5 });
    });
  });

  // 畳まれていないセッションには、手が空いて次の指示を待っているものが混ざる（board-design 1.2）。
  it('手が空いているセッションは、分母にも入らず積まれもしない', () => {
    withWork((work) => {
      const live = [
        { id: 'cse_a', tags: ['task-1'], working: true },
        { id: 'cse_b', tags: ['task-2'], working: false },
      ];
      attribute(work, { five: 10, now: '2026-09-05T01:00:00Z', live });
      const result = attribute(work, {
        five: 16,
        now: '2026-09-05T01:05:00Z',
        live,
      });

      expect(result.state.sessions.cse_a.spent.five_hour).toBe(6);
      expect(result.state.sessions.cse_b.spent.five_hour).toBe(0);
    });
  });

  // 一覧に載らない手元の Claude Code が食ったぶん。投入したセッションのせいにはしない。
  it('1本も動いていない周の増分は、誰にも積まない', () => {
    withWork((work) => {
      const live = [{ id: 'cse_a', tags: ['task-1'], working: false }];
      attribute(work, { five: 10, now: '2026-09-05T01:00:00Z', live });
      const result = attribute(work, {
        five: 40,
        now: '2026-09-05T01:05:00Z',
        live,
      });

      expect(result.state.sessions.cse_a.spent.five_hour).toBe(0);
      expect(result.state.utilization.five_hour).toBe(40);
    });
  });

  // **列の並びは `WINDOWS`。** 比べる側（`headroom.mjs`）が同じ並びで読むので、ここが動くと
  // 1本あたりの消費が別の枠の値として読まれる。
  it('畳まれて一覧から消えたら、積み上がった値を枠ごとに記録へ出す', () => {
    withWork((work) => {
      const live = [{ id: 'cse_a', tags: ['task-1'], working: true }];
      attribute(work, { five: 10, seven: 40, now: '2026-09-05T01:00:00Z', live });
      attribute(work, { five: 12, seven: 41, now: '2026-09-05T01:05:00Z', live });
      const result = attribute(work, {
        five: 12,
        seven: 41,
        now: '2026-09-05T01:10:00Z',
        live: [],
      });

      expect(result.finished).toBe('2026-09-05T01:10:00Z\tnew-task\t2.0000\t1.0000\tcse_a\n');
      expect(result.state.sessions).toEqual({});
    });
  });

  // 枠が明けたことは、この下がりで見る（`resets_at` は揺れるので使わない）。引き算をそのまま
  // 使うと負の消費が積まれる。
  it('utilization が下がった周は、増分を0にする', () => {
    withWork((work) => {
      const live = [{ id: 'cse_a', tags: ['task-1'], working: true }];
      attribute(work, { five: 80, now: '2026-09-05T04:55:00Z', live });
      const result = attribute(work, {
        five: 3,
        now: '2026-09-05T05:05:00Z',
        live,
      });

      expect(result.state.sessions.cse_a.spent.five_hour).toBe(0);
      expect(result.state.utilization.five_hour).toBe(3);
    });
  });

  // **捨てると、乗り換えの周に生きていたセッションが実際より小さい消費として記録へ入り、0では
  // ないので平均から除かれないまま平均を下へ引く**（`headroom.mjs`）。
  it('枠ごとに分かれていなかった頃の積み上がりは、`five_hour` として引き継ぐ', () => {
    withWork((work) => {
      writeFileSync(
        join(work, 'usage.json'),
        JSON.stringify({ utilization: 10, sessions: { cse_a: { kind: 'new-task', spent: 4 } } }),
        'utf-8',
      );
      const live = [{ id: 'cse_a', tags: ['task-1'], working: true }];
      const carried = attribute(work, { five: 12, seven: 41, now: '2026-09-05T01:05:00Z', live });

      expect(carried.state.sessions.cse_a.spent).toEqual({ five_hour: 4, seven_day: 0 });

      const result = attribute(work, {
        five: 12,
        seven: 41,
        now: '2026-09-05T01:10:00Z',
        live: [],
      });

      expect(result.finished).toBe('2026-09-05T01:10:00Z\tnew-task\t4.0000\t0.0000\tcse_a\n');
    });
  });

  it('タグの無いセッションは、投入したものと分けて数える', () => {
    withWork((work) => {
      const live = [{ id: 'cse_x', tags: [], working: true }];
      const result = attribute(work, {
        five: 5,
        now: '2026-09-05T01:00:00Z',
        live,
      });

      expect(result.state.sessions.cse_x.kind).toBe('untagged');
    });
  });

  // **欠けた枠を「余力が在る」として通すと、その枠では手綱が掛からないまま上限に当たる**
  // （`usage-windows.mjs`）。
  it('枠が1つでも欠けた行なら、何も積まずに落ちる', () => {
    withWork((work) => {
      const statePath = join(work, 'usage.json');
      const call = (): void => {
        execFileSync('node', [SCRIPT, statePath, join(work, 'spent.tsv')], {
          input: JSON.stringify({
            usage: 'five_hour 10 - -',
            now: '2026-09-05T01:00:00Z',
            live: [{ id: 'cse_a', tags: ['task-1'], working: true }],
          }),
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      };

      expect(call).toThrow();
      expect(existsSync(statePath)).toBe(false);
    });
  });
});
