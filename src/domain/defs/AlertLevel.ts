/**
 * 値がどの域にあるか（GameElementDefinition.md 6.4節の`stages.alert`）。段ごとに宣言し、UIはこれだけを
 * 見て見せ方を決める（ScreenLayout.md ステータスエリア節）。
 *
 * `fatal`は、放置すると死に至るプロパティ（水分など）にだけ付ける。
 */
export type AlertLevel = 'safe' | 'caution' | 'danger' | 'fatal';

/** YAMLに書ける警戒度の一覧（ロード時の検証用）。 */
export const ALERT_LEVELS: readonly AlertLevel[] = ['safe', 'caution', 'danger', 'fatal'];
