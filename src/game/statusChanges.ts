import type { StatusChange, StatusContent } from './ui/StatusBar';

/**
 * 行動の前後でステータスを比べ、増減した項目だけを表示名で引ける形にする
 * （ScreenLayout.md ステータスエリア節の増減の記号）。
 *
 * 値が変わらなかった項目と、前後のどちらかにしか無い項目は含めない（比べる相手が無い）。
 */
export function statusChangesBetween(
  before: readonly StatusContent[],
  after: readonly StatusContent[],
): ReadonlyMap<string, StatusChange> {
  const changes = new Map<string, StatusChange>();
  for (const status of after) {
    const previous = before.find((earlier) => earlier.name === status.name)?.value;
    if (previous === undefined || previous === status.value) continue;
    changes.set(status.name, status.value > previous ? 'increased' : 'decreased');
  }
  return changes;
}
