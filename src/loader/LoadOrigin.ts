import type { LoadReport } from './LoadReport';
import { messageOf } from '../util/errorMessage';

/**
 * 今読んでいるYAML 1つぶんの出どころ（AssetPack.md 6.1節）。**報告に出す名前と、行えなかったぶんの
 * 扱いは同じ出どころの2面**なので、1つにまとめて持つ——どちらも「どこから読んだものか」だけで決まる。
 *
 * **同梱ぶんには報告先が無い。** そちらの誤りはゲーム自身のバグで、外して続ける先が無いため
 * その場で投げる。パックぶんはユーザーが書くものなので、行えなかった1件だけを捨てて先へ進む。
 *
 * **読み取った結果ではなく、この出どころ自身が扱いを答える**（discardOrThrow）。読んだ側が
 * 「報告先があるか」で分岐すると、同じ判断が読む場所の数だけ写る。
 */
export class LoadOrigin {
  /** 報告に出す出所（パック名つきのファイル名など）。 */
  readonly label: string;

  private readonly report: LoadReport | undefined;

  constructor(label: string, report: LoadReport | undefined) {
    this.label = label;
    this.report = report;
  }

  /**
   * 読めなかった1件を捨てて記録する。**捨てられない出どころ（同梱ぶん）では、受け取った誤りを
   * そのまま投げ直す**ので、戻ってきたら「捨てて先へ進んでよい」ことになる。
   *
   * attemptedは行おうとしたこと（patchの1操作など）。
   */
  discardOrThrow(attempted: string, error: unknown): void {
    if (this.report === undefined) throw error;
    this.report.addDiscarded(this.label, attempted, messageOf(error));
  }
}
