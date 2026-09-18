import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnScript } from '../support/runScript';
import { STUB_SHEBANG } from '../support/stubShebang';

/**
 * 使用量の口を叩く間隔と、**引けた行の控え**の検査（`agent-ops/board-design.md` 2.5.2）。
 *
 * **この口は2分に1回ほどしか通らない**ので、盤面の周（35秒）ごとに叩くと大半が `429` で返り、
 * ログが失敗で埋まって本物の失敗が見えなくなる。ここが守るのは**間隔が空いていない周は、外へ
 * 出ずに0で見送ること**と、**控えを書き換えるのは引けた回だけ**であること——後者が崩れると、
 * 「引けなかった」が投入の関門（[`headroom.sh`](../../scripts/daemon/headroom.sh)）へ**「余力が
 * 在る」として渡る。**
 *
 * 口を叩く回は `node` を PATH の先頭で差し替えるので、この検査も網に触らない。
 */

// 実プロセス（bash）を起こす。
vi.setConfig({ testTimeout: 20000 });

const DAEMON = resolve(__dirname, '../../scripts/daemon');

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

function run(script: string, args: readonly string[] = [], path?: string) {
  const call = spawnScript(join(DAEMON, script), args, {
    env: {
      ...process.env,
      BOARD_STATE: stateDir,
      ...(path === undefined ? {} : { PATH: `${path}${delimiter}${process.env.PATH ?? ''}` }),
    },
  });
  return { code: call.status ?? -1, stdout: call.stdout, stderr: call.stderr };
}

/**
 * 口の中身（`usage.mjs`）の身代わりを PATH の先頭へ置き、その置き場を返す。**本物は通信する**ので、
 * 引けた回と引けなかった回を作り分けるには、ここを差し替えるしかない。
 */
function stubEndpoint(body: string): string {
  const bin = mkdtempSync(join(tmpdir(), 'unmapped-island-usage-bin-'));
  const node = join(bin, 'node');
  writeFileSync(node, `${STUB_SHEBANG}\n${body}\n`, 'utf-8');
  chmodSync(node, 0o755);
  return bin;
}

const LINES = 'five_hour 9 2026-09-05T01:00:00Z -\nseven_day 14 2026-09-10T01:00:00Z -';

function cached(): string {
  const path = join(stateDir, 'usage-latest');
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
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

  // **間隔を跨いで叩き直す打ち方が在ること。** 引けなかった周に `headroom.sh` が告げるのはこの形で、
  // **打っても何も出ない案内は無いのと同じ**——口が落ちているのか順番待ちなのかを、人がここで見る。
  it('間隔を0にすれば、叩いた直後でも口まで通る', () => {
    polledJustNow();
    const bin = stubEndpoint(`printf '%s\\n' '${LINES}'`);
    try {
      const call = spawnScript(join(DAEMON, 'usage.sh'), [], {
        env: {
          ...process.env,
          BOARD_STATE: stateDir,
          USAGE_MIN_SECONDS: '0',
          PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
        },
      });

      expect(call.status).toBe(0);
      expect(call.stdout).toContain('five_hour');
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

describe('引けた行の控え', () => {
  it('引けた回は、引けた時刻と行を控える', () => {
    const bin = stubEndpoint(`printf '%s\\n' '${LINES}'`);
    try {
      const call = run('usage.sh', [], bin);

      expect(call.code).toBe(0);
      expect(cached()).toContain(LINES);
      expect(run('usage.sh', ['--last']).stdout).toBe(`${LINES}\n`);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  // **引けなかった回に控えを書き換えると、「引けなかった」が「余力が在る」として読まれる。**
  it('引けなかった回は、前の控えを書き換えない', () => {
    const ok = stubEndpoint(`printf '%s\\n' '${LINES}'`);
    const broken = stubEndpoint('exit 1');
    try {
      run('usage.sh', [], ok);
      const before = cached();

      rmSync(join(stateDir, 'usage-polled'));
      const call = run('usage.sh', [], broken);

      expect(call.code).toBe(1);
      expect(cached()).toBe(before);
    } finally {
      rmSync(ok, { recursive: true, force: true });
      rmSync(broken, { recursive: true, force: true });
    }
  });

  // **`--last` は口を叩かない**ので、叩いた印にも触らない——触ると、割り当ての側（`usage-record.sh`）
  // の番を奪って、増分がその周ぶん取りこぼされる。
  it('`--last` は、叩いた印を動かさない', () => {
    const bin = stubEndpoint(`printf '%s\\n' '${LINES}'`);
    try {
      run('usage.sh', [], bin);
      const polled = readFileSync(join(stateDir, 'usage-polled'), 'utf-8');

      run('usage.sh', ['--last']);

      expect(readFileSync(join(stateDir, 'usage-polled'), 'utf-8')).toBe(polled);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});
