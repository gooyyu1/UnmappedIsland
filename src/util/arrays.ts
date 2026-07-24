/** 条件に合う要素を配列からその場で取り除く（配列インスタンスは保ったまま）。 */
export function removeWhere<T>(items: T[], predicate: (item: T) => boolean): void {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) items.splice(i, 1);
  }
}
