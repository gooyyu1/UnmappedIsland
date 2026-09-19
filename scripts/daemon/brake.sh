#!/usr/bin/env bash
# 手綱の issue を読んで、その種類を流してよいかを答える。**答えるのは「モデルを使わせてよいか」**
# ——立てる周も、止まったセッションを起こす周も、同じこれに訊く（[`may-spend.sh`](may-spend.sh)）。
#
#   bash scripts/daemon/brake.sh new-task
#   bash scripts/daemon/brake.sh review
#   bash scripts/daemon/brake.sh review-untasked   # `Closes` 先に `kind:task` が無いPRのレビュー
#   bash scripts/daemon/brake.sh resume
#   bash scripts/daemon/brake.sh other
#   bash scripts/daemon/brake.sh values            # 値の死を告げに行く投入（下の「読めない周だけ」）
#
# 出力は次のどれか。**終了コードが0なのは `GO` のときだけ**（[`occupancy.sh`](occupancy.sh) と
# 同じ向き。読めなかったときに止まる側へ倒すのを、呼び手ではなくここが引き受ける）。
#
#   GO        … 終了コード 0
#   STOP <外れている行の見出し>   … 終了コード 3
#   UNKNOWN <理由>                … 終了コード 1
#
# **`STOP` だけ別の終了コードを持つのは、人が止めていることを呼び手が見分けるため**
# （[`board-design.md`](../../agent-ops/board-design.md) 2.21.2節）。1周を回す側はこれを見て、
# **打てなかった手のうち直す相手が居ないものを、ログでそう名乗らせる**
# （[`board-round.mjs`](board-round.mjs) の `SETTLED`）——そのログを毎回読むのは盤面を見回る係で、
# **区別が消えると、人が止めているだけの周を毎回調べに行く。** 理由を言えるのはここしか居ないので、
# 後から状態を見て推し量るのではなく、止めた側がその場で名乗る
# （[`policies.md`](../../agent-ops/policies.md)「理由の持たせ方」）。**読めなかった（`UNKNOWN`）は
# 直す相手が要る側**——手綱が読めないこと自体が、誰かが直すべき状態だから。
#
# **外の道具が転んだ `UNKNOWN` には、その標準エラーを同じ行へ載せる**
# （[`archive-session.sh`](archive-session.sh) の `DIRTY` と同じ形）。「引けなかった」だけでは、
# 権限が足りないのか相手が居ないのか通信が落ちたのかへ辿り着けず、読んだ側は同じコマンドを手で
# 打ち直すところから始めることになる。**出力は1行**なので、改行は空白へ畳む。
#
# 掛かるのは**モデルの使用量を食うところ**だけ。マージやラベルは止めない
# （[`board-design.md`](../../agent-ops/board-design.md) 2.4節）。走っているセッションにも触らない。
#
# ## 行の文字列で見分ける
#
# 置き場は issue のチェックボックスで、書くのは人間（スマホから1タップ）。**GitHub の側に
# 「一時停止」に当たる状態が無い**ので自前の規約になる。読む側がここ1つ・書く側が人間1人で、
# 読めないときは止まる側へ倒すので、規約が揺れても壊れる先は安全側に限られる。
#
# **ここのチェックは設定で、答えではない**（分類は `kind:switch`。
# [`board-design.md`](../../agent-ops/board-design.md) 2.17.5節）。だから
# [`checked-items.sh`](../agent/checked-items.sh) は拾わない——拾うと、誰も下ろさない項目が `## 確定待ち` に
# 居座る。
#
# 見るのは `## 手綱` 節の中だけ。**種類は、根から自分までの見出しの鎖に対応する**——どれか1つでも
# 外れていれば止まる。「投入する」が全部の根で、`review-untasked` のように鎖が3段になるものもある。
#
# ## 読めない周に止まらない種類が1つある（`values`）
#
# **手綱を読む手は `gh`。** 値の見回り（[`check-values.mjs`](check-values.mjs)）が告げに行くのは
# **`gh` が死んでいる周だけ**なので、ここで「読めない＝止まる」へ倒すと、**いちばん告げてほしい周に
# だけ立たない**（[`board-design.md`](../../agent-ops/board-design.md) 2.22.3節。2.22.1 が見回りを1周の
# 外へ置いたのと同じ理由）。
#
# **人が止められることは失われない**（2.4.1）。鎖は `other` と同じ「その他のエージェント」で、
# **読める周は外れていれば止まる**——読めない周には、外したかどうかを知る手が誰にも無い。
# **倒す向きが変わるのはここだけ**で、余力（[`headroom.sh`](headroom.sh)）も占有
# （[`occupancy.sh`](occupancy.sh)）も、他の種類と同じものを通る。

set -euo pipefail

KIND="${1:?種類を渡す（new-task / review / review-untasked / resume / other / values）}"
ISSUE="${BRAKE_ISSUE:-1515}"

# 種類 → 「投入する」の下に続く見出しの鎖。**どれか1つでも外れていれば止まる。**
case "$KIND" in
new-task) chain=('新しいタスク') ;;
review) chain=('レビュー') ;;
review-untasked) chain=('レビュー' 'task を持たないPRも読む') ;;
resume) chain=('直しの再開') ;;
other | values) chain=('その他のエージェント') ;;
*)
  echo "UNKNOWN 知らない種類: $KIND"
  exit 1
  ;;
esac

# 引けなかった理由は標準エラーに在るが、この `gh` は**標準出力が値**なので、混ぜずに受ける。
stderr=$(mktemp)
if ! body=$(gh issue view "$ISSUE" --json body -q .body 2>"$stderr"); then
  err=$(cat "$stderr")
  rm -f "$stderr"
  # **`values` だけは流す**（上の「読めない周に止まらない種類が1つある」）。**標準出力は `GO` の
  # まま**で、流した理由は標準エラーへ——読み手（[`may-spend.sh`](may-spend.sh)）は通った周の出力を
  # 捨てるので、ここへ載せると誰にも届かない。デーモンの標準エラーは `~/daemon.log` に残る。
  if [ "$KIND" = 'values' ]; then
    echo "手綱を読めないまま流す（値の死を告げる投入）: ${err//$'\n'/ }" >&2
    echo GO
    exit 0
  fi
  echo "UNKNOWN 手綱の issue #$ISSUE を引けなかった: ${err//$'\n'/ }"
  exit 1
fi
rm -f "$stderr"

# `## 手綱` から次の `## ` の手前まで。節の外に書かれたチェックボックスは見ない。
# **`awk` が `$` で留めるので、行末の `\r` は先に落とす**（[`tidy-merged-pr.sh`](tidy-merged-pr.sh)
# の「`\r` を落とす側と落とさない側」）。
body="${body//$'\r'/}"
section=$(printf '%s\n' "$body" |
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
    exit 3
    ;;
  *)
    echo "UNKNOWN 手綱の「$want」の行がチェックボックスではない"
    exit 1
    ;;
  esac
done

echo GO
