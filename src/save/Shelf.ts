import { StorageArea } from './StorageArea';

/**
 * 持ち帰ったアーティファクトの棚（docs/concept/GameEndings.md 6節）。
 *
 * **周回をまたいで残る唯一のもの**なので、周回そのもの（セーブスロット）とは別の領域に置く。
 * 死んでもスロットを消しても棚は消えない——消えるなら、棚は周回を終わらせる理由にならない。
 *
 * 中身は識別子の集合で、同じ物を2度持ち帰っても枠は増えない（アーティファクトは全周回に共通する
 * 有限の集合で、棚はその埋まり具合を映すもの）。
 *
 * 保存先はコンストラクタで受け取る。ブラウザではlocalStorage、テストではメモリ上の実装を渡す
 * （SaveSlots・Settingsと同じ）。
 */
export class Shelf {
  private readonly area: StorageArea;

  constructor(storage: Storage) {
    this.area = new StorageArea(storage, 'shelf');
  }

  /** 棚に収まっているアーティファクトのobject_defの識別子（収めた順、重複なし）。 */
  get contents(): readonly string[] {
    const parsed = this.area.readJson();
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((name): name is string => typeof name === 'string'))];
  }

  /**
   * 持ち帰った物を棚へ収める。**既に在る物は増えない**ので、呼び出し側は重複を除かずに渡してよい。
   * 実際に新しく収まった識別子を返す（何が増えたかを見せる側が、差分を数え直さずに済む）。
   */
  addReturningNewlyAdded(names: readonly string[]): readonly string[] {
    const before = this.contents;
    const added = names.filter((name) => !before.includes(name));
    if (added.length === 0) return [];

    this.area.writeJson([...before, ...new Set(added)]);
    return [...new Set(added)];
  }
}
