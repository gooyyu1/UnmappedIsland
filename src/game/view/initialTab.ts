import { DESCRIPTION_TAB } from '../ui/windowTabs';

/**
 * 子ウィンドウを開いたとき最初に出すタブ。**プログラムの指定 ＞ 型ごとの記憶 ＞ 説明**
 * （Windows.md 1.2節）。
 *
 * namedは、開いた文脈がそのスロットを見に来たと分かっているときの指定（装備・怪我のボタン、
 * 作り始めた直後の製作中オブジェクト）。rememberedは、その型のウィンドウを前に閉じたときのタブ
 * （Settings.openedTab）。
 *
 * **覚えているのがスロットのタブとは限らない**（プロパティ・踏査のタブも同じように覚える）ので、
 * ここは並んでいるかどうかを見ない——並んでいないタブが渡れば、ウィンドウが説明へ落とす
 * （ObjectWindow.replacePane）。
 */
export function initialTab(named: string | undefined, remembered: string | undefined): string {
  return named ?? remembered ?? DESCRIPTION_TAB;
}
