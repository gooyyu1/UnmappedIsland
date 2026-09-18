/**
 * 子ウィンドウのタブの識別子（Windows.md 1.2節）。**スロットのタブはスロット名をそのまま名乗る**ので、
 * 組み込みのタブはスロットに使えない文字を頭に付けて衝突を避ける。
 *
 * **ObjectWindowから離してあるのは、画面を持たない層（view/initialTab）も最初に開くタブを決めるため**
 * （cardEdgesと同じ理由）。
 */

/** 説明のタブ（タブの記憶の鍵にもなる）。 */
export const DESCRIPTION_TAB = 'description';

export const PROPERTIES_TAB = '@properties';
export const EXPLORATION_TAB = '@exploration';
