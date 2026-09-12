import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScript } from '../support/runScript';

/**
 * `scripts/agent/checked-items.sh` が拾う範囲。
 *
 * ここが拾ったものは、盤面の `## 確定待ち` に**ユーザーの答えとして**並ぶ（`board.mjs`）。**下ろす
 * 者の居ないチェックを拾うと、下りない項目が居座って本物の答えがその中に埋もれる**が、盤面の見た目は
 * 壊れないので、誰も気づかない。常設の盤を1つの分類で兼ねていた間、実際に投入の手綱のチェックが
 * 毎回並んでいた（`.claude/board-design.md` 2.17.5）。
 *
 * `board.test.ts` はこの判定を差し替えて並べ方だけを見るので、**綴りを見ているのはここだけ。**
 */

const SCRIPT = resolve(__dirname, '../../scripts/agent/checked-items.sh');

interface Issue {
  readonly number: number;
  readonly labels: readonly string[];
  readonly body: string;
}

/** `gh issue list --json number,labels,body` が返す形を渡して、拾われた行を受け取る。 */
function pick(...issues: readonly Issue[]): string[] {
  const input = JSON.stringify(
    issues.map(({ number, labels, body }) => ({ number, labels: labels.map((name) => ({ name })), body })),
  );
  return runScript(SCRIPT, [], { input }).split('\n').filter(Boolean);
}

const ANSWER = '- [x] 世界の広さは 3km 四方\n- [ ] まだ答えていない\n';

describe('checked-items.sh', () => {
  it('答えを受ける盤のチェックを、番号を添えて拾う', () => {
    expect(pick({ number: 656, labels: ['kind:ask'], body: ANSWER })).toEqual(['656 世界の広さは 3km 四方']);
  });

  // 投入の手綱（`brake.sh`）。機械が毎周読むが、**答えではないので誰も下ろさない。**
  it('設定の盤のチェックは拾わない', () => {
    expect(pick({ number: 1515, labels: ['kind:switch'], body: '- [x] 投入する\n' })).toEqual([]);
  });

  // デーモンが本文を丸ごと書き換える盤（`board-publish.mjs`）。拾えば、**自分の書いたものを
  // ユーザーの答えとして読む。**
  it('機械が本文を書く盤のチェックは拾わない', () => {
    expect(pick({ number: 1714, labels: ['kind:board'], body: '- [x] TASK 8 作業中\n' })).toEqual([]);
  });

  // 手順の覚え書き。下ろす先は既に在る（`判断待ち` を外せば、投入されたセッションが読む）。
  it('作業単位の issue が本文に持つチェックは拾わない', () => {
    expect(pick({ number: 42, labels: ['kind:task'], body: '- [x] テストを書く\n' })).toEqual([]);
  });

  it('分類の無い issue のチェックは拾わない', () => {
    expect(pick({ number: 43, labels: [], body: '- [x] 人の言葉のまま\n' })).toEqual([]);
  });

  it('混ざって渡されても、答えを受ける盤のぶんだけを拾う', () => {
    expect(
      pick(
        { number: 1515, labels: ['kind:switch'], body: '- [x] 投入する\n' },
        { number: 656, labels: ['kind:ask'], body: ANSWER },
        { number: 1714, labels: ['kind:board'], body: '- [x] TASK 8 作業中\n' },
      ),
    ).toEqual(['656 世界の広さは 3km 四方']);
  });
});
