import type { WorldObject } from './WorldObject';

/**
 * 世界に起きた、形を変えない出来事1件（`WorldSession.observeSignals`）。
 *
 * 物の出入り（`WorldChange`）も値の増減も伴わない出来事——空振り・回避——は、世界を読み直しても
 * 現れない。**告げるのは、それを起こした側だけ**で、ここはその告知をそのまま運ぶ。
 *
 * 告げ方は2つあるが、運ぶ形はこの1つ。結果として告げる`signal`（GameElementDefinition.md 9.8節）も、
 * 操作が始まったことを告げる`announce`（同 11.6節）も、受け取る側にとっては「起きたこと」1件でしかない。
 */
export interface WorldSignal {
  /** 何が起きたかの識別子。表示文言はlocaleが持つ（Localization.md signal_texts節）。 */
  readonly name: string;

  /**
   * 誰の身に起きたか（効果が指した対象。9.8節）。**演出で使う札**がこれになる——殴って外した
   * 出来事は、殴られた側の札の上のことになる。
   *
   * 効果を宣言した側（`WorldChange.subject`にあたるもの）は持たない。出入りと違って、告げられた
   * 出来事はどこから見ても1つの札の上のことでしかない。
   */
  readonly object: WorldObject;
}
