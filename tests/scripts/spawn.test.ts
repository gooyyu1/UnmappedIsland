import { describe, expect, it } from 'vitest';

import { gh } from '../../scripts/daemon/spawn.mjs';

/**
 * `scripts/daemon/spawn.mjs` の検査。
 *
 * ここが守るのは**引けなかった理由が呼び手に残ること**（`agent-ops/board-design.md` 1.7
 * 「引けなかったときは、道具が言った理由をそのまま出す」）。捨てると、**検索の文法の誤りも資格情報の
 * 切れも、呼び手には「引けなかった」としか残らない**——呼び手は人へ見せる断りを組む側なので、
 * そこで理由が尽きる。
 *
 * **本物の `gh` を叩く。** 落とし所は2つあり、**どちらでも理由は返る**——`gh` が在る箱なら知らない
 * 副コマンドの文句が、無い箱なら起こせなかったことが。**片方しか見ない形にすると、走った箱に
 * よっては何も確かめないまま緑になる。**
 */
describe('spawn.mjs の gh', () => {
  it('引けなかったら、道具が言った理由を呼び手へ渡す', () => {
    const said: string[] = [];

    const out = gh(['この副コマンドは無い'], { sayWhyNot: (line: string) => said.push(line) });

    expect(out).toBeUndefined();
    expect(said).toHaveLength(1);
    // **叩いた引数を頭に置く。** 1周で `gh` は何度も走るので、理由だけでは**どの呼び出しのものか**
    // が読めない。
    expect(said[0]).toMatch(/^gh この副コマンドは無い: .+/s);
  });
});
