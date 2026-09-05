#!/usr/bin/env bash
# レビューのCCRセッションを畳む。**残っているものを全部見る**——PRの番号は取らない。
#
#   bash scripts/agent/archive-reviews.sh
#
# **ここが決めるのは「どれがレビューか」と「走行中を守るか」**で、畳んでよいかの判定と出力は
# [`archive-session.sh`](archive-session.sh) が持つ。対象が無ければ何も出さない。
# **引けなくても畳めなくても終了コードは0**——呼び手（投入・マージ）の本題は別にあるので、
# 後片付けで落とさない。
#
# ## 1本のPRだけを掃くと、行き止まりのPRのぶんが永久に残る
#
# レビューのセッションは issue を持たないので、ワーカーと同じ引き方（担当の issue から辿る）が
# できない。`review-<PR番号>` のタグだけが手掛かりで、これは
# [`dispatch-review.sh`](dispatch-review.sh) が必ず付ける。
#
# 呼ぶ場所は2つあり、どちらも「もう起こされない」が確定した瞬間。
#
# - `dispatch-review.sh` が**次を立てる直前**。レビューは使い回さない設計（あちらの「再レビューでも、
#   前のセッションを起こさずに新しく立てる」）なので、次を立てる時点で前の分は終わっている。
# - `merge-and-close.sh` が**マージした後**。PRが閉じれば、最後の1本も読む相手が無くなる。
#
# **この2つは、そのPRにこの先どちらかが起きることを当てにしている。** ところが `判断待ち` で
# ユーザーの手番に入ったPRと、`直し待ち` のまま戻ってこないPRには、次の投入もマージも来ない。
# 掃く範囲をそのPR1本に絞っていたので、**行き止まりのPRのレビューだけが溜まり続けた**
# （2026-08-30 に16本。ユーザーからの指摘で気づいた）。
#
# だから範囲を「残っているレビュー全部」にする。**畳める理由はPRごとに違わない**——どのレビューも
# 使い回さない設計なので、走り終わった時点でもう誰も起こさない。他のPRのついでに掃かれるので、
# 行き止まりのPRも次に何かが1件マージされれば片付く。
#
# ## 「読み終えたか」は状態では判定できない
#
# 走行中かどうかは分かる（`session_status`。[`board-design.md`](../../.claude/board-design.md) 1.6）が、**知りたいのは
# 「読み終えたか」で、それは待機中の中身にある**——「判定を書き終えた」も「こちらの追加指示を
# 待っている」も待機中に落ちる。
# だから**どれを渡すか**を選ぶのはタグだけ
# （`.claude/parallel-work.md`「終わったセッションは、issue を鍵にして畳む」の、状態で判定しない）。
# 渡した後に走行中を除くのは別の問いで、`archive-session.sh` が見る。

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 試験は差し替える（パスで呼ぶため PATH では差し替わらない）。
CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}"

# 応答は `<other-session>` の包みに入って返るので、中のJSONだけ取り出す。引けないときは `grep` が
# 1 を返す。`pipefail` があるので、ここで止めずに空として受ける。
#
# **`tr -d '\r'` が要るのは、複数行を出して、その行を「シェルが」受け取るとき。** Windowsの外部 jq は
# 標準出力をテキストモードで開くので、行の区切りが CRLF になる。**`\r` が残るのは各行の末尾**で、
# `$(…)` が落とすのはそのうち**最後の1行ぶんだけ**。ここでは `read` が拾って `archive_session` へ
# 渡すので、JSON として壊れる（`Bad control character in string literal`）。
#
#   $ y=$(jq -rn '"A","B"'); printf '%s' "$y" | od -c   →   A  \r  \n   B
#
# 綺麗なのは最後の1行で、汚れているのはその手前まで——先頭行だけを取る経路も安全ではない。
#
# **要らない側が2つある。**
#
# - **1つの値しか出さない `$(jq …)`。** Windowsの bash（MSYS2）は、末尾の `\r\n` を丸ごと落とす。
#
#       $ x=$(jq -rn '"OPEN"'); printf '%s' "$x" | od -c   →   O   P   E   N
#
# - **複数行でも、受け取るのが `grep`・`awk` だけのとき。** MSYS2 のこの2つは `\r\n` を行の終わりとして
#   扱う（`printf 'A\r\nB' | grep -qx A` は当たる）。`grep -o` で数字や識別子だけを抜き出す使い方も、
#   `\r` は抜き出す側に入らない。`board.sh` に `tr` の無い `$(jq …)` があるのは
#   これで、**シェルが行を受け取る箇所（`read`・値の比較・正規表現への埋め込み）にだけ付いている。**
#
# **この「丸ごと落とす」はWindowsの bash だけ**で、Linuxでは末尾の `\r` が残る。ただしLinuxの jq は
# `\r` を出さないので、どちらでも同じ結果になる。`gh` の `--jq` は gh 内蔵なので、Windowsでも LF。
# 無条件に掛けると、要る理由が読めなくなる。
#
# 1行が `<PR番号> <セッションID>`。番号は下で開いているPRと突き合わせる。
#
# **`list_sessions` は直近の1ページしか返さない。** `limit` の上限は100で、それを超える分は
# `has_more` と `last_id` を使って繰らないと届かない。**1ページで済ませると、古いものほど掃かれない**
# ——2026-08-30 の時点で全715件・8ページあり、1ページ目（その日の午前2時まで）に見えていた生きた
# レビューは4本、繰った先に35本残っていた。1本ずつ掃いていた頃は、掃く相手が直近に居るのが普通
# だったので露見しなかった。
#
# **畳み済みをここで外すのは、渡す数を減らすためだけ。** 畳んでよいかの判定は
# `archive-session.sh` が持つ（あちらも畳み済みには何も出さない）ので、外さなくても結果は同じ。
# ただし掃く範囲を全部へ広げた以上、**畳み終えたものは減らずに溜まる**——同じ時点で `review-*` は
# 全体の1割強あり、その大半が畳み済みだった。全部渡すと、その数だけ `get_session` を打つ。
sessions=''
after=''
while :; do
  if [ -z "$after" ]; then
    req='{"mine":true,"limit":100}'
  else
    req=$(printf '{"mine":true,"limit":100,"after_id":"%s"}' "$after")
  fi
  page=$(bash "$CCR_META" list_sessions <<<"$req" | grep -o '{"ccr".*' || true)
  [ -n "$page" ] || break
  found=$(jq -r '.ccr.data[]?
    | select(.session_status != "SESSION_STATUS_ARCHIVED")
    | . as $s
    | .tags[]?
    | select(startswith("review-"))
    | "\(ltrimstr("review-")) \($s.id)"' <<<"$page" | tr -d '\r' || true)
  [ -z "$found" ] || sessions=$(printf '%s\n%s' "$sessions" "$found")
  [ "$(jq -r '.ccr.has_more // false' <<<"$page")" = true ] || break
  after=$(jq -r '.ccr.last_id // ""' <<<"$page" | tr -d '\r')
  [ -n "$after" ] || break
done

# 畳んでよいかの判定は [`archive-session.sh`](archive-session.sh) が持つ。ここが選ぶのはタグと、
# **走行中を守るかどうか**だけ。
#
# 守るのは**PRがまだ開いているとき**。閉じた（マージされた）PRのレビューは、判定を書き終えても読む
# 相手が無いうえ、**上の2つの出来事はどちらも二度と起きない**——次のレビューは投入されず、次のマージも
# 無い。守ると `KEPT` のまま誰にも渡されずに残り、`archive-reviews.sh` を入れる前の状態（72本）へ
# 戻る（デーモンが起こすのは `task-` のタグを持つセッションだけなので、盤面にも出ない）。
#
# **状態を引けなかったときは守る側へ倒す。** 畳んで消えた判定は戻せないが、守って残ったものは手で
# 畳める。畳むのは「閉じていると分かったとき」だけにするので、一覧を引けなければ全部を開いている
# 側として扱う。**「引けなかった」と「1本も開いていない」は終了コードで分ける**——空かどうかで
# 分けると、最後の1本をマージした直後（開いているPRが0本）が引けなかった日と同じ扱いになり、
# そのPRのレビューが `KEPT` のまま誰にも渡されずに残る。
#
# 番号ごとに `gh pr view` を打たずに一覧を1回で引くのは、掃く範囲を全部へ広げたため。開いていると
# 分かった番号だけを集め、それ以外（閉じた・マージ済み・一覧の外）は閉じている側にする。
if open_prs=$(gh pr list --state open --limit 200 --json number --jq '.[].number'); then
  keep_all=0
else
  open_prs=''
  keep_all=1
fi

split=$(printf '%s\n' "$sessions" |
  awk -v open="$(printf '%s' "$open_prs" | tr -d '\r' | tr '\n' ' ')" -v keep_all="$keep_all" '
    BEGIN { split(open, a, " "); for (i in a) if (a[i] != "") is_open[a[i]] = 1 }
    NF == 2 { print (keep_all == 1 || ($1 in is_open) ? "open" : "closed"), $2 }')

printf '%s\n' "$split" | awk '$1 == "open" { print $2 }' |
  CCR_META="$CCR_META" bash "$HERE/archive-session.sh" --keep-working
printf '%s\n' "$split" | awk '$1 == "closed" { print $2 }' |
  CCR_META="$CCR_META" bash "$HERE/archive-session.sh"
