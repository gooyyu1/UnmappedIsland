import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { pathForBash, spawnScript } from '../support/runScript';

/**
 * `scripts/daemon/resume-session.sh`——止まったセッションへ送る本文を組み立てる段——の検査。
 *
 * ここが守るのは**送る本文が、ひな形の `## <理由>` 節に書いたとおりであること**。取り違えても
 * `send_message` は通ってしまい、**理由と噛み合わない指示が届いた1本**ができる。届いた本文を読むまで
 * 誰も気づけないのは投入と同じ。
 *
 * **取り出しは投入と同じ1つ**（`scripts/daemon/prompt-template.sh` の `template_body`）なので、綴りの
 * 決め方・前置きのラベル付きの囲み・閉じ忘れの扱いは、投入とここで揃う。写しに戻ったら、下の
 * 「前置きのラベル付きの囲み」と「閉じないまま尽きた囲み」が落ちる。
 */

// 実プロセス（bash と node）を起こすため、`npm test` 全体を並行実行したときのCPU競合だけで既定の
// 5秒を超えうる。
vi.setConfig({ testTimeout: 20000 });

const RESUME_SH = resolve(__dirname, '../../scripts/daemon/resume-session.sh');
const FENCE = '```';

interface Built {
  readonly code: number;
  /** 組み立てられた本文。止まった回は空。 */
  readonly text: string;
  readonly stderr: string;
}

/**
 * `DRY_RUN` で本文だけを組み立てさせる。**この分岐は手綱にもセッションの一覧にも訊く手前**なので、
 * 起こす相手が居なくても走る。
 */
function build(kind: string, number: string, template?: readonly string[]): Built {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-resume-session-'));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, DRY_RUN: '1' };
    if (template !== undefined) {
      const path = join(work, 'resume-prompt.md');
      writeFileSync(path, `${template.join('\n')}\n`, 'utf-8');
      env.RESUME_PROMPT = pathForBash(path);
    }

    const run = spawnScript(RESUME_SH, ['cse_012ABC', kind, number], { stdio: 'pipe', env });
    return { code: run.status ?? -1, text: run.stdout, stderr: run.stderr };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe('resume-session.sh の本文', () => {
  // 本物のひな形を通す。差し替えたひな形だけで確かめると、実際に毎回渡るほうが読めなくなっても緑。
  it('ひな形の節を読んで `<番号>` を埋める', () => {
    const built = build('mend', '1512');

    expect(built.code).toBe(0);
    expect(built.text).toContain('PR #1512');
    expect(built.text).not.toContain('<番号>');
    // 隣の節は混ざらない（`stall` の1行目）。
    expect(built.text).not.toContain('のPRが、まだ出ていません');
  });

  // 盤面が出す語に対応する節が無いまま送ると、理由と噛み合わない本文が届く。
  it('節が無ければ送る本文を組み立てない', () => {
    const built = build('mend', '1512', ['## stall — PRがまだ出ていない', FENCE, '本文', FENCE]);

    expect(built.code).not.toBe(0);
    expect(built.text).toBe('');
    expect(built.stderr).toContain('## mend');
  });

  // 閉じの行に当たるまでを本文にすると、**閉じ忘れたひな形の後ろの節が丸ごと本文へ入る。**
  // 空にはならないので、空で止める関門には掛からない。
  it('閉じないまま尽きた囲みは、本文にしない', () => {
    const built = build('mend', '1512', [
      '## mend — 直しを待っているPRがある',
      FENCE,
      'mend の本文',
      '',
      '## stall — PRがまだ出ていない',
      '',
      'ここは別の節',
    ]);

    expect(built.code).not.toBe(0);
    expect(built.text).toBe('');
    expect(built.stderr).toContain('閉じていない');
  });

  // 節の中でコマンドを見せるひな形が書ける。閉じの行が本文の始まりに見えると、**中身の違う本文が
  // 黙って届く。**
  it('前置きのラベル付きの囲みは、本文の始まりにしない', () => {
    const built = build('mend', '1512', [
      '## mend — 直しを待っているPRがある',
      '',
      `${FENCE}bash`,
      'npm test',
      FENCE,
      '',
      FENCE,
      'PR #<番号> を直してください。',
      FENCE,
    ]);

    expect(built.code).toBe(0);
    expect(built.text).toBe('PR #1512 を直してください。\n');
  });
});
