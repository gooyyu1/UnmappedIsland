import type { Localization } from '../../locale/Localization';

/**
 * 死んだことを伝える一文（VitalsSystem.md 6節）。死亡ダイアログの本文に置く。
 *
 * causeは命を絶った`destroy`が名乗った名前（`Ending.causeOfDeath`）で、名乗らずに消えたならundefined
 * ——そのときは死に方を言わない。**文言を引くのは消し方の対応表**（`destroy_reason_texts`）で、
 * 尽きた値が居る段の名前とは別の名前空間（Localization.destroyReason）。
 */
export function causeOfDeathSentence(cause: string | undefined, locale: Localization): string {
  return cause === undefined ? '力尽きた。' : `${locale.destroyReason(cause)}で死んだ。`;
}
