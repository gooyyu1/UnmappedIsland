import type { StatusDelta } from './statusChanges';
import { mergedStatuses, statusChangesAfter } from './statusChanges';
import { statusRows } from './statusRows';
import type { PropertyCategory as PropertyTab } from '../ui/PropertiesPane';
import type { StatusContent } from '../ui/StatusBar';

/** ShownStatusesが画面の外から読むもの。行動のたびに作り直される値なので、すべて呼び出しで受け取る。 */
export interface StatusSource {
  /** ステータスタグが付いた行（常に候補、PlayScreenView.statuses）。 */
  readonly statuses: () => readonly StatusContent[];
  /**
   * プロパティのタブ（PlayScreenView.propertyCategories）。ここにしか出ない行は、
   * 固定表示にされたときだけステータスエリアの候補に加わる。
   */
  readonly categories: () => readonly PropertyTab[];
  /** 経過を見せている途中か。バーは減った分の帯を縮めずに溜める（ProgressBar.setRatio）。 */
  readonly midAction: () => boolean;
  /** 固定表示が変わった（控えとバーの引き直しは呼び出し側の仕事）。 */
  readonly onPinned: () => void;
  /** その行の詳細を開く（Windows.md 8節）。 */
  readonly onOpenDetail: (key: string) => void;
}

/**
 * ステータスエリアに出ている行と、その見え方（StatusArea.md）。
 *
 * **どの行が出るか・どう見えるかを1箇所で答える。** 行の選び方（statusRows）と増減の計算
 * （statusChanges）は別々に確かめられるが、**それらを混ぜた結果**——固定表示にした行が先頭に居るか、
 * 経過中の行が帯を溜めているか——はここでしか見られない。
 *
 * 直前の行動での増減と固定表示もここが持つ。値を持つ側と混ぜる側が分かれていると、片方だけ更新して
 * 食い違わせることができてしまう。
 *
 * Phaserを知らない——バーの位置も高さも扱わず、並びと1行分の内容だけを答える。
 */
export class ShownStatuses {
  private readonly source: StatusSource;

  /** ユーザが固定表示にしているプロパティ（セーブに残る、SaveDataManagement.md）。 */
  private pinned = new Set<string>();

  /** 直前の行動での増減。次の行動まで出し続ける（statusChangesAfter）。 */
  private changes: ReadonlyMap<string, StatusDelta> = new Map();

  constructor(source: StatusSource) {
    this.source = source;
  }

  /** 入り直すときに、そのセーブの固定表示から始める。前のプレイの増減は持ち越さない。 */
  reset(pinned: Iterable<string>): void {
    this.pinned = new Set(pinned);
    this.changes = new Map();
  }

  /** 固定表示にしているプロパティ（セーブへ書き戻す）。 */
  get pinnedKeys(): readonly string[] {
    return [...this.pinned];
  }

  /**
   * 行動の前後で比べ、増減を控える。beforeは行動を始める前のall()。
   *
   * timePassedは、その操作がゲーム内時間を消費したか。**記号が消えるのは時間が経過してなお値が
   * 動かなかったときだけ**なので、消費しない操作（箱へ入れる・並べ替える）では前の記号が残る。
   */
  note(before: readonly StatusContent[], timePassed: boolean): void {
    this.changes = statusChangesAfter(this.changes, before, this.all(), timePassed);
  }

  /** 控えた増減を差し替える（経過中の各tickの控え、recording.ts）。 */
  setChanges(changes: ReadonlyMap<string, StatusDelta>): void {
    this.changes = changes;
  }

  /**
   * ステータスエリアに並べる行を、出すものだけ表示順に（statusRows）。isShowingChangeは、その行の
   * バーがまだ変化を見せている途中か——安全域へ戻ったばかりの行を、見せ終わるまで残すのに使う。
   */
  rows(wouldShowChangeFor: (status: StatusContent) => boolean): readonly StatusContent[] {
    return statusRows(
      this.source.statuses().map((status) => this.shown(status)),
      this.entries().map((status) => this.shown(status)),
      wouldShowChangeFor,
    );
  }

  /** プロパティのタブにだけ出る行も含めた全件（タブの並び順）。 */
  private entries(): readonly StatusContent[] {
    return this.source.categories().flatMap((tab) => tab.entries);
  }

  /** 全プロパティの行（重複は先勝ち、mergedStatuses）。バーを作るときと、行動の前後を比べるときに使う。 */
  all(): readonly StatusContent[] {
    return mergedStatuses(this.source.statuses(), this.source.categories()).map((status) =>
      this.shown(status),
    );
  }

  /** その1件（そのプロパティが無ければundefined）。 */
  contentOf(key: string): StatusContent | undefined {
    return this.all().find((status) => status.key === key);
  }

  /** プロパティのタブに渡すタブ。行の見え方はステータスエリアと同じ。 */
  tabs(): readonly PropertyTab[] {
    return this.source
      .categories()
      .map((tab) => ({ name: tab.name, entries: tab.entries.map((status) => this.shown(status)) }));
  }

  /** 1行分の見え方。直前の行動での増減・固定表示・経過中かを添える。 */
  private shown(status: StatusContent): StatusContent {
    const delta = this.changes.get(status.key);
    return {
      ...status,
      change: delta?.change,
      ratioBefore: delta?.ratioBefore,
      midAction: this.source.midAction(),
      pinned: this.pinned.has(status.key),
      onTogglePin: () => this.togglePin(status.key),
      onOpenDetail: () => this.source.onOpenDetail(status.key),
    };
  }

  /**
   * 名前をタップしたときの固定表示の切り替え。固定表示にした行は、安全域でもステータスエリアの
   * 先頭に出続ける（StatusArea.md）。
   */
  private togglePin(key: string): void {
    if (!this.pinned.delete(key)) this.pinned.add(key);
    this.source.onPinned();
  }
}
