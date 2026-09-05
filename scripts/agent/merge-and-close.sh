#!/usr/bin/env bash
# PRをマージして、後片付けまで済ませる。**判断は1つも無い**——見張りが `GREEN` を出し、レビューの
# セッションが `通してよい` を返した後に叩く、決まりきった手順だけをまとめてある。
#
#   bash scripts/agent/merge-and-close.sh 1036
#   bash scripts/agent/merge-and-close.sh 1036 --user-ok   … 関門をユーザーの許可で越える
#
# 出力は1行1件。
#   HELD     <PR番号>              … 関門に掛かった。マージしていない（理由が続けて出る）
#   MERGED   <PR番号>
#   RETARGETED <PR番号>            … このPRの上に積まれていたPRの base を `main` へ張り替えた
#   UNRETARGETED <PR番号>          … その張り替えに失敗した。ブランチは消していない
#   UNDELETED <ブランチ>            … マージ済みのブランチを消せなかった
#   RELAY    <PR番号>              … 本文かレビューの `## ユーザーへ` に中身があるので `ユーザーへ` を付けた
#   UNRELAYED <PR番号>              … その印を付けようとして失敗した
#   CLOSED   <issue番号>            … PR本文の `Closes #N` が閉じたことの確認
#   OPEN     <issue番号>            … 閉じるはずが開いたまま（`Closes` の書き方を疑う）
#   ARCHIVED <セッションID>         … 残っていたレビューのセッションを畳んだ（下の「ワーカーを畳むのは…」）
#   KEPT     <セッションID>         … 畳まなかった。まだ読んでいる最中か、ブリッジのものか、
#                                     `get_session` を引けなくて素性が分からなかったもの（最後のものは
#                                     **もう渡す出来事が無い**ので、ユーザーが引き直して手で畳む）
#   UNARCHIVED <セッションID>       … 畳もうとして失敗した
#   SYNCED   <コミット>             … 本体のチェックアウトを新しい `main` へ進めた
#   INSTALLED                       … 依存が変わったので本体で `npm install` した
#   DIRTY    <本体のパス>           … 本体に未コミットの変更があるので触らなかった
#   終了コード 0 … すべて片付いた
#   終了コード 1 … マージできなかった（何もしていない。関門を含む）
#   終了コード 2 … マージはしたが、後片付けに残りがある
#                  （上の `UNRETARGETED`・`UNDELETED`・`OPEN`・`UNARCHIVED`・`UNRELAYED`・`DIRTY`）
#
# ## 積まれたPRは、ブランチを消す前に `main` へ下ろす
#
# **base のブランチが消えると GitHub は上のPRを勝手に閉じ、しかも base の無い状態では reopen も
# base の張り替えもできない**（"Cannot change the base branch of a closed pull request"）。逃げ道は
# 「消えた base を一時的に復元 → reopen → base を `main` へ → 復元を削除」で、全部が人の手になる。
# #1493 → #1508 で実際に起きた。**デーモンが無人でマージするので、気づく人が居ない。**
#
# そこで `--delete-branch` を使わず、**マージ → 張り替え → ブランチ削除**の順で打つ。張り替えを
# マージの後に置くのは、**マージが失敗したときに、張り替えだけが済んだ状態を残さないため**。
# 張り替えられなかったぶんはブランチを残す（`UNRETARGETED`）——base が在るかぎり、後から手でも
# 直せる。
#
# **張り替えが防ぐのは自動クローズだけ。** squash マージでは下のPRのコミットが `main` の履歴に入らず
# merge-base が動かないので、**張り替えた後も上のPRの差分には下のぶんが混ざったまま**で、CIも古い
# base で得た緑のまま（base の変更では再実行されない）。**解けるのは、上のPRのブランチが `main` の
# 上へ載せ直されたとき。**
#
# ## 関門（`needs-user-review.sh`）は、この道具では越えられない
#
# 宣言文法・スキーマ・確定の宣言（節の `【確定】` と、文書単位の `**本書は全体が確定です。**`）に
# 触るPRは、**ユーザー以外の判断ではマージしない**。
# [`needs-user-review.sh`](needs-user-review.sh) が該当を出したら `判断待ち` を付けて `HELD` で止め、
# ユーザーへ回す。越えるにはユーザーの許可を引いて `--user-ok` を付けて叩き直す——**そのとき許可を
# 受けたことをPRへコメントとして残す**ので、後からどのPRが誰の許可で通ったのかを辿れる。
#
# **自動では越えられない関門にしてあるのは、越えられる関門は越えるから。** 直近25本で
# `## 仮決め` に中身のあったPRが22本、`判断待ち` が付いたのは0本だった。
#
# ## 畳んだのは、毎回同じ順で叩いていた手順
#
# `gh pr merge` → PRが `MERGED` か確認 → `Closes` の issue が `CLOSED` か確認 → 結果の報告。
# **どれも判断が無いのに、叩く側の文脈を1往復ずつ食う。** レビューは既に済んでいるので、ここから
# 先を1回にまとめる。
#
# ## ワーカーを畳むのは、ここではない
#
# **PRをマージしたかと、書いたワーカーを畳んでよいかは別の問い**（出どころ: ユーザーの指示・
# 2026-09-05。[`board-design.md`](../../.claude/board-design.md) 2.10）。畳む条件は**担当の issue が
# 閉じたこと**で、盤面が毎周見る。ここに繋いでいたときは、**人が画面からマージすると後片付けが
# 一度も走らず**、ワーカーが枠を握ったまま残った（PR #1524）。
#
# **レビューのセッションはここで畳む**（[`archive-reviews.sh`](archive-reviews.sh)）。あちらは issue を
# 持たないので issue では引けず、`review-<PR番号>` のタグで引く。PRが閉じれば読む相手が
# 無くなるので、ここがこのPRの分を畳む最後の場所。**あちらが掃くのはこのPRの分だけではない**
# （残っている `review-*` 全部。理由はあちらの「1本のPRだけを掃くと…」）ので、`直し待ち` や
# `判断待ち` で止まったPRのレビューも、1件マージするたびに一緒に片付く。
#
# ## 本体を追随させるのは、ここでしかできないから
#
# 作業ツリーは `<repo>/.claude/worktrees/` に置かれる。**リポジトリの中なので、Node も npm も親を
# 遡って本体の `node_modules` を見つけ、そのまま共有する。** 本体のチェックアウトが古いと、
# 共有しているのに版が食い違う——`Cannot find module` にはならず、**古い版が解決されて一部だけ
# 壊れる**（本体が `ajv` 8 を持たず eslint 由来の 6 だけ在り、テスト1本が落ちた実例がある）。
#
# 誰も本体では作業しないので、本体が自分から追いつくことはない。**`main` が動くのはマージの瞬間で、
# それを起こしているのがこのスクリプト**だから、ここで一緒に進める。
#
# 本体でブランチは持たない（detached HEAD）。`main` は同時に2箇所へチェックアウトできず、本体が
# 握ると作業ツリーが作れなくなる。detached は「固定」ではなく、ブランチ名を挟まずにコミットを
# 直接指す形で、マージのたびに指す先を新しい `main` へ付け替える。

set -euo pipefail

PR="${1:?PRの番号を渡す（例: 1036）}"
USER_OK=0
[ "${2:-}" != "--user-ok" ] || USER_OK=1

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 試験は差し替える（`gh` は PATH で差し替わるが、これはパスで呼ぶため）。
CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}"
NEEDS_USER_REVIEW="${NEEDS_USER_REVIEW:-$HERE/needs-user-review.sh}"

# **PRは1回だけ引く。** 項目ごとに `gh pr view` を打つと、その数だけ往復が増えるうえ、**項目ごとに
# 見ている時点がずれる**。引き直すのは、**この後の操作で変わるもの**だけ——マージ後の `state` と、
# 打つ直前に見たい `mergeable`。
pr=$(gh pr view "$PR" --json body,state,comments,headRefName)
body=$(jq -r '.body // ""' <<<"$pr" | tr -d '\r')
state=$(jq -r '.state' <<<"$pr")
# ブランチ名はマージでは変わらないので、ここで一緒に受けておく（使うのは後片付けの段）。
head=$(jq -r '.headRefName' <<<"$pr")
# `## ユーザーへ` は、PR本文とレビューのコメントの**両方**に書かれる（`review-prompt.md`）。回す口が
# 2つあるのに読む口が1つだと、**レビューが回したものだけが黙って落ちる**。拾うのは `[レビュー]` で
# 始まるコメントだけで、デーモンの指示やユーザー自身の書き込みは回す側ではない。
#
# **1件を1行の base64 で受ける。** 節を閉じるのは `##` の見出しなので、複数の文書を1本に繋いで読むと
# **末尾に `## ユーザーへ` を置いた文書の節が、次の文書へそのまま伸びる**（レビューの側はこの節を
# **末尾**へ置く。`review-prompt.md` がそう指示しているので、常に起きる）。繋ぎ目へ切れ目の印を
# 挟んでも塞げるが、その綴りは
# 挟む側と閉じる側で一致していないと黙って壊れる。繋がずに1件ずつ読めば、印そのものが要らない。
#
# **`tr -d '\r'` が要るのは、複数行を出して、その行をシェルが受け取るから**（理由は
# [`archive-reviews.sh`](archive-reviews.sh) の同じ注記）。下の `read` が拾うので、残ると
# `base64 -d` が壊れる。
review_comments=$(jq -r '.comments[] | select(.body | startswith("[レビュー]")) | .body | @base64' \
  <<<"$pr" | tr -d '\r')

if [ "$state" = "OPEN" ]; then
  # 関門。**マージの前に見る**——通した後では、印が付いた状態が `main` に入ってしまう。
  reasons=$(bash "$NEEDS_USER_REVIEW" "$PR" 2>&1) && gate=0 || gate=$?
  if [ "$gate" -ne 1 ]; then
    if [ "$USER_OK" -eq 0 ]; then
      echo "HELD $PR"
      echo "$reasons" | sed 's/^/    /'
      gh pr edit "$PR" --add-label 判断待ち >/dev/null
      exit 1
    fi
    note="$(mktemp)"
    {
      echo "[デーモン] **ユーザーの許可を得てマージします。**"
      echo
      echo '`needs-user-review.sh` はこのPRを止めていました。'
      echo
      echo '```'
      echo "$reasons"
      echo '```'
    } >"$note"
    gh pr comment "$PR" --body-file "$note" >/dev/null
    rm -f "$note"
    gh pr edit "$PR" --remove-label 判断待ち >/dev/null 2>&1 || true
  fi

  mergeable=$(gh pr view "$PR" --json mergeable --jq '.mergeable')
  if [ "$mergeable" != "MERGEABLE" ]; then
    echo "マージできない（mergeable=$mergeable）。コンフリクトなら差し戻す。" >&2
    exit 1
  fi
  # ブランチは消さない——上の「積まれたPRは…」の順で、この後に消す。失敗は下の state で捕まえる。
  gh pr merge "$PR" --squash || true
  state=$(gh pr view "$PR" --json state --jq '.state')
fi

if [ "$state" != "MERGED" ]; then
  echo "マージされていない（state=$state）" >&2
  exit 1
fi
echo "MERGED $PR"

leftover=0

# 上に積まれたPRを `main` へ下ろしてから、マージ済みのブランチを消す（上の「積まれたPRは…」）。
# **1本でも下ろせなければ、ブランチを残す。** 引けなかったときも同じ——積まれたPRが在るかどうかが
# 分からないまま消すと、閉じられたPRは機械では戻せない。
retargeted=1
if stacked=$(gh pr list --state open --base "$head" --json number --jq '.[].number'); then
  while read -r other; do
    [ -n "$other" ] || continue
    if gh pr edit "$other" --base main >/dev/null; then
      echo "RETARGETED $other"
    else
      echo "UNRETARGETED $other"
      retargeted=0
    fi
  done <<<"$stacked"
else
  echo "UNRETARGETED $PR"
  retargeted=0
fi
[ "$retargeted" -eq 1 ] || leftover=1
# 既に消えているブランチは、消さない（同じPRへ二度叩いたときに `UNDELETED` が出ないように）。
if [ "$retargeted" -eq 1 ] && gh api "repos/{owner}/{repo}/git/refs/heads/$head" >/dev/null 2>&1; then
  gh api -X DELETE "repos/{owner}/{repo}/git/refs/heads/$head" >/dev/null 2>&1 || {
    echo "UNDELETED $head"
    leftover=1
  }
fi

# `## ユーザーへ` に**中身がある**PRには `ユーザーへ` ラベルを付ける。**下ろすのはユーザーの手番**
# なので、ここでは印を置くだけ。**下ろす側はまだ無い**（[`board-design.md`](../../.claude/board-design.md)
# 3.2。読まれないまま残っても盤面は止まらないので、移行は止めない）。ラベルなので、
# `gh pr list --state merged --label ユーザーへ` でいつでも滞留が見える。
#
# **本文ではなくラベルで持つのは、引くのが安いから。** マージ済みPRは本数が多く、本文を毎周読むと
# 窓を切ることになる——切った窓から出たものは永久に出なくなる。
#
# **見出しの有無では決めない。** `## 仮決め` は「なし」と書かせる規約、こちらは「無ければ節ごと省く」
# 規約なので、書く側は取り違える。中身の無い印が1つ残るだけで `RELAY` が毎周出て、**見張りは合図が
# 1件でも出た時点で終わる**ので、手でラベルを外すまで他の待ちに使えなくなる。
#
# **失敗しても止めない。** マージは済んでいるので、ここで落ちると後片付け（`main` の追随）ごと落ちる。
#
# **節を閉じるのは `##` の見出しと、水平線（`---`）。** 水平線は、レビューのコメントに必ず付く
# Claude Code の署名の頭。閉じないと、レビューが節を末尾へ置いたとき署名の行が中身として残り、
# 「なし」と書いても非空になる。**文書をまたぐ側は閉じるまでもない**——1件ずつ渡すので、文書が
# 終われば節も終わる。
relay_section() {
  awk '/^##[[:space:]]+ユーザーへ[[:space:]]*$/ { inside = 1; next }
    /^##[[:space:]]/ || /^---[[:space:]]*$/ { inside = 0 }
    inside'
}
relay=$({
  relay_section <<<"$body"
  while read -r encoded; do
    [ -n "$encoded" ] || continue
    base64 -d <<<"$encoded" | tr -d '\r' | relay_section
  done <<<"$review_comments"
} | sed -e 's/^[-*[:space:]]*//' -e 's/[[:space:]]*$//' |
  grep -v '^$' | grep -v '^なし' || true)
if [ -n "$relay" ]; then
  if gh pr edit "$PR" --add-label ユーザーへ >/dev/null; then
    echo "RELAY $PR"
  else
    echo "UNRELAYED $PR"
    leftover=1
  fi
fi

# `Closes #123` だけを拾う。番号だけの参照（`#123`）では閉じないので、ここでも見ない。
closes=$(grep -oiE 'closes[[:space:]]+#[0-9]+' <<<"$body" | grep -oE '[0-9]+' | sort -u || true)
while read -r issue; do
  [ -n "$issue" ] || continue
  if [ "$(gh issue view "$issue" --json state --jq '.state')" = "CLOSED" ]; then
    echo "CLOSED $issue"
  else
    echo "OPEN $issue"
    leftover=1
  fi
done <<<"$closes"

# レビューのセッション（上の「ワーカーを畳むのは…」）。畳めなければ `UNARCHIVED` が出るので残りに数える。
reviews=$(CCR_META="$CCR_META" bash "$HERE/archive-reviews.sh")
[ -z "$reviews" ] || printf '%s\n' "$reviews"
if grep -q '^UNARCHIVED ' <<<"$reviews"; then
  leftover=1
fi

# 本体は作業ツリーの共有先なので、進める前に汚れていないことを見る。未追跡は見ない——本体には
# `claude_rc.bat` のような、追跡していない持ち物が置いてある。
main_dir="$(cd "$HERE" && cd "$(git rev-parse --git-common-dir)/.." && pwd)"
if [ -n "$(git -C "$main_dir" status --porcelain --untracked-files=no)" ]; then
  echo "DIRTY $main_dir"
  leftover=1
else
  before=$(git -C "$main_dir" rev-parse HEAD:package-lock.json)
  git -C "$main_dir" fetch --quiet origin main
  git -C "$main_dir" checkout --quiet --detach origin/main
  echo "SYNCED $(git -C "$main_dir" rev-parse --short HEAD)"
  # 依存が変わったときだけ入れ直す。`npm install` の最中は共有先が揺れるので、毎回は打たない
  # （直近30日で `package-lock.json` を触ったコミットは1572件中3件）。
  if [ "$before" != "$(git -C "$main_dir" rev-parse HEAD:package-lock.json)" ] ||
    [ ! -e "$main_dir/node_modules/.package-lock.json" ]; then
    (cd "$main_dir" && npm install --no-fund --no-audit)
    echo "INSTALLED"
  fi
fi

exit "$([ "$leftover" -eq 0 ] && echo 0 || echo 2)"
