import { describe, expect, it } from 'vitest';

import { run } from '../support/mergeAndCloseWorld';

/**
 * `merge-and-close.sh` がマージしてよいかを決め、マージの後始末（ブランチ・上に積まれたPR・本体の
 * チェックアウト）をするところ。
 *
 * **後戻りできない操作をする唯一の盤面のスクリプト**なので、素通しの条件だけは機械で見る。
 * コンフリクトしたPRでマージへ進むと、失敗するだけでなく、デーモンは片付いたつもりで次へ行く。
 *
 * 世界の組み方と、ファイルを分けてある理由は `tests/support/mergeAndCloseWorld.ts`。
 */

describe('merge-and-close.sh', () => {
  it('マージしたブランチを消す', () => {
    const result = run({});

    expect(result.deleted).toEqual(['repos/{owner}/{repo}/git/refs/heads/claude/issue-999']);
    expect(result.lines.some((line) => line.startsWith('UNDELETED '))).toBe(false);
  });

  it('既に消えているブランチは、消しに行かない', () => {
    const result = run({ branchGone: true });

    expect(result.deleted).toEqual([]);
    expect(result.lines.some((line) => line.startsWith('UNDELETED '))).toBe(false);
  });

  it('ブランチを消せなければ、後片付けの残りとして出す', () => {
    const result = run({ deleteFails: true });

    expect(result.lines).toContain('UNDELETED claude/issue-999');
    expect(result.status).toBe(2);
  });

  // base のブランチが消えると GitHub は上のPRを閉じ、**閉じた後は reopen も base の張り替えも
  // できない**（#1493 → #1508）。マージの後に下ろすのは、`main` へ入る前だと上のPRの差分に下の
  // ぶんが混ざるから。
  it('上に積まれたPRを、ブランチを消す前に main へ下ろす', () => {
    const result = run({ stacked: [1001, 1002] });

    expect(result.merged).toBe(true);
    expect(result.lines.slice(0, 3)).toEqual(['MERGED 1000', 'RETARGETED 1001', 'RETARGETED 1002']);
    expect(result.deleted).toEqual(['repos/{owner}/{repo}/git/refs/heads/claude/issue-999']);
  });

  it('積まれたPRを下ろせなければ、ブランチを残す', () => {
    const result = run({ stacked: [1001], retargetFails: true });

    expect(result.lines).toContain('UNRETARGETED 1001');
    expect(result.deleted).toEqual([]);
    expect(result.status).toBe(2);
  });

  it('コンフリクトしているPRはマージせずに終わる', () => {
    const result = run({ mergeable: 'CONFLICTING' });

    expect(result.merged).toBe(false);
    expect(result.status).toBe(1);
  });

  // 自動では越えられない関門。越えるにはユーザーの許可を引いて `--user-ok` で叩き直す。
  it('関門に掛かったPRはマージせず、判断待ちを付けて理由ごと HELD で返す', () => {
    const result = run({ gate: ['GRAMMAR src/domain/DeclaredNumber.ts'] });

    expect(result.merged).toBe(false);
    expect(result.lines).toEqual(['HELD 1000', '    GRAMMAR src/domain/DeclaredNumber.ts']);
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
    const result = run({ gate: ['GRAMMAR src/domain/DeclaredNumber.ts'], userOk: true });

    expect(result.merged).toBe(true);
    expect(result.comments).toContain('GRAMMAR src/domain/DeclaredNumber.ts');
    expect(result.labels).toEqual(['--remove-label 判断待ち']);
    expect(result.status).toBe(0);
  });

  it('関門に掛からないPRは、--user-ok を付けなくてもコメントを残さずマージする', () => {
    const result = run({});

    expect(result.merged).toBe(true);
    expect(result.comments).toBe('');
    expect(result.labels).toEqual([]);
  });

  // 作業ツリーは本体の `node_modules` を共有するので、本体が古いままだと版が食い違う。
  // `main` を動かしているのはこのスクリプトなので、ここで一緒に進める。
  it('マージしたら、本体のチェックアウトをブランチを持たせずに新しい main へ進める', () => {
    const result = run({});

    expect(result.git.some((call) => call.includes('fetch --quiet origin main'))).toBe(true);
    expect(result.git.some((call) => call.includes('checkout --quiet --detach origin/main'))).toBe(true);
    expect(result.installed).toBe(false);
    expect(result.status).toBe(0);
  });

  it('依存が変わったときだけ、本体で npm install する', () => {
    expect(run({ lockChanged: true }).installed).toBe(true);
    expect(run({ lockChanged: true }).lines).toContain('INSTALLED');
    expect(run({ lockChanged: false }).installed).toBe(false);
  });

  it('本体に依存が入っていなければ、変わっていなくても入れる', () => {
    expect(run({ mainInstalled: false }).installed).toBe(true);
  });

  it('本体に未コミットの変更があれば触らず、残りとして報せる', () => {
    const result = run({ mainDirty: true });

    expect(result.lines.some((line) => line.startsWith('DIRTY '))).toBe(true);
    expect(result.git.some((call) => call.includes('checkout'))).toBe(false);
    expect(result.installed).toBe(false);
    expect(result.status).toBe(2);
  });
});
