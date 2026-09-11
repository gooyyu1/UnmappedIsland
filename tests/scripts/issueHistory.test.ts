import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ISSUE_HISTORY_FILE,
  formatIssueCount,
  formatIssueHistory,
  issueCountAt,
  parseIssueHistory,
} from '../../scripts/issueHistory.mjs';

/**
 * issue の累計の置き場（`stats/issues.tsv`）の、書き方と読み方の検査。
 *
 * この置き場が在るのは、**表を作る道具が網へ出ないようにするため**（issue #1887）。出ると、`gh`
 * も網も無い環境——タスクのセッションが走るクラウド——では issue の列だけが落ちた表が出て、
 * 貼り直した先で今ある値を失う。
 *
 * 見るのは2つ。**どこまで測ったかが行の並びから読めること**（最後の行が測った日）と、**測った日
 * より後は持ち越しだと分かること**。どちらも、壊れても表は正常な形で出るので、ここで落とす。
 */

const DAYS = new Map([
  ['2026-07-13', 12],
  ['2026-07-20', 5],
]);

describe('issue の累計の置き場', () => {
  it('測った日に1件も立っていなくても、最後の行は測った日', () => {
    // 最後の行が測った日であることが、読む側が「どこまで測ったか」を知る唯一の手がかり。
    const history = parseIssueHistory(formatIssueHistory(DAYS, '2026-08-01'));
    expect(history.measuredDay).toBe('2026-08-01');
    expect(history.createdByDay.get('2026-08-01')).toBe(0);
  });

  it('その日までの累計を返す', () => {
    const history = parseIssueHistory(formatIssueHistory(DAYS, '2026-08-01'));
    expect(issueCountAt(history, '2026-07-12')).toEqual({ count: 0, measured: true });
    expect(issueCountAt(history, '2026-07-13')).toEqual({ count: 12, measured: true });
    expect(issueCountAt(history, '2026-07-19')).toEqual({ count: 12, measured: true });
    expect(issueCountAt(history, '2026-07-20')).toEqual({ count: 17, measured: true });
  });

  it('測った日より後は、そこまでの累計を持ち越したものになる', () => {
    // ここが実測と同じ形で返ると、表にも図にも古い数字が今の実測として乗る。
    const history = parseIssueHistory(formatIssueHistory(DAYS, '2026-08-01'));
    expect(issueCountAt(history, '2026-08-01')).toEqual({ count: 17, measured: true });
    expect(issueCountAt(history, '2026-08-02')).toEqual({ count: 17, measured: false });
  });

  it('表の升では、持ち越しと実測が見分けられる', () => {
    // 読み手が見分けられなければ、持ち越していること自体は何の役にも立たない。
    expect(formatIssueCount({ count: 1234, measured: true })).toBe('1,234');
    expect(formatIssueCount({ count: 1234, measured: false })).toBe('1,234（持ち越し）');
  });

  it.each([
    ['見出しが違う', 'day\tcreated\n2026-07-13\t12\n'],
    ['日付が読めない', 'day_jst\tcreated\n2026-07\t12\n'],
    ['数が読めない', 'day_jst\tcreated\n2026-07-13\t十二\n'],
    ['古い順でない', 'day_jst\tcreated\n2026-07-20\t5\n2026-07-13\t12\n'],
    ['同じ日が2行ある', 'day_jst\tcreated\n2026-07-13\t12\n2026-07-13\t5\n'],
  ])('形が崩れていたら落ちる: %s', (_, text) => {
    // 黙って読み飛ばすと、issue の列だけが静かに減った表が出る。
    expect(() => parseIssueHistory(text)).toThrow();
  });

  it('リポジトリに入っている置き場が読める', () => {
    // 手で書き換えたり、書き出し方を変えたまま作り直し忘れたりすると、ここで落ちる。
    const history = parseIssueHistory(readFileSync(ISSUE_HISTORY_FILE, 'utf-8'));
    expect(issueCountAt(history, history.measuredDay).count).toBeGreaterThan(0);
  });
});
