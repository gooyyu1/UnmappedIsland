import { describe, expect, it } from 'vitest';
import { replaceAllOrFail } from './textEdit';

/**
 * 試験の入力を作る差し替えの検査。**空振りが落ちること**が値打ちなので、当たらない形を並べて
 * 1つずつ落ちるのを見る。
 */
describe('字面の差し替え', () => {
  it('当たった全部を差し替える', () => {
    expect(replaceAllOrFail('a b a', { from: 'a', to: 'c', occurrences: 2 })).toBe('c b c');
  });

  it('1つも当たらなければ投げる', () => {
    expect(() => replaceAllOrFail('a b', { from: 'z', to: 'c', occurrences: 1 })).toThrow('0箇所');
  });

  it('狙いより少なければ投げる', () => {
    expect(() => replaceAllOrFail('a b', { from: 'a', to: 'c', occurrences: 2 })).toThrow('1箇所');
  });

  it('狙いより多ければ投げる', () => {
    // 増えた分は主張の外から来ているので、差し替えた入力はもう狙った形ではない。
    expect(() => replaceAllOrFail('a a', { from: 'a', to: 'c', occurrences: 1 })).toThrow('2箇所');
  });

  it('空の字面は投げる', () => {
    expect(() => replaceAllOrFail('a', { from: '', to: 'c', occurrences: 1 })).toThrow('どこにでも当たる');
  });

  it('改行の違いで当たらなくなったら投げる', () => {
    // CRLFの作業ツリーで読んだ字面へ、LFを含む字面を当てた形（.prettierrcの endOfLine: auto が
    // 想定している状態。CLAUDE.md）。黙って元のまま返すと、試験は主張の面を見ないまま進む。
    const crlf = 'x: 1\r\ny: 2\r\n';

    expect(() => replaceAllOrFail(crlf, { from: 'x: 1\ny: 2', to: 'x: 1\ny: 3', occurrences: 1 })).toThrow(
      '0箇所',
    );
  });

  it('差し替え先が元の字面を含んでいても、数は膨らまない', () => {
    expect(replaceAllOrFail('a', { from: 'a', to: 'aa', occurrences: 1 })).toBe('aa');
  });
});
