import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `gh` と GitHub の MCP の使い分けが、`.claude/github-access.md` の1箇所だけに在ることの検査。
 *
 * **写しが増えても、写した側は動く。** 動くまま古くなるので、道具の名前や引数が変わったときに
 * 直るのは触った1本だけで、残りは古い手順のまま係を動かす（[issue #1831](https://github.com/gooyyu1/UnmappedIsland/issues/1831)）。
 * 係のプロンプトが持ってよいのは**何を引き・何を書くか**までで、**どちらの道具で引くか**は
 * 持たない、という分け方をここで押さえる。
 *
 * 見るのは `.claude/` の直下だけ。`analysis/`・`decisions/` はその時点の記録で、後から事実を
 * 書き換える先ではない。
 */

const ROOT = resolve(__dirname, '../..');
const CLAUDE_DIR = join(ROOT, '.claude');

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

/** `gh` が在るかを分ける手そのもの。 */
const PROBE = 'command -v gh';

function docsDirectlyUnderClaude(): readonly string[] {
  return readdirSync(CLAUDE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== OWNER)
    .map((entry) => entry.name);
}

describe('gh と MCP の使い分け', () => {
  it('責務を持つ1箇所が、どちらの道具も名指ししている', () => {
    const owner = readFileSync(join(CLAUDE_DIR, OWNER), 'utf-8');

    expect(owner).toContain(PROBE);
    for (const tool of MCP_TOOLS) {
      expect(owner, `${OWNER} が ${tool} を持たない`).toContain(tool);
    }
  });

  it('他の `.claude/*.md` は、道具の名前を持たない', () => {
    const carried = docsDirectlyUnderClaude().flatMap((name) => {
      const text = readFileSync(join(CLAUDE_DIR, name), 'utf-8');
      return [...MCP_TOOLS, PROBE]
        .filter((spelling) => text.includes(spelling))
        .map((spelling) => `${name}: ${spelling}`);
    });

    expect(carried, `使い分けは ${OWNER} だけが持つ。ここからは短い参照で指す`).toEqual([]);
  });
});
