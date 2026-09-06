import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 使用量の口を叩く間隔の検査（`.claude/board-design.md` 2.5.2）。
 *
 * **この口は2分に1回ほどしか通らない**ので、盤面の周（35秒）ごとに叩くと大半が `429` で返り、
 * ログが失敗で埋まって本物の失敗が見えなくなる。ここが守るのは**間隔が空いていない周は、外へ
 * 出ずに0で見送ること**——出ないことを見るので、この検査は網に触らない。
 */

// 実プロセス（bash）を起こす。
vi.setConfig({ testTimeout: 20000 });

const AGENT = resolve(__dirname, '../../scripts/agent');

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'unmapped-island-usage-'));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

/** 「たった今叩いた」を置く。これが在る間、口は外へ出ない。 */
function polledJustNow() {
  writeFileSync(join(stateDir, 'usage-polled'), `${Math.floor(Date.now() / 1000)}\n`, 'utf-8');
}

function run(script: string) {
  const call = spawnSync('bash', [join(AGENT, script).replace(/\\/g, '/')], {
    encoding: 'utf8',
    env: { ...process.env, BOARD_STATE: stateDir },
  });
  return { code: call.status ?? -1, stdout: call.stdout, stderr: call.stderr };
}

describe('使用量の口を叩く間隔', () => {
  it('間隔が空いていなければ、何も出さずに2で返す', () => {
    polledJustNow();

    const call = run('usage.sh');

    expect(call.code).toBe(2);
    expect(call.stdout).toBe('');
  });

  // **2は失敗ではない。** 報せると、待つだけの周が異常として並び、本物の失敗が埋もれる。
  it('呼び手は、その周を何も言わずに見送る', () => {
    polledJustNow();

    const call = run('usage-record.sh');

    expect(call.code).toBe(0);
    expect(call.stdout).toBe('');
    expect(call.stderr).not.toContain('使用量を引けなかった');
  });
});
