import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `gh` と GitHub の MCP の使い分けが、`agent-ops/github-access.md` の1箇所だけに在ることの検査。
 *
 * **写しが増えても、写した側は動く。** 動くまま古くなるので、道具の名前や引数が変わったときに
 * 直るのは触った1本だけで、残りは古い手順のまま係を動かす（[issue #1831](https://github.com/gooyyu1/UnmappedIsland/issues/1831)）。
 * 係のプロンプトが持ってよいのは**何を引き・何を書くか**までで、**どちらの道具で引くか**は
 * 持たない、という分け方をここで押さえる。
 *
 * 写しが増えうるのは係のプロンプトだけではないので、`agent-ops/**`・`.claude/**`・`scripts/**` まで
 * 降りる。
 * ただし `analysis/`・`decisions/` はその時点の記録で、後から事実を書き換える先ではないので除く。
 */

const ROOT = resolve(__dirname, '../..');
const OPS_DIR = join(ROOT, 'agent-ops');

/** 降りない場所。記録と、追跡していない各セッションのリポジトリ。 */
const SKIP_DIRS = new Set(['analysis', 'decisions', 'worktrees', 'node_modules']);

/** 使い分けの責務を持つ1箇所。 */
const OWNER = 'github-access.md';

/**
 * GitHub の MCP の道具の名前。**表を写せば必ず現れる**ので、写しの検出はこれで足りる。
 * `gh` の側の綴りでは引けない——引く対象を絞る例（`--search` の語）は係の側の持ち物で、
 * それ自体は写しではない。
 */
const MCP_TOOLS = [
  'list_issues',
  'search_issues',
  'issue_read',
  'issue_write',
  'add_issue_comment',
  'list_pull_requests',
  'search_pull_requests',
  'pull_request_read',
] as const;

/**
 * `gh` が在るかを分ける手そのもの。**見るのは文書だけ。** 道具を揃える側のスクリプトが
 * 前提の有無を確かめるのは、この使い分けの写しではない。
 */
const PROBE = 'command -v gh';

/** 写しが増えうる場所。`agent-ops/**`・`.claude/**`・`scripts/**` の、記録を除いた全部。 */
function filesUnder(dir: string, exts: readonly string[]): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (statSync(full).isDirectory()) {
      found.push(...filesUnder(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      found.push(full);
    }
  }
  return found;
}

/** 責務を持つ1箇所を除いた、見る先。`[path, 中身]` の組で返す。 */
function others(exts: readonly string[]): readonly (readonly [string, string])[] {
  return [
    ...filesUnder(OPS_DIR, exts),
    ...filesUnder(join(ROOT, '.claude'), exts),
    ...filesUnder(join(ROOT, 'scripts'), exts),
  ]
    .filter((path) => path !== join(OPS_DIR, OWNER))
    .map((path) => [relative(ROOT, path), readFileSync(path, 'utf-8')] as const);
}

describe('gh と MCP の使い分け', () => {
  it('責務を持つ1箇所が、どちらの道具も名指ししている', () => {
    const owner = readFileSync(join(OPS_DIR, OWNER), 'utf-8');

    expect(owner).toContain(PROBE);
    for (const tool of MCP_TOOLS) {
      expect(owner, `${OWNER} が ${tool} を持たない`).toContain(tool);
    }
  });

  it('他は MCP の道具の名前を持たない', () => {
    const carried = others(['.md', '.sh', '.mjs', '.ts', '.yml']).flatMap(([path, text]) =>
      MCP_TOOLS.filter((tool) => text.includes(tool)).map((tool) => `${path}: ${tool}`),
    );

    expect(carried, `使い分けは ${OWNER} だけが持つ。ここからは短い参照で指す`).toEqual([]);
  });

  it('他の文書は、`gh` が在るかを自分で分けない', () => {
    const carried = others(['.md'])
      .filter(([, text]) => text.includes(PROBE))
      .map(([path]) => path);

    expect(carried, `${PROBE} を打つ手順は ${OWNER} だけが持つ`).toEqual([]);
  });
});
