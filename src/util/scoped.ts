/**
 * bodyの実行中だけ差し替わる値。
 *
 * **抜ければ必ず元へ戻る**ので、差し替えた側に戻し忘れる余地が無い（`try`/`finally`をここへ1度だけ
 * 書く）。入れ子は内側が勝ち、内側を抜けた時点で外側の値へ戻る。
 *
 * 差し替えるのは1つの値だけで、それを誰がどう使うかは持ち主が決める——観測口を挿す
 * （WorldSession.observeChanges）のにも、今の主体を切り替える（withSubject）のにも同じ形で足りる。
 */
export class Scoped<T> {
  private value: T | undefined;

  /** 今の値。差し替えの外ではundefined。 */
  get current(): T | undefined {
    return this.value;
  }

  /** bodyの実行中だけnextへ差し替える。bodyが投げても元へ戻す。 */
  during(next: T | undefined, body: () => void): void {
    const outer = this.value;
    this.value = next;
    try {
      body();
    } finally {
      this.value = outer;
    }
  }
}
