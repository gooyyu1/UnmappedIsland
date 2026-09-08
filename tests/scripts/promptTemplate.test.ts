import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { pathForBash, spawnScript } from '../support/runScript';

/**
 * `scripts/agent/prompt-template.sh`——ひな形から、セッションへ渡す本体と題を取り出す段——の検査。
 *
 * ここが守るのは**渡すものが、ひな形の書いたとおりであること**。取り出しに失敗しても
 * `create_session` は通ってしまい、**中身の薄い指示を持ったセッションが立つ**——投入した側には
 * `SESSION` の行が出るので、届いた本文を読むまで気づけない。
 *
 * 囲みの綴りを取り出す側が決め打つと、その綴りを本文に含むひな形（`.claude/triage-prompt.md` の
 * ように、指示の中でコードブロックを見せるもの）が書けない。**綴りはひな形が決める**ので、
 * その判定をここで押さえる。
 */

// 実プロセス（bash）を起こすため、`npm test` 全体を並行実行したときのCPU競合だけで既定の5秒を
// 超えうる。
vi.setConfig({ testTimeout: 20000 });

const TEMPLATE_SH = pathForBash(resolve(__dirname, '../../scripts/agent/prompt-template.sh'));

interface Taken {
  readonly code: number;
  /** 取り出されたもの。止まった回は空。 */
  readonly text: string;
  readonly stderr: string;
}

/** ひな形の中身を渡して、`$1` の関数が取り出したものを返す。 */
function take(fn: 'template_body' | 'template_title', lines: readonly string[]): Taken {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-prompt-template-'));
  const dir = pathForBash(work);
  try {
    writeFileSync(join(work, 'template.md'), `${lines.join('\n')}\n`, 'utf-8');
    const harness = join(work, 'harness.sh');
    writeFileSync(
      harness,
      [
        'set -euo pipefail',
        `source '${TEMPLATE_SH}'`,
        `${fn} '${dir}/template.md' '${dir}/taken.txt'`,
        '',
      ].join('\n'),
      'utf-8',
    );

    const run = spawnScript(harness, [], { stdio: 'pipe' });
    const text = run.status === 0 ? readFileSync(join(work, 'taken.txt'), 'utf-8') : '';
    return { code: run.status ?? -1, text, stderr: run.stderr };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const FENCE = '```';
const WIDE_FENCE = '````';

describe('template_body', () => {
  it('囲みの外は渡さない', () => {
    const taken = take('template_body', ['ひな形の説明', FENCE, '指示の本体', FENCE, '後ろの説明']);

    expect(taken.code).toBe(0);
    expect(taken.text).toBe('指示の本体\n');
  });

  // ひな形が後ろで例を挙げることがある。閉じで切らないと、その例が本体の続きとして届く。
  it('2つ目の囲みは混ざらない', () => {
    const taken = take('template_body', [FENCE, '指示の本体', FENCE, '例:', FENCE, '例の中身', FENCE]);

    expect(taken.text).toBe('指示の本体\n');
  });

  // 綴りを決め打つ側にすると、指示の中でコードブロックを見せるひな形が書けなくなる。
  it('囲みの綴りはひな形が決める', () => {
    const taken = take('template_body', [
      WIDE_FENCE,
      '指示の本体',
      FENCE,
      'ここは指示の一部',
      FENCE,
      WIDE_FENCE,
    ]);

    expect(taken.text).toBe(`指示の本体\n${FENCE}\nここは指示の一部\n${FENCE}\n`);
  });

  // 空の指示でセッションを立てると、何をすればよいか書いていない相手が1本増える。
  it('囲みが無ければ止まる', () => {
    const taken = take('template_body', ['囲みを書き忘れたひな形']);

    expect(taken.code).not.toBe(0);
    expect(taken.stderr).toContain('取り出せない');
  });
});

describe('template_title', () => {
  it('`題:` の行から取る', () => {
    const taken = take('template_title', ['説明', '題: 棚卸 未整理の issue', FENCE, '本体', FENCE]);

    expect(taken.code).toBe(0);
    expect(taken.text).toBe('棚卸 未整理の issue\n');
  });

  // 題は Routine を探す鍵にもなる（`watch-routine.sh`）ので、無いまま進むと2本目が立つ。
  it('`題:` の行が無ければ止まる', () => {
    const taken = take('template_title', [FENCE, '本体', FENCE]);

    expect(taken.code).not.toBe(0);
    expect(taken.stderr).toContain('題:');
  });
});
