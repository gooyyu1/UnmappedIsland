/**
 * 読み込み中に見つかった、**致命ではない問題**の記録（AssetPack.md 6.1節）。
 *
 * アセットパックの中身はユーザーが書くもので、パックどうしの競合（同じものを外す2つのパック等）は
 * 起こって当たり前のことである。そこで止めるとプレイできなくなるため、行えなかったぶんだけを
 * 捨てて先へ進み、何をなぜ捨てたかをここへ残す。
 *
 * **黙って捨てはしない。** 記録は必ずコンソールへも出す。読める画面を用意するまでの間、
 * 書いた本人が気付ける経路をこれで確保する。
 */
export interface LoadProblem {
  /** 出所（パック名つきのファイル名など）。 */
  readonly source: string;
  /** 行おうとしたこと（patchの1操作など）。無ければ出所全体の話。 */
  readonly attempted: string | undefined;
  /** 行えなかった理由。 */
  readonly reason: string;
}

export class LoadReport {
  private readonly entries: LoadProblem[] = [];

  /** 捨てた1件を記録する。 */
  add(source: string, attempted: string | undefined, reason: string): void {
    this.entries.push({ source, attempted, reason });
    console.warn(
      `[アセットパック] ${source}${attempted === undefined ? '' : `: ${attempted}`}\n  → ${reason}`,
    );
  }

  get problems(): readonly LoadProblem[] {
    return this.entries;
  }
}

/**
 * ゲームとビューアが共有する記録。読める画面はまだ無く、当面はコンソールと、この配列を読む
 * テストだけが見る。
 */
export const LOAD_REPORT = new LoadReport();
