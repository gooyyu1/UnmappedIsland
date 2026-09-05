#!/usr/bin/env bash
# 手綱の issue を読んで、その種類を流してよいかを答える。**答えるのは「立ててよいか」。**
#
#   bash scripts/agent/brake.sh new-task
#   bash scripts/agent/brake.sh review
#   bash scripts/agent/brake.sh review-untasked   # `Closes` 先に task ラベルが無いPRのレビュー
#   bash scripts/agent/brake.sh resume
#   bash scripts/agent/brake.sh other
#
# 出力は次のどれか。**終了コードが0なのは `GO` のときだけ**（[`occupancy.sh`](occupancy.sh) と
# 同じ向き。読めなかったときに止まる側へ倒すのを、呼び手ではなくここが引き受ける）。
#
#   GO
#   STOP <外れている行の見出し>
#   UNKNOWN <理由>
#
# 掛かるのは**セッションを立てること**だけ。マージやラベルは止めない
# （[`board-design.md`](../../.claude/board-design.md) 2.4）。走っているセッションにも触らない。
#
# ## 行の文字列で見分ける
#
# 置き場は issue のチェックボックスで、書くのは人間（スマホから1タップ）。**GitHub の側に
# 「一時停止」に当たる状態が無い**ので自前の規約になる。読む側がここ1つ・書く側が人間1人で、
# 読めないときは止まる側へ倒すので、規約が揺れても壊れる先は安全側に限られる。
#
# 見るのは `## 手綱` 節の中だけ。**種類は、根から自分までの見出しの鎖に対応する**——どれか1つでも
# 外れていれば止まる。「投入する」が全部の根で、`review-untasked` のように鎖が3段になるものもある。

set -euo pipefail

KIND="${1:?種類を渡す（new-task / review / review-untasked / resume / other）}"
ISSUE="${BRAKE_ISSUE:-1515}"

# 種類 → 「投入する」の下に続く見出しの鎖。**どれか1つでも外れていれば止まる。**
case "$KIND" in
new-task) chain=('新しいタスク') ;;
review) chain=('レビュー') ;;
review-untasked) chain=('レビュー' 'task を持たないPRも読む') ;;
resume) chain=('直しの再開') ;;
other) chain=('その他のエージェント') ;;
*)
  echo "UNKNOWN 知らない種類: $KIND"
  exit 1
  ;;
esac

if ! body=$(gh issue view "$ISSUE" --json body -q .body 2>/dev/null); then
  echo "UNKNOWN 手綱の issue #$ISSUE を引けなかった"
  exit 1
fi

# `## 手綱` から次の `## ` の手前まで。節の外に書かれたチェックボックスは見ない。
section=$(printf '%s\n' "$body" | tr -d '\r' |
  awk '/^## 手綱$/ { inside = 1; next } /^## / { inside = 0 } inside')

# 親と子で、`- [x]` の前の字下げが違う。**字下げでは見分けない**（人が編集する場所なので崩れる）
# ——見出しの語で引く。同じ語は他に出てこない。
for want in '投入する' "${chain[@]}"; do
  line=$(printf '%s\n' "$section" | grep -F -m1 -- "$want" || true)
  if [ -z "$line" ]; then
    echo "UNKNOWN 手綱の「$want」の行が見つからない"
    exit 1
  fi
  case "$line" in
  *'- [x]'* | *'- [X]'*) ;;
  *'- [ ]'*)
    echo "STOP $want"
    exit 1
    ;;
  *)
    echo "UNKNOWN 手綱の「$want」の行がチェックボックスではない"
    exit 1
    ;;
  esac
done

echo GO
