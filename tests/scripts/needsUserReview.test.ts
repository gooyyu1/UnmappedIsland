import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/agent/needs-user-review.sh` の `GRAMMAR` の線。
 *
 * この判定は**ユーザーへ回すかどうか**を決める関門で、誤りはどちらへ転んでも見えない。緩すぎれば
 * 文法の変更が司令塔の判断だけで `main` へ入り、厳しすぎれば判断の中身が無いPRがユーザーのタップを
 * 1回増やすだけになる。GitHub の側には何も現れないので、ここで見ていないと誰も気づけない。
 *
 * `gh` と `git` を PATH の先頭に置いて差し替え、実際にスクリプトを走らせる。
 */

const SCRIPT = resolve(__dirname, '../../scripts/agent/needs-user-review.sh');

interface Result {
  readonly lines: string[];
  readonly code: number;
}

/** 差し替えた `gh`・`git` で判定を1回走らせる。`files` は差分のファイル、`diff` は `gh pr diff` の出力。 */
function judge(files: readonly string[], diff: string): Result {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-needs-user-review-'));
  try {
    const dir = work.replace(/\\/g, '/');
    writeFileSync(join(work, 'files'), `${files.join('\n')}\n`, 'utf-8');
    writeFileSync(join(work, 'diff'), diff, 'utf-8');

    const gh = join(work, 'gh');
    writeFileSync(
      gh,
      `#!/usr/bin/env bash\n` +
        `if [ "$2" = diff ]; then\n  cat '${dir}/diff'\n  exit 0\nfi\n` +
        `if [[ "$*" == *headRefOid* ]]; then\n  echo head0000\n  exit 0\nfi\n` +
        `if [[ "$*" == *baseRefOid* ]]; then\n  echo base0000\n  exit 0\nfi\n` +
        `cat '${dir}/files'\n`,
      'utf-8',
    );
    chmodSync(gh, 0o755);

    // `git fetch` は通し、`git show` は「そのファイルは無い」として返す。`【確定】` の射程の判定は
    // ここでは見ていないので、docs の中身は要らない。
    const git = join(work, 'git');
    writeFileSync(git, `#!/usr/bin/env bash\n[ "$1" = fetch ] && exit 0\nexit 1\n`, 'utf-8');
    chmodSync(git, 0o755);

    const out = spawnSync('bash', [SCRIPT, '900'], {
      encoding: 'utf-8',
      env: { ...process.env, PATH: `${work}${delimiter}${process.env.PATH ?? ''}` },
    });
    return {
      lines: out.stdout.split('\n').filter((line) => line.trim() !== ''),
      code: out.status ?? -1,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** 1ファイルぶんの差分。`lines` は `+`・`-` の付いた行をそのまま並べる。 */
function hunk(path: string, lines: readonly string[]): string {
  return (
    `diff --git a/${path} b/${path}\n` +
    `index 0000000..1111111 100644\n` +
    `--- a/${path}\n` +
    `+++ b/${path}\n` +
    `@@ -1,3 +1,3 @@\n` +
    `${lines.join('\n')}\n`
  );
}

describe('needs-user-review.sh の GRAMMAR', () => {
  it('文法のファイルでも、注釈しか変わっていないなら止めない', () => {
    const result = judge(
      ['src/loader/parsePassives.ts'],
      hunk('src/loader/parsePassives.ts', [
        ' /**',
        '- * 対象は self/parent/child/ancestor のいずれか。',
        '+ * 対象に何を書けるかは、宣言が置かれた場所が決める（14.1節の表）。',
        ' */',
      ]),
    );

    expect(result.lines).toEqual([]);
    expect(result.code).toBe(1);
  });

  it('同じファイルでも、実行される行が変わったら止める', () => {
    const result = judge(
      ['src/loader/parsePassives.ts'],
      hunk('src/loader/parsePassives.ts', [
        ' /** 対象を読む。 */',
        "-  const keys = ['self', 'parent'];",
        "+  const keys = ['self', 'parent', 'child'];",
      ]),
    );

    expect(result.lines).toEqual(['GRAMMAR src/loader/parsePassives.ts']);
    expect(result.code).toBe(0);
  });

  // 行の頭がコードなら注釈ではない。**取りこぼす側ではなく止める側へ倒す。**
  it('コードの後ろに付いた注釈だけの直しは、止める側へ倒す', () => {
    const result = judge(
      ['src/domain/DeclaredNumber.ts'],
      hunk('src/domain/DeclaredNumber.ts', [
        '-  return value; // 実効値',
        '+  return value; // 宣言された数の実効値',
      ]),
    );

    expect(result.lines).toEqual(['GRAMMAR src/domain/DeclaredNumber.ts']);
    expect(result.code).toBe(0);
  });

  // 仕様書とスキーマは全体が宣言そのもので、注釈とコードの区別が無い。
  it('仕様書は、文面の書き換えだけでも止める', () => {
    const result = judge(
      ['docs/engine/GameElementDefinition.md'],
      hunk('docs/engine/GameElementDefinition.md', [
        '-`ancestor` は set/add に書ける。',
        '+`ancestor` は、プロパティ名を伴う場所に書ける。',
      ]),
    );

    expect(result.lines).toEqual(['GRAMMAR docs/engine/GameElementDefinition.md']);
    expect(result.code).toBe(0);
  });

  it('注釈だけかは、そのファイルの差分だけで見る', () => {
    const result = judge(
      ['src/loader/parsePassives.ts', 'src/domain/WorldObject.ts'],
      hunk('src/loader/parsePassives.ts', ['- * 古い説明', '+ * 新しい説明']) +
        hunk('src/domain/WorldObject.ts', ['-  const a = 1;', '+  const a = 2;']),
    );

    expect(result.lines).toEqual([]);
    expect(result.code).toBe(1);
  });

  it('複数の文法ファイルのうち、実体が変わったものだけを挙げる', () => {
    const result = judge(
      ['src/loader/parsePassives.ts', 'src/loader/parseSlots.ts'],
      hunk('src/loader/parsePassives.ts', ['- * 古い説明', '+ * 新しい説明']) +
        hunk('src/loader/parseSlots.ts', ['-  const a = 1;', '+  const a = 2;']),
    );

    expect(result.lines).toEqual(['GRAMMAR src/loader/parseSlots.ts']);
    expect(result.code).toBe(0);
  });
});
