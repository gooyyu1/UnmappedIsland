import { describe, expect, it } from 'vitest';
import { messageOf } from '../../src/util/errorMessage';

/**
 * 例外から人へ出す文言（src/util/errorMessage.ts）。**投げられるのはErrorだけではない**ので、
 * 何が飛んできても読める1行になることを見る。
 */
describe('例外から出す文言', () => {
  it('Errorはその文言だけ（種類の名前は添えない）', () => {
    expect(messageOf(new TypeError('壊れた'))).toBe('壊れた');
  });

  it('文字列はそのまま', () => {
    expect(messageOf('壊れた')).toBe('壊れた');
  });

  it('読める文言を持たない値には、渡された文言を代わりに出す', () => {
    expect(messageOf({ code: 7 }, '不明なエラー')).toBe('不明なエラー');
    expect(messageOf(undefined, '不明なエラー')).toBe('不明なエラー');
  });

  it('代わりの文言が無ければ、値そのものを文字列にする', () => {
    expect(messageOf(404)).toBe('404');
  });
});
