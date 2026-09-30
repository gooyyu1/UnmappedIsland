import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PATROL_KEEP_DAYS,
  PATROL_VERDICTS,
  appendPatrol,
  patrolPath,
  readLastPatrol,
} from '../../scripts/daemon/board-state.mjs';
import { SESSION_PLACES, promptBodies } from '../../scripts/daemon/prompt-body.mjs';
import { runScript } from '../support/runScript';

/**
 * 盤面を見回る係の記録（`agent-ops/board-design.md` 2.21.4節）の検査。
 *
 * 守るのは3つ——**係が書いた先を盤面が読む**こと、**`verdict` が係の出口をすべて表せる**こと、
 * **記録が無制限に伸びない**こと。どれも破れても係の回は緑のまま走り、常設の issue の1行が
 * 黙って嘘になるだけなので、ここで押さえる。
 */

const ROOT = resolve(__dirname, '../..');
const PROMPTS = join(ROOT, 'agent-ops/prompts');
const PATROL_PROMPT = join(PROMPTS, 'patrol-prompt.md');

function withStateDir<T>(body: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'unmapped-island-patrol-'));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const record = (at: string, verdict = '異常なし') => ({ at, verdict, summary: at });

describe('appendPatrol', () => {
  it('足した1件が、盤面の読む最後の見回りになる', () => {
    withStateDir((dir) => {
      appendPatrol(dir, record('2026-09-20T00:00:00Z'));
      appendPatrol(dir, record('2026-09-20T01:00:00Z', '次へ回した'));

      expect(readLastPatrol(dir)).toEqual({
        at: '2026-09-20T01:00:00Z',
        verdict: '次へ回した',
        summary: '2026-09-20T01:00:00Z',
      });
    });
  });

  it('残す長さより古い行と、読めない行を落とす', () => {
    withStateDir((dir) => {
      const now = Date.parse('2026-09-20T00:00:00Z');
      const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();
      writeFileSync(
        patrolPath(dir),
        [record(daysAgo(PATROL_KEEP_DAYS + 1)), '{壊れた行', record(daysAgo(PATROL_KEEP_DAYS - 1))]
          .map((line) => `${typeof line === 'string' ? line : JSON.stringify(line)}\n`)
          .join(''),
      );

      appendPatrol(dir, record(new Date(now).toISOString()));

      const kept = readFileSync(patrolPath(dir), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { at: string }).at);
      expect(kept).toEqual([daysAgo(PATROL_KEEP_DAYS - 1), new Date(now).toISOString()]);
      // 差し替えに使った一時ファイルを残さない。
      expect(readdirSync(dir)).toEqual(['patrol.jsonl']);
    });
  });

  it('時刻として読めない `at` は書かない', () => {
    withStateDir((dir) => {
      expect(() => appendPatrol(dir, record('昨日'))).toThrow(/at/);
      expect(readLastPatrol(dir)).toBeUndefined();
    });
  });

  it('一覧に無い `verdict` は書かない', () => {
    withStateDir((dir) => {
      expect(() => appendPatrol(dir, record('2026-09-20T00:00:00Z', '人へ回した'))).toThrow(/verdict/);
      expect(readLastPatrol(dir)).toBeUndefined();
    });
  });
});

describe('見回りの係の本文', () => {
  const template = readFileSync(PATROL_PROMPT, 'utf8');
  const bodies = promptBodies(template).join('\n');

  // 係はデーモンの環境変数を受け取らないので、自分で置き場を引かせるとデーモンが移した先とずれる。
  it('置き場を自分の環境から引かせない', () => {
    for (const own of ['~/.claude/board-state', '~/daemon.log', 'process.env', 'boardState()'])
      expect(bodies, own).not.toContain(own);
  });

  it('`verdict` の一覧が、書ける値と同じ並びで出ている', () => {
    expect(bodies).toContain(`"verdict":"${PATROL_VERDICTS.join('|')}"`);
  });

  it('投入すると、置き場がデーモンの値で埋まる', () => {
    const prompt = (
      JSON.parse(
        runScript(
          join(ROOT, 'scripts/daemon/dispatch-chore.sh'),
          ['patrol', 'agent-ops/prompts/patrol-prompt.md', '--bridge'],
          {
            stdio: 'pipe',
            env: {
              ...process.env,
              BOARD_STATE: '/daemon/state',
              DAEMON_LOG: '/daemon/log',
              DRY_RUN: 'full',
              CLOUD_ENV: 'env_TEST_CLOUD',
              BRIDGE_ENV: 'env_TEST_BRIDGE',
            },
          },
        ),
      ) as { prompt: string }
    ).prompt;

    expect(prompt).toContain("node scripts/agent/patrol-record.mjs '/daemon/state'");
    expect(prompt).toContain('/daemon/state/patrol.jsonl');
    expect(prompt).toContain('/daemon/log');
    expect(prompt).not.toMatch(/\{\{\w+\}\}/);
  });
});

// 知らない名前は埋まらずにそのまま渡るので、綴りの誤りはここでしか分からない。
describe.each(readdirSync(PROMPTS).filter((name) => name.endsWith('.md')))('%s', (name) => {
  it('`{{<名前>}}` は埋められる名前だけ', () => {
    const bodies = promptBodies(readFileSync(join(PROMPTS, name), 'utf8')).join('\n');
    const names = [...bodies.matchAll(/\{\{(\w+)\}\}/g)].map((found) => found[1]);
    expect(names.filter((placed) => !Object.hasOwn(SESSION_PLACES, placed))).toEqual([]);
  });
});
