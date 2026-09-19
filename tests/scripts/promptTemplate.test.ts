import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pathForBash, spawnScript } from '../support/runScript';

/**
 * `scripts/daemon/prompt-template.sh`——ひな形から、セッションへ渡す本体と題を取り出す段——の検査。
 *
 * ここが守るのは**渡すものが、ひな形の書いたとおりであること**。取り出しに失敗しても
 * `create_session` は通ってしまい、**中身の薄い指示を持ったセッションが立つ**——投入した側には
 * `SESSION` の行が出るので、届いた本文を読むまで気づけない。
 *
 * 囲みの綴りを取り出す側が決め打つと、その綴りを本文に含むひな形（`agent-ops/prompts/triage-prompt.md` の
 * ように、指示の中でコードブロックを見せるもの）が書けない。**綴りはひな形が決める**ので、
 * その判定をここで押さえる。
 */

const TEMPLATE_SH = pathForBash(resolve(__dirname, '../../scripts/daemon/prompt-template.sh'));

interface Taken {
  readonly code: number;
  /** 出し先に置かれたもの。**止まった回も読む**——空で止まったのか、中身を置いてから止まったのかを
   * 区別しないと、「中身の違う本体が渡らない」を確かめられない。 */
  readonly text: string;
  readonly stderr: string;
}

/** ひな形の中身を渡して、`$1` の関数が取り出したものを返す。`section` は `template_body` の第3引数。 */
function take(fn: 'template_body' | 'template_title', lines: readonly string[], section?: string): Taken {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-prompt-template-'));
  const dir = pathForBash(work);
  try {
    writeFileSync(join(work, 'template.md'), `${lines.join('\n')}\n`, 'utf-8');
    const harness = join(work, 'harness.sh');
    const where = section === undefined ? '' : ` '${section}'`;
    writeFileSync(
      harness,
      [
        'set -euo pipefail',
        `source '${TEMPLATE_SH}'`,
        `${fn} '${dir}/template.md' '${dir}/taken.txt'${where}`,
        '',
      ].join('\n'),
      'utf-8',
    );

    const run = spawnScript(harness, [], { stdio: 'pipe' });
    const taken = join(work, 'taken.txt');
    const text = existsSync(taken) ? readFileSync(taken, 'utf-8') : '';
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

  // ラベル付きの囲みの閉じも「バッククォートだけの行」なので、飛ばさないと本体の始まりに見える。
  // 中身の違う本体が空にならないまま渡り、届いた本文を読むまで気づけない。
  it('前置きのラベル付きの囲みは、本体の始まりにしない', () => {
    const taken = take('template_body', [
      '前置き',
      `${FENCE}bash`,
      'npm test',
      FENCE,
      '説明',
      FENCE,
      '指示の本体',
      FENCE,
    ]);

    expect(taken.text).toBe('指示の本体\n');
  });

  // 空の指示でセッションを立てると、何をすればよいか書いていない相手が1本増える。
  it('囲みが無ければ止まる', () => {
    const taken = take('template_body', ['囲みを書き忘れたひな形']);

    expect(taken.code).not.toBe(0);
    expect(taken.stderr).toContain('取り出せない');
  });

  // 閉じの行に当たるまでを本体として渡すと、**閉じ忘れたひな形の後ろの説明が丸ごと指示になる。**
  // しかも空にはならないので、呼び手が持つ「空で渡さない」関門にも掛からない。
  it('閉じないまま尽きた囲みは、本体にしない', () => {
    const taken = take('template_body', [
      '前置き',
      FENCE,
      '指示の本体',
      '閉じを書き忘れた',
      'ここは説明のつもり',
    ]);

    expect(taken.code).not.toBe(0);
    expect(taken.text).toBe('');
    expect(taken.stderr).toContain('閉じていない');
  });
});

/**
 * 節を渡す形（`$3`）。理由ごとに本文を持つひな形
 * （`agent-ops/prompts/resume-prompt.md`）を、投入と同じ取り出しに乗せるためのもの。
 */
describe('template_body に節を渡す', () => {
  const MEND = '## mend — 直しを待っているPRがある';
  const STALL = '## stall — PRがまだ出ていない';

  it('その節の中の囲みだけを取る', () => {
    const taken = take(
      'template_body',
      [
        '前置き',
        FENCE,
        '前置きの例',
        FENCE,
        MEND,
        FENCE,
        'mend の本文',
        FENCE,
        STALL,
        FENCE,
        'stall の本文',
        FENCE,
      ],
      'mend',
    );

    expect(taken.code).toBe(0);
    expect(taken.text).toBe('mend の本文\n');
  });

  // 節を探している間の囲みを飛ばさないと、**別の節の本文に書かれた見出しの形**が目印に見え、
  // そこから読んだ中身の違う本体が渡る。
  it('前の節の本文に在る見出しの形は、目印にしない', () => {
    const taken = take(
      'template_body',
      [STALL, FENCE, '`## mend` と書いてある行', FENCE, MEND, FENCE, 'mend の本文', FENCE],
      'mend',
    );

    expect(taken.code).toBe(0);
    expect(taken.text).toBe('mend の本文\n');
  });

  // 盤面が出す語に対応する節が無いまま起こすと、別の節の本文が届く。
  it('節が無ければ止まる', () => {
    const taken = take('template_body', [STALL, FENCE, 'stall の本文', FENCE], 'mend');

    expect(taken.code).not.toBe(0);
    expect(taken.text).toBe('');
    expect(taken.stderr).toContain('## mend');
  });

  // 「節が無い」の兄弟。節は在るが囲みを書き忘れた、という形で、**次の節の本文がその節のものとして
  // 渡る。** 節を見つけた後も次の見出しで止まらないと、どちらも空にならないまま通る。
  it('節に囲みが無ければ、後ろの節の本文を渡さない', () => {
    const taken = take(
      'template_body',
      [MEND, '囲みを書き忘れた', STALL, FENCE, 'stall の本文', FENCE],
      'mend',
    );

    expect(taken.code).not.toBe(0);
    expect(taken.text).toBe('');
  });
});

describe('template_title', () => {
  it('`題:` の行から取る', () => {
    const taken = take('template_title', ['説明', '題: 棚卸 未整理の issue', FENCE, '本体', FENCE]);

    expect(taken.code).toBe(0);
    expect(taken.text).toBe('棚卸 未整理の issue\n');
  });

  // 題が無いまま進むと、立てたセッションが何の係か分からないまま一覧に並ぶ。
  it('`題:` の行が無ければ止まる', () => {
    const taken = take('template_title', [FENCE, '本体', FENCE]);

    expect(taken.code).not.toBe(0);
    expect(taken.stderr).toContain('題:');
  });
});
