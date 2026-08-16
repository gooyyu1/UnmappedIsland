import type { PlayScreenView } from './PlayScreenView';
import type { StatusChange, StatusContent } from '../ui/StatusBar';

/** そのviewの全プロパティのステータス（タブの並び順）。 */
function allEntries(view: PlayScreenView): readonly StatusContent[] {
  return view.propertyCategories.flatMap((tab) => tab.entries);
}

/**
 * そのviewの全ステータス（重複は先勝ち）。行動の前後を比べる元になる——ステータスエリアに
 * 出ている行だけで比べると、出ていない行の増減を取りこぼす。
 */
export function allStatuses(view: PlayScreenView): readonly StatusContent[] {
  const all = new Map<string, StatusContent>();
  for (const status of [...view.statuses, ...allEntries(view)]) {
    if (!all.has(status.key)) all.set(status.key, status);
  }
  return [...all.values()];
}

/** 行動の前後で変わった1件分（StatusArea.md）。 */
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
 * （StatusArea.mdの増減の記号）。
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

/**
 * 操作のあとの増減の記号を求める。`previous`は今出ている記号。
 *
 * **記号が消えるのは、時間が経過してなお値が動かなかったときだけです。** 時間を消費しない操作
 * （箱へ入れる、並べ替える）は行動の区切りではないので、そこで値が動かなくても直前の行動の記号を
 * 消しません。荷重のように時間を消費せずに動く項目もあるため、動いた項目だけは上書きします。
 */
export function statusChangesAfter(
  previous: ReadonlyMap<string, StatusDelta>,
  before: readonly StatusContent[],
  after: readonly StatusContent[],
  timePassed: boolean,
): ReadonlyMap<string, StatusDelta> {
  const changes = statusChangesBetween(before, after);
  return timePassed ? changes : new Map([...previous, ...changes]);
}
