import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { pathForBash, runScript } from '../support/runScript';
import { STUB_SHEBANG } from '../support/stubShebang';

/**
 * `.claude/hooks/session-start.sh` が、手元の作業ツリーで出す警告の検査。
 *
 * 作業ツリーは本体の `node_modules` を共有する。**共有先が古いときの落ち方は
 * `Cannot find module` ではなく「古い版が解決されて一部だけ壊れる」**ので、黙って進むと
 * そのまま次の判断へ積まれる。ここが鳴らないことは、気づく手立てが無いことと同じ。
 *
 * 本体も作業ツリーも一時ディレクトリに作り、`git` を PATH の先頭で差し替えて走らせる。
 */

// 実際にworktreeまで作る重いテストなので、`npm test` 全体を並行実行したときのCPU競合だけで
// 既定の5秒を超えうる。
vi.setConfig({ testTimeout: 20000 });

const HOOK = resolve(__dirname, '../../.claude/hooks/session-start.sh');

/** `package-lock.json` / `.package-lock.json` の中身。値は版、`null` は「入っていない」。 */
type Tree = Record<string, string | null>;

interface World {
  /** 作業ツリーの `package-lock.json` が要求する依存。 */
  readonly want: Tree;
  /** 本体に実際に入っている依存。 */
  readonly have: Tree;
  /** 作業ツリーが自前の `node_modules` を持っているか。 */
  readonly own?: boolean;
  /** `optional`・`os`・`cpu` の付いた宣言（入っていなくて当たり前のもの）。 */
  readonly optional?: readonly string[];
  /** `git` が本体を辿れない（`--git-common-dir` が失敗する）。 */
  readonly gitFails?: boolean;
}

function lock(tree: Tree, optional: readonly string[] = []): string {
  const packages: Record<string, unknown> = { '': { name: 'unmapped-island' } };
  for (const [name, version] of Object.entries(tree)) {
    if (version === null) continue;
    packages[`node_modules/${name}`] = optional.includes(name) ? { version, optional: true } : { version };
  }
  return JSON.stringify({ lockfileVersion: 3, packages });
}

function run(world: World): string {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-session-start-'));
  try {
    const dir = pathForBash(work);
    const tree = join(work, 'tree');
    // 本体の身代わり。`.git` の実体が要る——フックは `--git-common-dir` から `..` を辿って本体へ
    // 出るので、`cd` が実際に通らないといけない（Git Bash は `..` を字句で畳むが、Linux は畳まない）。
    mkdirSync(join(work, 'main', '.git'), { recursive: true });
    mkdirSync(join(work, 'main', 'node_modules'), { recursive: true });
    mkdirSync(tree, { recursive: true });
    writeFileSync(join(tree, 'package-lock.json'), lock(world.want, world.optional), 'utf-8');
    writeFileSync(join(work, 'main', 'node_modules', '.package-lock.json'), lock(world.have), 'utf-8');
    if (world.own === true) {
      mkdirSync(join(tree, 'node_modules'), { recursive: true });
      writeFileSync(join(tree, 'node_modules', '.package-lock.json'), lock(world.want), 'utf-8');
    }

    const git = join(work, 'git');
    const answer = world.gitFails === true ? 'exit 1' : `printf '%s' '${dir}/main/.git'`;
    writeFileSync(git, `${STUB_SHEBANG}\n${answer}\n`, 'utf-8');
    chmodSync(git, 0o755);

    return runScript(HOOK, [], {
      env: {
        ...process.env,
        CLAUDE_CODE_REMOTE: '',
        CLAUDE_PROJECT_DIR: tree,
        PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
      },
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe('session-start.sh（手元の作業ツリー）', () => {
  it('共有先の本体が足りていれば何も言わない', () => {
    expect(run({ want: { ajv: '8.20.0' }, have: { ajv: '8.20.0' } })).toBe('');
  });

  it('本体に無い依存を名指しして、この作業ツリーで入れるよう促す', () => {
    const out = run({ want: { ajv: '8.20.0' }, have: { ajv: null } });

    expect(out).toContain('ajv');
    expect(out).toContain('npm install');
  });

  // 実際にこの形で壊れた: 本体に eslint 由来の ajv 6 だけが在り、`require` は通ったまま
  // `ajv/dist/2020` が無くてテストが1本落ちた。
  it('版が食い違っているだけでも促す', () => {
    expect(run({ want: { ajv: '8.20.0' }, have: { ajv: '6.15.0' } })).toContain('ajv');
  });

  // 名指しは先頭だけ、件数は足りない分を全部。**どちらも同じ一覧から出る**ので、数え方を変えると
  // 「5件しか足りていない」と読める文が出て、受け取った側は名前の続きを探さなくなる。
  it('足りない依存は全部を数え、名指しは先頭の5件までにする', () => {
    const want: Record<string, string> = {};
    for (let index = 0; index < 7; index += 1) want[`pkg-${index}`] = '1.0.0';

    const out = run({ want, have: {} });

    expect(out).toContain('7 件足りていません');
    expect(out).toContain('pkg-0 pkg-1 pkg-2 pkg-3 pkg-4');
    expect(out).not.toContain('pkg-5');
  });

  it('プラットフォーム依存の任意依存は、入っていなくても数えない', () => {
    expect(
      run({
        want: { ajv: '8.20.0', '@rollup/rollup-linux-x64-gnu': '4.0.0' },
        have: { ajv: '8.20.0' },
        optional: ['@rollup/rollup-linux-x64-gnu'],
      }),
    ).toBe('');
  });

  // **フックが落ちるとセッションが始まらない。** 促すだけの経路なので、本体を辿れなければ何も
  // 言わずに降りる。`runScript` は非0で終われば投げるので、倒れ方が変わればここが赤くなる。
  it('本体を辿れなければ、何も言わずに降りる', () => {
    expect(run({ want: { ajv: '8.20.0' }, have: { ajv: null }, gitFails: true })).toBe('');
  });

  it('作業ツリーが自前の node_modules を持っていれば、共有先は見ない', () => {
    expect(run({ want: { ajv: '8.20.0' }, have: { ajv: null }, own: true })).toBe('');
  });
});
