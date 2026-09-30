import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FAILED_RUN_DIR, KEPT_RECORDS } from './failedRunRecorder';
import { ROOT } from './sourceFiles';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * 本物の `vite.config.ts` で、一時ディレクトリの `tests/` に置いた検査を別プロセスの vitest に走らせる。
 * 記録器を直接呼ばずに設定を通すのは、**設定から外れたら落ちる**ようにするため。
 */
function runVitestOn(
  files: Readonly<Record<string, readonly string[]>>,
  prepare: (root: string) => void = () => {},
): { root: string; stdout: string } {
  const root = mkdtempSync(join(tmpdir(), 'failed-run-'));
  roots.push(root);
  prepare(root);
  mkdirSync(join(root, 'tests'));
  for (const [name, lines] of Object.entries(files))
    writeFileSync(join(root, 'tests', name), [...lines, ''].join('\n'));
  const run = spawnSync(
    process.execPath,
    [
      join(ROOT, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--root',
      root,
      '--config',
      join(ROOT, 'vite.config.ts'),
    ],
    { encoding: 'utf-8' },
  );
  return { root, stdout: run.stdout };
}

const records = (root: string): string[] => readdirSync(join(root, FAILED_RUN_DIR)).sort();

// 別プロセスの vitest を1回起こすので、手元で1秒ほどかかる。上限とその名乗り方は `vite.config.ts` の
// `testTimeout` のコメント。
describe('落ちた検査の記録', { timeout: 20_000 }, () => {
  it('落ちた回は、落ちた検査の名前と文面を記録へ残し、その置き場を端末へ出す', () => {
    const { root, stdout } = runVitestOn({
      'probe.test.ts': [
        "import { beforeAll, describe, expect, it } from 'vitest';",
        "it('通る検査', () => {});",
        "it('値が違う検査', () => { expect(1).toBe(2); });",
        "it('時間切れの検査', async () => { await new Promise((r) => setTimeout(r, 500)); }, 20);",
        "it('待たれない失敗を残す検査', () => { void Promise.reject(new Error('待たれない失敗')); });",
        "describe('前準備が落ちる組', () => {",
        "  beforeAll(() => { throw new Error('前準備の失敗'); });",
        "  it('中身', () => {});",
        '});',
      ],
      'broken.test.ts': ["throw new Error('読み込みの失敗');"],
    });

    const [record] = records(root);
    const text = readFileSync(join(root, FAILED_RUN_DIR, record), 'utf-8');
    expect(text).toContain('## tests/probe.test.ts > 値が違う検査');
    expect(text).toContain('expected 1 to be 2');
    expect(text).toContain('## tests/probe.test.ts > 時間切れの検査');
    expect(text).toContain('Test timed out in 20ms');
    expect(text).toContain('## tests/probe.test.ts > 前準備が落ちる組');
    expect(text).toContain('前準備の失敗');
    expect(text).toContain('## tests/broken.test.ts > （ファイル全体）');
    expect(text).toContain('読み込みの失敗');
    expect(text).toContain('> 捕まらなかったエラー');
    expect(text).toContain('待たれない失敗');
    expect(text).not.toContain('通る検査');
    expect(stdout).toContain(join(FAILED_RUN_DIR, record));
  });

  it('通った回は何も書かない', () => {
    const { root } = runVitestOn({
      'probe.test.ts': ["import { it } from 'vitest';", "it('通る検査', () => {});"],
    });
    expect(() => records(root)).toThrow(/ENOENT/);
  });

  it('記録は新しいものから上限まで残し、古いものを消す', () => {
    const old = Array.from(
      { length: KEPT_RECORDS },
      (_, i) => `2000-01-${String(i + 1).padStart(2, '0')}.md`,
    );
    const { root } = runVitestOn(
      {
        'probe.test.ts': [
          "import { it } from 'vitest';",
          "it('落ちる検査', () => { throw new Error('x'); });",
        ],
      },
      (root) => {
        mkdirSync(join(root, FAILED_RUN_DIR));
        for (const name of old) writeFileSync(join(root, FAILED_RUN_DIR, name), '');
      },
    );

    const kept = records(root);
    expect(kept).toHaveLength(KEPT_RECORDS);
    expect(kept).not.toContain(old[0]);
    expect(kept).toContain(old[1]);
  });
});
