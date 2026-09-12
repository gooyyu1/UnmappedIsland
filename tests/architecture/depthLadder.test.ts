import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREEN_DEPTH } from '../../src/game/looks/screenDepth';

/**
 * 「層の値は1箇所にだけ書く」（[`screenDepth.ts`](../../src/game/looks/screenDepth.ts)）が
 * 効いていることの検査。
 *
 * 宣言が言っているのは**層の値の在り処**であって、同じ層の中の前後関係ではない。そちらは生成順
 * そのものなので、破れても赤くなるものは作れない——代わりに、階梯の外で層を決める道を塞ぐ。
 * **値を書く**（setDepthへ階梯以外を渡す）・**シーンごと持ち上げる**（表示リストの並べ替え）・
 * **規約をもう1箇所へ書く**（copy-paste）。
 *
 * 最後のものを字面で見張るのは、**それが実際に壊れた形だから**——「表示順は生成順で決まる」という
 * 同じ一文が、部品のファイルへ複製されていた（issue #1958）。`.claude/policies.md`「仕組みの作り方」の
 * 「既に壊した実績のある操作は機械で止める」に当たる。
 *
 * どの2つの層を入れ替えてはいけないかは、ここではなく tests/game/screenDepth.test.ts が持つ。
 */
const ROOT = resolve(__dirname, '../..');

/** 層の値を書いてよい唯一の場所。 */
const LADDER = 'src/game/looks/screenDepth.ts';

/** そのディレクトリ以下の `.ts`（リポジトリ相対）。 */
function sourcesIn(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...sourcesIn(rel));
    else if (entry.endsWith('.ts')) found.push(rel);
  }
  return found;
}

const readSource = (rel: string): string => readFileSync(join(ROOT, rel), 'utf-8');

/** 階梯の外の `src/**` 。 */
const outsideLadder = sourcesIn('src').filter((file) => file !== LADDER);

describe('画面に重ねる層の階梯', () => {
  it('奥から手前へ、宣言の順に並ぶ', () => {
    // 宣言の順がそのまま奥から手前の順であることが、この一覧を上から読める根拠。順序と値が
    // 食い違うと、離れた2つの前後関係を読み違える。
    const values = Object.values(SCREEN_DEPTH);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size, '同じ値の層が2つある（どちらが手前か決まらない）').toBe(values.length);
  });

  it('既定の層（0）を階梯に持たない', () => {
    // 0は「層を指定しない表示物」が居る場所。そこへ名前を与えると、名前で層を指定したものと
    // 指定しなかったものが同じ層に混ざり、前後関係が生成順だけで決まることが読めなくなる。
    expect(Object.values(SCREEN_DEPTH)).not.toContain(0);
  });

  it('層の値を、階梯の外で決めている場所が無い', () => {
    // 渡してよいのは階梯の項そのものか、階梯の値しか入らない型（ScreenDepth）で受けた値だけ。
    // 素の数を渡せる口が1つでも残ると、そこが階梯の外で前後関係を決める2箇所目になる。
    const offenders = outsideLadder.flatMap((file) => {
      const source = readSource(file);
      return [...source.matchAll(/\.setDepth\(([^)]*)\)/g)]
        .map((match) => match[1].replace(/\s+/g, '').replace(/,$/, ''))
        .filter((argument) => !/^SCREEN_DEPTH\.\w+$/.test(argument))
        .filter((argument) => {
          // 名前をそのまま渡したものだけが、受け口の型で身元を確かめられる。式にして渡したものは
          // 階梯の外で値を決めているので、中身を見るまでもなく挙げる。
          if (!/^\w+(?:\.\w+)*$/.test(argument)) return true;
          const received = argument.split('.').pop() ?? argument;
          return !new RegExp(String.raw`\b${received}\??:\s*ScreenDepth\b`).test(source);
        })
        .map((argument) => `${file}: setDepth(${argument})`);
    });

    expect(offenders).toEqual([]);
  });

  it('シーンの表示リストごと持ち上げている場所が無い', () => {
    // 持ち上げは深度での並べ直しを予約しないので、そこで持ち上げたものは次の並べ直しまで
    // どの層よりも手前に居る。**階梯を黙って越える唯一の道**がこれ。
    const liftsPastLayers =
      /\b(?:children|displayList)\.(?:bringToTop|sendToBack|moveAbove|moveBelow|moveUp|moveDown|moveTo)\b/;
    const offenders = outsideLadder.filter((file) => liftsPastLayers.test(readSource(file)));

    expect(offenders).toEqual([]);
  });

  it('前後関係の決まり方を、階梯の外でもう一度説明している場所が無い', () => {
    // 「同じ層の中は生成順」を部品側でも言うと、階梯を読んだ者が知らない前後関係が部品の中で
    // 決まっていく。部品が書いてよいのは**その場で何を先に作るか**だけで、なぜそれで決まるのかは
    // 階梯が持つ。
    const offenders = outsideLadder.filter((file) => readSource(file).includes('生成順'));

    expect(offenders).toEqual([]);
  });
});
