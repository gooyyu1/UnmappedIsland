import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { promptBodies } from '../../scripts/daemon/prompt-body.mjs';

/**
 * **issue を立てさせる係が、立てる手前で不採用の記録を読む段を持っているか**の検査
 * （[`parallel-work.md`](../../agent-ops/parallel-work.md)「立てる前に、不採用の記録と突き合わせる」）。
 *
 * `CLAUDE.md` は [`DesignNotes.md`](../../docs/DesignNotes.md) を「過去の失敗を繰り返さないために
 * 残す価値がある事項」の置き場だと定めているが、**読む段を要求している係が1つも無かった**（#2169）。
 * 突き合わせる段が無い限り、不採用済みの案は周回ごとに issue を1本ずつ生み、そのたびにセッション
 * 1本とユーザーの手番を1回食う。
 *
 * 見るのは、段が**届く形で置かれているか**。
 *
 * - **囲みの中に在る。** セッションへ渡るのは囲みの中身だけ（`scripts/daemon/prompt-body.mjs`）
 *   なので、説明の側に書いた段は係の手には**渡らない**。渡らない段は、書いていないのと同じ。
 * - **網は係の名前で切らない**（{@link FILES_ISSUES}）。並べた一覧は、係が増えたときに増えた側が
 *   黙って外へ落ちる。
 *
 * **見ているのは綴りが囲みの中に在ることだけで、それが起票の段に在るかは見ていない**——別の節へ
 * 書けば通る。指し先がその節を持っているかは `tests/docs/docReferences.test.ts` が見る。
 */

const ROOT = resolve(__dirname, '../..');
const PROMPTS = join(ROOT, 'agent-ops', 'prompts');

/**
 * 起票させるひな形の見分け。**エージェントが立てた issue には必ず `origin:agent` が要る**
 * （`agent-ops/parallel-work.md`「自分で立てた issue には `origin:agent` を付ける」）ので、
 * **それを渡させているひな形が、起票させるひな形。** 係を足した者は同じ印を渡させるほかないため、
 * **足した係は自分からこの網に入る。**
 */
const FILES_ISSUES = 'origin:agent';

/** 突き合わせる先。**綴りで指す**——渡された係は、この名前でファイルを開く。 */
const RECORD = 'DesignNotes.md';

/** ひな形のうち、セッションへ渡る側。**節ごとに本文を持つひな形が在る**ので、全部を繋いで見る。 */
function bodyOf(file: string): string {
  return promptBodies(readFileSync(join(PROMPTS, file), 'utf-8')).join('\n');
}

const FILING_PROMPTS = readdirSync(PROMPTS)
  .filter((name) => name.endsWith('.md'))
  .filter((name) => bodyOf(name).includes(FILES_ISSUES));

describe('issue を立てさせるひな形', () => {
  // **空の一覧に `it.each` を回しても緑になる**ので、網が1本も拾わなくなったこと自体を落とす。
  // 囲みの取り出しが壊れたときに、検査が黙って通らないようにする。
  it('網が1本以上を拾っている', () => {
    expect(FILING_PROMPTS).not.toEqual([]);
  });

  it.each(FILING_PROMPTS)('%s は、不採用の記録を囲みの中で指している', (file) => {
    expect(
      bodyOf(file),
      `${file} は issue を立てさせるのに、${RECORD} と突き合わせる段を渡していない`,
    ).toContain(RECORD);
  });
});
