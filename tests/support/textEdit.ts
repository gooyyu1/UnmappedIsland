/**
 * 字面を差し替えて試験の入力を作る入口。
 *
 * 差し替えは**当たらなくても何も起きない**（`String.replace` は見つからなければ元の文字列を返す）。
 * 入力が元のまま渡ると、試験は自分が確かめたい主張とは別の面を見て、**主張を破っても緑のまま
 * 通る**か、破れていないのに赤くなるかのどちらかになる。当たった数を呼び手に名乗らせて、
 * 食い違ったらそこで落とす。
 *
 * 差し替え先の字面が動いたら数が変わるので、**数は「今いくつ在るか」ではなく「いくつに当てるつもりか」**
 * として読む。狙いより多い側でも落ちるのは、増えた分が主張の外から来ているため。
 */

/** 1回の差し替え。 */
export interface TextEdit {
  readonly from: string;
  readonly to: string;
  /** `from` が当たる数。これと違えば投げる。 */
  readonly occurrences: number;
}

/**
 * `from` の**すべて**を `to` へ差し替えた文字列。当たった数が `edit.occurrences` と違えば投げる。
 *
 * 数えるのは差し替える前の字面なので、`to` が `from` を含んでいても数は膨らまない。
 */
export function replaceAllOrFail(text: string, edit: TextEdit): string {
  if (edit.from === '') throw new Error('差し替える字面が空。どこにでも当たるので数を確かめられない');

  const found = text.split(edit.from).length - 1;
  if (found !== edit.occurrences)
    throw new Error(
      `字面の差し替えが${edit.occurrences}箇所のはずが${found}箇所に当たった: ${JSON.stringify(edit.from)}`,
    );

  return text.replaceAll(edit.from, edit.to);
}
