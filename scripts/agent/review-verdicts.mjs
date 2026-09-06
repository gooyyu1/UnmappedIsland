// PRのコメントから、レビューが書いた**判定**を拾う（`.claude/board-design.md` 2.9）。
//
//   import { verdicts, readVersion } from './review-verdicts.mjs';
//   verdicts(pr.comments)        // → 判定のコメントだけを、古い順に
//   readVersion(comment)         // → そのコメントが名乗った「読んだ版」（無ければ undefined）
//
// **見分け方を持つ場所を1つにする。** 同じコメントを3者が読む——次の周が何回目かを数える
// [`dispatch-review.sh`](dispatch-review.sh)、そのレビューが書き終えたかを見る
// [`board-move.mjs`](board-move.mjs)、ラベルへ変える
// [`board-labels.yml`](../../.github/workflows/board-labels.yml)。**緩めたほうだけが余計な
// コメントを判定と読む**ので、揃っていることが要る。
//
// Actions は node を持ち込まずに `grep` で読むので、あちらだけは別実装のまま。**同じ文字列を
// 見ていることを、両方のコメントで名指ししてある。**

/**
 * 判定のコメントの1行目。**1行目が結論の文そのもの**で、それ以外の形は判定ではない
 * （`review-prompt.md`「結果はPRのコメントとして残す」）。緩めると、ラベルが付かなかったコメントで
 * 周回の番号だけが進む。
 */
const VERDICT_LINE = /^\[レビュー\] (通してよい(（人の判断が要る）)?|直しが要る)[ \t]*$/;

/** 読んだ版の名乗り（`review-prompt.md`「読んだ版」）。**書き忘れうる**ので、無い場合が要る。 */
const READ_VERSION = /^読んだ版:[ \t]*([0-9a-fA-F]{7,40})[ \t]*$/m;

const body = (comment) => (comment?.body ?? '').replace(/\r/g, '');

/** 判定のコメントだけを、`gh` が返した順（古い順）のまま返す。 */
export function verdicts(comments) {
  return (comments ?? []).filter((comment) => VERDICT_LINE.test(body(comment).split('\n')[0]));
}

/** そのコメントが名乗った版。名乗っていなければ `undefined`。 */
export function readVersion(comment) {
  return READ_VERSION.exec(body(comment))?.[1];
}
