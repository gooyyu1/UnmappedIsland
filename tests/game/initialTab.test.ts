import { describe, expect, it } from 'vitest';
import { initialTab } from '../../src/game/view/initialTab';
import { DESCRIPTION_TAB } from '../../src/game/ui/windowTabs';

/**
 * 子ウィンドウを開いたとき最初に出すタブの優先順位（Windows.md 1.2節）の自動テスト。
 *
 * **見ているのは順位だけ。** 渡されたタブが実際に並んでいるかはウィンドウが見る（ObjectWindow）ので、
 * ここでは識別子が何であるかを問わない。
 */
describe('最初に開くタブ', () => {
  it('プログラムの指定があれば、覚えているものより優先する', () => {
    expect(initialTab('equipment', 'injuries')).toBe('equipment');
  });

  it('指定が無ければ、その型で覚えているタブ', () => {
    expect(initialTab(undefined, 'injuries')).toBe('injuries');
  });

  it('どちらも無ければ説明', () => {
    expect(initialTab(undefined, undefined)).toBe(DESCRIPTION_TAB);
  });
});
