import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 盤面を回す道具が、**呼び手で2つに分かれたまま**であることの検査
 * （`agent-ops/parallel-work.md`「`scripts/` は呼び手で分かれている」）。
 *
 * **分け目は「誰が起動するか」1つだけ。** デーモンの周回から起こされるものが `scripts/daemon/`、
 * 人かセッションが自分で打つものが `scripts/agent/`。分かれ目が答えるのは**直したものが、いつ誰の
 * 手で動き出すか**——前者は `main` へ入った次の周から走っているデーモンが読み直し、後者は次に誰かが
 * 打つまで動かない。
 *
 * **境界は字面では守られない**——新しい道具は「隣に在るから」で置かれる。片方が肥ると、置き場を見ても
 * 誰が起こすのかが分からなくなる。
 *
 * 見るのは追跡されているファイルだけ。
 */

const ROOT = resolve(__dirname, '../..');

function trackedUnder(dir: string): readonly string[] {
  return execFileSync('git', ['ls-files', '-z', dir], { cwd: ROOT, encoding: 'utf-8' })
    .split('\0')
    .filter(Boolean)
    .map((rel) => rel.slice(`${dir}/`.length));
}

const DAEMON_SIDE = trackedUnder('scripts/daemon');

/**
 * `scripts/agent/` に在ってよいもの。**どれも、起こす1回が人かセッションのもの。**
 *
 * - `board.sh` … 盤面を端末へ1回出す入口。中身の `board.mjs` はデーモンも読むので向こうに在る
 * - `checked-items.sh` … `board.sh` の `## 確定待ち` だけが起こす。デーモンは通らない
 * - `daemon-wake-task.sh` … デーモンを起こす係を登録する1回。デーモンが回り始める前に在る
 * - `push-screenshot.sh` … セッションがPR本文へ画像を貼るときに打つ
 */
const AGENT_SIDE = ['board.sh', 'checked-items.sh', 'daemon-wake-task.sh', 'push-screenshot.sh'];

/**
 * コメントを落とした中身。**起動の形だけを残す**——説明の中の名前まで数えると、互いを引き合う
 * 冒頭のコメントだけで全部が「辿れる」ことになり、この検査は何も見なくなる。
 *
 * `//` の手前が `:` のものは落とさない（`https://…`）。**落としすぎると、同じ行の後ろで名指し
 * している道具を辿れないと読む**——足りないほうへ倒すと、在るものを無いと言う赤になる。
 *
 * **`.sh` でも行末のコメントを落とす。** 行頭の `#` だけを落としていた間は、コードの行の後ろへ
 * 名前を書けばこの検査が「辿れる」と読んだ——言語で穴の大きさが変わると、どちらの言語で書いたかが
 * 見張りの強さを決めてしまう。落とすのは**行頭の `#` と、空白に続く `#`** から行末まで
 * （`${#arr}`・`$#` のように語へ続く `#` は落とさない）。
 */
function code(name: string): string {
  const text = readFileSync(join(ROOT, 'scripts', 'daemon', name), 'utf-8');
  if (name.endsWith('.sh')) {
    return text
      .split('\n')
      .map((line) => line.replace(/(^|\s)#.*$/, '$1'))
      .join('\n');
  }
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * `daemon.sh` から辿れるもの。名前が**コードとして現れる**ことを辿る
 * （`import`・`node "$HERE/…"`・`runScript('…')` のどれも、この形で残る）。
 *
 * `.d.mts` は本体の型だけを持ち、コードのどこからも名指しされない。**本体が辿れるなら辿れる。**
 */
function reachableFromDaemon(): ReadonlySet<string> {
  const bodies = DAEMON_SIDE.filter((name) => !name.endsWith('.d.mts'));
  const seen = new Set(['daemon.sh']);
  const queue = ['daemon.sh'];
  while (queue.length > 0) {
    const source = code(queue.pop() as string);
    for (const name of bodies) {
      if (seen.has(name) || !source.includes(name)) continue;
      seen.add(name);
      queue.push(name);
    }
  }
  for (const name of DAEMON_SIDE) {
    if (name.endsWith('.d.mts') && seen.has(name.replace(/\.d\.mts$/, '.mjs'))) seen.add(name);
  }
  return seen;
}

describe('盤面を回す道具の置き場', () => {
  it('`scripts/daemon/` に在るものは、どれも `daemon.sh` から辿れる', () => {
    const reachable = reachableFromDaemon();
    const orphans = DAEMON_SIDE.filter((name) => !reachable.has(name));

    expect(orphans, 'デーモンが起こさないものを `scripts/daemon/` へ置かない').toEqual([]);
  });

  it('`scripts/agent/` に在るのは、人かセッションが自分で打つものだけ', () => {
    expect([...trackedUnder('scripts/agent')].sort()).toEqual([...AGENT_SIDE].sort());
  });
});
