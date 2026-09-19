import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runWithOnlyTheseCommands, type CommandCall } from '../support/onlyTheseCommands';
import { pathForBash } from '../support/runScript';

/**
 * `.claude/hooks/format-after-edit.sh` の検査。
 *
 * このフックの仕事は**書き換えた先がリポジトリの中かを見分けて、中のものにだけ prettier をかける**
 * こと。見分けは**リポジトリの根がどこか**に載っているので、`CLAUDE_PROJECT_DIR` が無いときに自分の
 * 置き場から根を引く経路も走らせる——そこが外れると、**全部が「外」に見えて何も整形されないまま
 * 黙って通る。**
 */

const REPO = resolve(__dirname, '../..');
const HOOK = resolve(REPO, '.claude/hooks/format-after-edit.sh');

/**
 * `npx` は控えるだけにする。**本物を走らせると prettier が実際に書き込む**ので、リポジトリの中を
 * 指す検査がそのまま作業ツリーを書き換える。
 */
function run(filePath: string, projectDir: string | undefined) {
  return runWithOnlyTheseCommands(HOOK, {
    real: ['jq'],
    stub: ['npx'],
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    env: { CLAUDE_PROJECT_DIR: projectDir ?? '' },
  });
}

/** prettier へ渡されたファイル。かけられなかったなら `undefined`。 */
function formatted(calls: readonly CommandCall[]): string | undefined {
  const npx = calls.find((call) => call.name === 'npx');
  return npx?.args[npx.args.length - 1];
}

describe('format-after-edit.sh', () => {
  it('リポジトリの中のファイルには prettier をかける', () => {
    const file = join(REPO, 'src', 'main.ts');
    const out = run(file, REPO);

    expect(out.code, `フックが非0で終わった:\n${out.stderr}`).toBe(0);
    expect(formatted(out.calls)).toBe(file);
  });

  /**
   * スクラッチパッドや一時ディレクトリは、このリポジトリの `.prettierrc` の埒外。かけると、
   * 関係のない決まりで他人のファイルが書き換わる。
   */
  it('リポジトリの外のファイルには触らない', () => {
    const work = mkdtempSync(join(tmpdir(), 'unmapped-island-format-after-edit-'));
    try {
      const out = run(join(work, 'note.md'), REPO);

      expect(out.code, `フックが非0で終わった:\n${out.stderr}`).toBe(0);
      expect(formatted(out.calls)).toBeUndefined();
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  /**
   * **`CLAUDE_PROJECT_DIR` が無い経路。** 根を自分の置き場から引けていないと、リポジトリの中の
   * ファイルまで「外」に見えて黙って素通りする。
   */
  it('CLAUDE_PROJECT_DIR が無くても、自分の置き場からリポジトリの根を引く', () => {
    const file = join(REPO, 'src', 'main.ts');
    const out = run(file, undefined);

    expect(out.code, `フックが非0で終わった:\n${out.stderr}`).toBe(0);
    expect(formatted(out.calls)).toBe(file);
  });

  /**
   * **絞った PATH で走らせる。** 書き込みのたびに走るので、増えた分はそのまま常時の固定費になる。
   * `jq`（JSONを読む手が bash に無い）と `npx`（仕事そのもの）以外が生えれば `command not found`
   * で落ち、上の検査が赤くなる。
   */
  it('起こす外部プロセスは jq と npx だけ', () => {
    const out = run(join(REPO, 'src', 'main.ts'), REPO);

    expect(out.code, out.stderr).toBe(0);
    expect(out.calls.map((call) => call.name)).toEqual(['jq', 'npx']);
  });

  /** リポジトリの外なら、prettier を起こす手前で降りる。 */
  it('外のファイルなら jq だけで降りる', () => {
    const out = run(pathForBash(join(tmpdir(), 'note.md')), REPO);

    expect(out.code, out.stderr).toBe(0);
    expect(out.calls.map((call) => call.name)).toEqual(['jq']);
  });
});
