import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/usage/timeline.py` が、セッションの額をどの時間へ配るかの検査。
 *
 * ここが守るのは**動いていない時間に額が乗らないこと**。CCR のメタデータは
 * created_at〜updated_at しか持たないので、均等に割ると**枠が尽きて数日空いた区間**にも額が
 * 塗られる。額そのものは正しいまま日付だけがずれるので、**表もグラフも正常な形で出てしまい、
 * 貼った先では気づけない。**
 *
 * `paths.py` の置き場は `__file__` から遡って決まるので、スクリプトを写した一時ディレクトリで
 * 走らせれば、本物の `stats/usage/` も生データも触らずに済む。
 */

const ROOT = resolve(__dirname, '../..');
const PYTHON = ['python3', 'python'].find((name) => {
  try {
    execFileSync(name, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});

interface Event {
  readonly ts: string;
  readonly cache_read: number;
}

interface Session {
  readonly id: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly cost: number;
  readonly events?: readonly Event[];
}

/**
 * セッションを並べて `timeline.py` を走らせ、UTCの日ごとのコストを返す。
 *
 * `carried` を渡すと、**旧の配り方で書かれた集計**を置いてから境目付きで走らせる。境目より前は
 * そこから持ち越されるので、境目を跨ぐセッションを別の配り方で数え直すと合計がずれる。
 */
function costByDay(
  sessions: readonly Session[],
  carried?: { readonly keep: string; readonly hours: ReadonlyMap<string, number> },
): Map<string, number> {
  const work = mkdtempSync(join(tmpdir(), 'usage-timeline-'));
  cpSync(join(ROOT, 'scripts/usage'), join(work, 'scripts/usage'), { recursive: true });
  mkdirSync(join(work, '.usage-data/events'), { recursive: true });
  writeFileSync(join(work, '.usage-data/local_usage.jsonl'), '');
  writeFileSync(
    join(work, '.usage-data/sessions.jsonl'),
    sessions
      .map((session) =>
        JSON.stringify({
          id: session.id,
          created_at: session.created_at,
          updated_at: session.updated_at,
          external_metadata: { usage: { cost_usd: session.cost, cache_read_tokens: 1000 } },
        }),
      )
      .join('\n'),
  );
  for (const session of sessions) {
    if (session.events === undefined) continue;
    writeFileSync(
      join(work, `.usage-data/events/${session.id}.jsonl`),
      session.events.map((event) => JSON.stringify({ session_id: session.id, ...event })).join('\n'),
    );
  }

  const script = join(work, 'scripts/usage/timeline.py');
  const args = [script];
  if (carried !== undefined) {
    mkdirSync(join(work, 'stats/usage'), { recursive: true });
    writeFileSync(
      join(work, 'stats/usage/by_hour.tsv'),
      ['hour_utc\tcost_usd\tinput\toutput\tcache_write\tcache_read']
        .concat([...carried.hours].map(([hour, cost]) => `${hour}\t${cost.toFixed(4)}\t0\t0\t0\t0`))
        .join('\n'),
    );
    args.push(carried.keep);
  }
  execFileSync(PYTHON as string, args, { stdio: 'ignore' });
  const [, ...lines] = readFileSync(join(work, 'stats/usage/by_day.tsv'), 'utf-8').trim().split('\n');
  return new Map(lines.map((line) => line.split('\t')).map(([day, cost]) => [day, Number(cost)]));
}

const IDLE = {
  id: 'session_idle',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-05T00:00:00Z',
  cost: 100,
  // 09-01 に走り、枠が尽きて止まり、09-05 に同じセッションが再開した形。
  events: [
    { ts: '2026-09-01T01:00:00Z', cache_read: 1_000_000 },
    { ts: '2026-09-01T02:00:00Z', cache_read: 1_000_000 },
    { ts: '2026-09-05T00:00:00Z', cache_read: 2_000_000 },
  ],
};

describe.runIf(PYTHON !== undefined)('使用量の時間への配り方', () => {
  it('イベントの無い日に額を置かない', () => {
    const days = costByDay([IDLE]);
    for (const day of ['2026-09-02', '2026-09-03', '2026-09-04']) {
      expect(days.get(day) ?? 0, `${day} に額が乗っている: ${[...days].join(' ')}`).toBe(0);
    }
    expect(days.get('2026-09-01')).toBeCloseTo(50, 6);
    expect(days.get('2026-09-05')).toBeCloseTo(50, 6);
  });

  it('額の合計は変わらない', () => {
    // 配り方を変えても、セッションの額そのものは増えも減りもしない。表は小数4桁で書くので、
    // 桁の丸めより粗く、二重計上や取りこぼしより細かいところで見る。
    const total = [...costByDay([IDLE]).values()].reduce((sum, cost) => sum + cost, 0);
    expect(total).toBeCloseTo(IDLE.cost, 3);
  });

  it('境目を跨ぐセッションの額が、持ち越しと二重にならない', () => {
    // 旧の集計は開始から最終更新まで均等に割って書かれている。境目より前はそこから持ち越すので、
    // 跨ぐセッションだけをイベント基準で数え直すと、**額が二重に乗るか消える。**
    const HOURS = 97; // 09-01T00 から 09-05T00 まで
    const KEEP = '2026-09-03';
    const evenly = new Map(
      Array.from({ length: 48 }, (_, index) => [
        `2026-09-0${index < 24 ? 1 : 2}T${String(index % 24).padStart(2, '0')}:00Z`,
        IDLE.cost / HOURS,
      ]),
    );

    const total = [...costByDay([IDLE], { keep: KEEP, hours: evenly }).values()].reduce(
      (sum, cost) => sum + cost,
      0,
    );
    expect(total).toBeCloseTo(IDLE.cost, 2);
  });

  it('イベントの記録が無いセッションは、開始から最終更新まで均等に割る', () => {
    // 古いセッションはイベントを持たない。ここが落ちると、遡って測れる範囲が黙って消える。
    const days = costByDay([
      { id: 'session_old', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-02T23:00:00Z', cost: 48 },
    ]);
    expect(days.get('2026-07-01')).toBeCloseTo(24, 6);
    expect(days.get('2026-07-02')).toBeCloseTo(24, 6);
  });
});
