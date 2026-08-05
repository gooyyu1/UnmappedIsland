import type { StatusChange, StatusContent } from './ui/StatusBar';

/** 行動の前後で変わった1件分（ScreenLayout.md ステータスエリア節）。 */
export interface StatusDelta {
  readonly change: StatusChange;

  /**
   * 行動を始める前の満たされ具合（rangeを持たないプロパティはundefined）。出ていなかった行を出すときに、
   * この値から見せ始めて「この行動で変わった分」だけを帯にするために使う（StatusBar.show）。
   */
  readonly ratioBefore: number | undefined;
}

/**
 * 行動の前後でステータスを比べ、増減した項目だけをプロパティの識別子で引ける形にする
 * （ScreenLayout.md ステータスエリア節の増減の記号）。
 *
 * 値が変わらなかった項目と、前後のどちらかにしか無い項目は含めない（比べる相手が無い）。
 */
export function statusChangesBetween(
  before: readonly StatusContent[],
  after: readonly StatusContent[],
): ReadonlyMap<string, StatusDelta> {
  const changes = new Map<string, StatusDelta>();
  for (const status of after) {
    const previous = before.find((earlier) => earlier.key === status.key);
    if (previous === undefined || previous.value === status.value) continue;
    changes.set(status.key, {
      change: status.value > previous.value ? 'increased' : 'decreased',
      ratioBefore: previous.ratio,
    });
  }
  return changes;
}
