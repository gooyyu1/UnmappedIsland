/**
 * 値がどの域にあるか（GameElementDefinition.md 6.4節の`stages.alert`）。段ごとに宣言し、UIはこれだけを
 * 見て見せ方を決める（StatusArea.md）。
 *
 * `watch`と`caution`はどちらも「出すが明滅はさせない」域で、今のところUIは区別しない。深刻さの違いを
 * 段の側で表しておけば、見せ方を分けたくなったときにYAMLを書き直さずに済む。
 * `fatal`は、放置すると死に至るプロパティ（水分など）にだけ付ける。
 */
export type AlertLevel = 'safe' | 'watch' | 'caution' | 'danger' | 'fatal';

/** YAMLに書ける警戒度の一覧（ロード時の検証用。並びは軽い順）。 */
export const ALERT_LEVELS: readonly AlertLevel[] = ['safe', 'watch', 'caution', 'danger', 'fatal'];
