import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * 公開サイトの作り直しが「触った場所で絞られる」と言えるかの検査
 * （`CLAUDE.md`「公開サイト（GitHub Pages）」）。
 *
 * あの節は走る条件を `on.push.paths` の**在り処で指す**——挙がっている場所を書き写すと、片方だけが
 * 古びるため（`CLAUDE.md`「数え上げを書かない」）。残るのは「絞りが在る」という1つの主張で、
 * **絞りを外すとそれが嘘になる**。
 *
 * 外しても**壊れるものは何も無い**——Pages はむしろ全部の push で走るようになり、CI も公開サイトも
 * 緑のまま。読んだ者が「走っていないのは壊れているからだ」と誤読するだけで、それは
 * [issue #2266](https://github.com/gooyyu1/UnmappedIsland/issues/2266) が直した誤読そのもの。
 * 気づく者が居ないので、ここが落ちる。
 *
 * 見るのは絞りの有無だけで、**どの場所が挙がっているかは見ない**。そこは現物の側の話で、
 * ここへ写せば写しのほうが古びる。
 */

const ROOT = resolve(__dirname, '../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/pages.yml');
const GUIDE = resolve(ROOT, 'CLAUDE.md');

/** 節が在り処として指している綴り。**これが動いたら、この検査は別の主張を見張っている。** */
const POINTER = '`on.push.paths`';

/** `pages.yml` の `on.push`。 */
function pushTrigger(): Record<string, unknown> {
  const workflow = parse(readFileSync(WORKFLOW, 'utf-8')) as {
    on?: { push?: Record<string, unknown> };
  };
  const push = workflow.on?.push;
  if (push === undefined) throw new Error('pages.yml の `on` に `push` が無い');
  return push;
}

describe('公開サイトの作り直しが走る条件', () => {
  it('`CLAUDE.md` が、条件の在り処として `on.push.paths` を指している', () => {
    expect(
      readFileSync(GUIDE, 'utf-8').includes(POINTER),
      `節の指し先が動いた。${POINTER} を見張っているこの検査も、新しい指し先へ合わせる`,
    ).toBe(true);
  });

  it('`pages.yml` の `on.push` に、触った場所の絞りが在る', () => {
    expect(
      pushTrigger().paths,
      '絞りを外すと、`CLAUDE.md` の「挙がっている場所を触った push だけ」が嘘になる',
    ).toEqual(expect.arrayContaining([expect.any(String)]));
  });
});
