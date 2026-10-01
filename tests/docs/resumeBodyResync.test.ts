import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { promptBody } from '../../scripts/daemon/prompt-body.mjs';

/**
 * 直しの周で起こす文面が、**本文を差分と突き合わせ直す段**（`CLAUDE.md`「修正作業の進め方」6節）を
 * 指しているかの検査。
 *
 * 起こされた側は文面に書かれた終わり方で手を止めるので、**段が文面から外れれば、指す先の規則が
 * 在っても踏まれない**——周を重ねたPRの本文が、前の版のまま入る（issue #2438）。
 */

const ROOT = resolve(__dirname, '../..');
const RESUME_PROMPT = join(ROOT, 'agent-ops', 'prompts', 'resume-prompt.md');
const CLAUDE_MD = join(ROOT, 'CLAUDE.md');

/** 文面が指す節。見出しの番号が動けば、指し先が別の節になるので一緒に見る。 */
const SECTION_REF = '`CLAUDE.md`「修正作業の進め方」6節';
const SECTION_HEADING = '## 6. PR本文は最後に、実際のdiffから書く';

/**
 * 本文が push を指示しているか。**理由を書き写さずに本文から引く**——push させる理由が増えたとき、
 * 段の欠けた文面がそのまま緑にならないように。道具の名前（`push-screenshot.sh`）は push ではない。
 */
const ORDERS_PUSH = /(?<![\w-])push(?![\w-])/;

describe('直しの周で起こす文面', () => {
  const template = readFileSync(RESUME_PROMPT, 'utf-8');
  const kinds = [...template.matchAll(/^## ([a-z-]+) /gm)].map((found) => found[1]);
  const pushing = kinds.filter((kind) => ORDERS_PUSH.test(promptBody(template, kind) ?? ''));

  it('push させる理由を本文から引ける', () => {
    expect(pushing).not.toEqual([]);
  });

  it('push させる理由はどれも、本文を突き合わせ直す段を指す', () => {
    const missing = pushing.filter((kind) => !promptBody(template, kind)?.includes(SECTION_REF));
    expect(missing).toEqual([]);
  });

  it('指す先の節が、push のたびに突き合わせ直すことを持っている', () => {
    // CRLFの作業ツリーでも見出しの行を同じ綴りで探せるように、改行を揃えてから読む。
    const claude = readFileSync(CLAUDE_MD, 'utf-8').replace(/\r\n/g, '\n');
    const start = claude.indexOf(`\n${SECTION_HEADING}\n`);
    if (start < 0) throw new Error(`${SECTION_HEADING} が ${CLAUDE_MD} に無い`);
    const section = claude.slice(start + 1, claude.indexOf('\n## ', start + 1));
    expect(section).toContain('push のたびに本文を今の差分と突き合わせ直す');
  });
});
