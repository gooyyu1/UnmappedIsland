import { describe, expect, it } from 'vitest';

import { run } from '../support/mergePrWorld';

/**
 * `merge-pr.sh` がマージしてよいかを決めて、1本入れるところ。
 *
 * **後戻りできない操作をする唯一の盤面のスクリプト**なので、素通しの条件だけは機械で見る。
 * コンフリクトしたPRでマージへ進むと、失敗するだけでなく、デーモンは片付いたつもりで次へ行く。
 *
 * **後片付けはここには無い**（`tests/scripts/tidyMergedPr.test.ts`）。
 *
 * 世界の組み方と、ファイルを分けてある理由は `tests/support/mergePrWorld.ts`。
 */

describe('merge-pr.sh', () => {
  it('マージして、番号を出す', () => {
    const result = run({});

    expect(result.merged).toBe(true);
    expect(result.lines).toEqual(['MERGED 1000']);
    expect(result.status).toBe(0);
  });

  // ブランチを消すのも、上に積まれたPRの base を張り替えるのもGitHub自身
  // （`tidy-merged-pr.sh`「GitHub が肩代わりするもの」）。ここが `--delete-branch` を付け直すと、
  // 消す手が2つになる。
  it('ブランチを消す手は持たない', () => {
    const result = run({});

    expect(result.lines.some((line) => line.startsWith('UNDELETED '))).toBe(false);
    expect(result.lines.some((line) => line.startsWith('RETARGETED '))).toBe(false);
  });

  it('コンフリクトしているPRはマージせずに終わる', () => {
    const result = run({ mergeable: 'CONFLICTING' });

    expect(result.merged).toBe(false);
    expect(result.status).toBe(1);
  });

  // 自動では越えられない関門。越えるにはユーザーの許可を引いて `--user-ok` で叩き直す。
  it('関門に掛かったPRはマージせず、判断待ちを付けて理由ごと HELD で返す', () => {
    const result = run({ gate: ['MARK docs/ui/Windows.md 9.3 未解放レシピの理由【確定】'] });

    expect(result.merged).toBe(false);
    expect(result.lines).toEqual(['HELD 1000', '    MARK docs/ui/Windows.md 9.3 未解放レシピの理由【確定】']);
    expect(result.labels).toEqual(['--add-label 判断待ち']);
    expect(result.status).toBe(1);
  });

  // 関門は「調べられなかった」ときも該当ありとして閉じる。開いたままにすると、`gh` が転んだ日は
  // 全部が素通しになる。
  it('関門が調べられなかったときも止める', () => {
    const result = run({ gate: ['PR #1000 のファイル一覧を引けなかった'], gateStatus: 2 });

    expect(result.merged).toBe(false);
    expect(result.lines).toEqual(['HELD 1000', '    PR #1000 のファイル一覧を引けなかった']);
  });

  it('--user-ok なら、許可を受けたことをPRへ残してからマージする', () => {
    const result = run({ gate: ['MARK docs/ui/Windows.md 9.3 未解放レシピの理由【確定】'], userOk: true });

    expect(result.merged).toBe(true);
    expect(result.comments).toContain('MARK docs/ui/Windows.md 9.3 未解放レシピの理由【確定】');
    expect(result.labels).toEqual(['--remove-label 判断待ち']);
    expect(result.status).toBe(0);
  });

  it('関門に掛からないPRは、--user-ok を付けなくてもコメントを残さずマージする', () => {
    const result = run({});

    expect(result.merged).toBe(true);
    expect(result.comments).toBe('');
    expect(result.labels).toEqual([]);
  });
});
