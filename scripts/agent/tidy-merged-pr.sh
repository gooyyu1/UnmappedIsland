#!/usr/bin/env bash
# マージ済みのPRを1本、後片付けする。**マージした手からは切り離してある**——誰がマージしたかを
# 見ないので、ユーザーがGitHubの画面から入れても、デーモンが [`merge-pr.sh`](merge-pr.sh) で入れても、
# 同じ1回が走る。打つのは盤面で、**マージ済みのPRを見つけた周に1回だけ**
# （[`board-move.mjs`](board-move.mjs) の `TIDY`）。
#
#   bash scripts/agent/tidy-merged-pr.sh 1036
#
# 出力は1行1件。
#   MENDED    <PR番号>              … 積まれていたPRを、理由を残して書いた本人へ差し戻した
#   UNMENDED  <PR番号>: <理由>      … その差し戻しに失敗した（`直し待ち` が付いていない）
#   UNSTACKED <PR番号>: <理由>      … 積まれていたPRを引けなかった（差し戻せていない）
#   CLOSED    <issue番号>           … PR本文の `Closes #N` が閉じたことの確認
#   OPEN      <issue番号>           … 閉じるはずが開いたまま（`Closes` の書き方を疑う）
#   SYNCED    <コミット>            … 本体のチェックアウトを新しい `main` へ進めた
#   INSTALLED                       … 依存が変わったので本体で `npm install` した
#   DIRTY     <本体のパス>: <理由>  … 本体に未コミットの変更があるので触らなかった
#   終了コード 0 … すべて片付いた
#   終了コード 1 … マージ済みのPRではない（何もしていない）
#   終了コード 2 … 後片付けに残りがある（上の `UNMENDED`・`UNSTACKED`・`OPEN`・`DIRTY`）
#
# ## 後片付けの残りは、`<タグ> <対象>: <理由>` で出す
#
# 残りの行にタグと対象だけを載せると、読んだ側は**片付かなかった事実しか受け取れない**——権限が
# 足りないのか、参照がもう無いのか、GitHubが断ったのかへ辿り着けず、同じコマンドを手で打ち直すところ
# から始めることになる。理由を持っているのは打った側（`gh` の標準エラー・`git status` の中身）なので、
# 捨てずに同じ行へ載せる（[`archive-session.sh`](archive-session.sh) の `DIRTY` と同じ形。issue #1557
# では、パスだけの行を読んだ側が実際に誤読した）。**出力は1行1件**なので、改行は空白へ畳む。
#
# ## GitHub が肩代わりするもの
#
# **マージ済みブランチの削除と、上に積まれたPRの base の張り替えは、ここでは打たない。** どちらも
# GitHub 自身がマージの時点で済ませる（2026-09-10 に、使い捨てのPRを素の squash でマージして確認した
# ——`delete_branch_on_merge` が真なのでブランチは数秒で消え、積まれていたPRは
# `automatic_base_change_succeeded` が付いて base が下のPRの base へ移り、開いたまま残った）。
# **画面からのマージでも同じ**なので、ここが打ち直す先はもう無い。
#
# ## 張り替わったPRは、書いた本人へ差し戻す
#
# **GitHub が肩代わりするのは張り替えだけ。** squash マージでは下のPRのコミットが `main` の履歴に
# 入らず merge-base が動かないので、**張り替わった後も上のPRの差分には下のぶんが混ざったまま**で、
# CIも古い base で得た緑のまま（base の変更では再実行されない）。**解けるのは、上のPRのブランチが
# `main` の上へ載せ直されたとき。**
#
# **だから張り替わったPRは、`直し待ち` を付けてなぜ差し戻したかをコメントで残す。** 盤面は既存の
# `mend` でそのセッションを起こす（[`board-move.mjs`](board-move.mjs)）。載せ直して push すれば
# [`board-labels.yml`](../../.github/workflows/board-labels.yml) の `synchronized` が判定のラベルを
# 外し、CIも走り直すので、そこから先は普通のPRと同じ道を通る。**差し戻さずに置くと、base が `main`
# になったぶん盤面は普通に捌きにかかり、混ざった差分が古い緑のままマージ候補になる。**
#
# **デーモンは載せ直さない。** 他人のブランチへの force push になるので、履歴を書き換えるのは書いた
# 本人だけ。
#
# **探すのは `--base <ブランチ>` ではない。** 張り替えるのが GitHub なので、ここが走る頃には base は
# もう `main` へ移っていて、そのブランチを base にしたPRは1本も引けない。代わりに**張り替えの記録**
# （`AutomaticBaseChangeSucceededEvent` の `oldBase`）がこのPRのブランチを指しているものを引く。
#
# **押し返された後は差し戻さない。** 記録は載せ直しても消えないので、**張り替えより後に押された
# 先頭コミットが在るなら、もう本人が動いた後**。`直し待ち` が既に付いているものも同じ理由で飛ばす
# （二度目のコメントは何も足さない）。
#
# ## `\r` を落とす側と落とさない側
#
# **`\r` が乗る経路は2つ。どちらも行末にだけ乗る。**
#
# - **Windowsの外部 jq が複数行を出すとき。** 標準出力をテキストモードで開くので、行の区切りが
#   CRLF になる。`$(…)` が落とすのは**最後の1行ぶんだけ**なので、綺麗なのは末尾で、汚れているのは
#   その手前まで——先頭行だけを取る経路も安全ではない。
#
#       $ y=$(jq -rn '"A","B"'); printf '%s' "$y" | od -c   →   A  \r  \n   B
#       $ x=$(jq -rn '"OPEN"');  printf '%s' "$x" | od -c   →   O  P  E  N
#
#   1つの値しか出さない `$(jq …)` に乗らないのは、Windowsの bash（MSYS2）が末尾の `\r\n` を丸ごと
#   落とすため。Linuxの jq は `\r` を出さないので、この経路が効くのはWindowsだけ。`gh` の `--jq` は
#   gh 内蔵なので、Windowsでも LF。
#
# - **中身そのものが CRLF のとき。** GitHubの画面で編集された issue・PRの本文がこれで、
#   **どのOSで動かしても乗る。**
#
# **落とすかどうかは、乗る経路ではなく受け手で決まる。** 判定はLinuxの側で置く——`\r` を行の
# 終わりとして扱う道具がMSYS2には在るが、両方で動かすので緩いほうへは寄せられない。
#
# - **落とす。** シェルが `$(…)`・`read` で受けた行を、そのまま次の道具へ食わせるとき。
#   `sort` で突き合わせるとき（`\r` 込みで重複を見る）。`awk` で `$` に留めるとき——**Linuxの `awk` は
#   `\r` を行の中身として残す**ので、見出しに当たらない（[`brake.sh`](brake.sh) が `## 手綱` の節を
#   引く形）。同じ理由で `grep -x` も当たらない。
# - **落とさない。** `grep -o` で数字や識別子を抜き出すとき。`\r` は抜き出す側に入らない
#   （下の `Closes` の番号を拾う形と、[`dispatch-review.sh`](dispatch-review.sh) の同じ形）。
#
# **落とし方は、値が変数へ入っているなら `${var//$'\r'/}`。** 外部の `tr` を起こす必要は無い。
# パイプを流れているものだけが `| tr -d '\r' |` を要る（[`checked-items.sh`](checked-items.sh)）。
#
# ## セッションを畳むのは、ここではない
#
# **PRをマージしたかと、そのために立てたセッションを畳んでよいかは別の問い**（出どころ: ユーザーの
# 指示・2026-09-05。[`board-design.md`](../../.claude/board-design.md) 2.10）。畳むのは盤面が毎周
# 見て打つ。
#
# ## 本体を追随させるのは、ここでしかできないから
#
# 作業ツリーは `<repo>/.claude/worktrees/` に置かれる。**リポジトリの中なので、Node も npm も親を
# 遡って本体の `node_modules` を見つけ、そのまま共有する。** 本体のチェックアウトが古いと、
# 共有しているのに版が食い違う——`Cannot find module` にはならず、**古い版が解決されて一部だけ
# 壊れる**（本体が `ajv` 8 を持たず eslint 由来の 6 だけ在り、テスト1本が落ちた実例がある）。
#
# 誰も本体では作業しないので、本体が自分から追いつくことはない。**`main` が動いたことを盤面が知る
# のは、マージ済みのPRを見つけたとき**なので、ここで一緒に進める。マージ以外で `main` が動いたぶん
# （`.claude/**` の直接 push・`DIRTY` で寄せられなかった周）は、デーモンを立て直すときに
# [`daemon.sh`](daemon.sh) が寄せる。
#
# 本体でブランチは持たない（detached HEAD）。`main` は同時に2箇所へチェックアウトできず、本体が
# 握ると作業ツリーが作れなくなる。detached は「固定」ではなく、ブランチ名を挟まずにコミットを
# 直接指す形で、進めるたびに指す先を新しい `main` へ付け替える。

set -euo pipefail

PR="${1:?PRの番号を渡す（例: 1036）}"

# `%/*` は区切りが無いと文字列をそのまま返す。
HERE="${BASH_SOURCE[0]%/*}"
if [[ "$HERE" == "${BASH_SOURCE[0]}" ]]; then HERE='.'; fi
HERE="$(cd "$HERE" && pwd)"

# **PRは1回だけ引く。** 項目ごとに `gh pr view` を打つと、その数だけ往復が増えるうえ、**項目ごとに
# 見ている時点がずれる**。
pr=$(gh pr view "$PR" --json body,state,headRefName)
state=$(jq -r '.state' <<<"$pr")
if [ "$state" != "MERGED" ]; then
  echo "マージされていない（state=$state）" >&2
  exit 1
fi
body=$(jq -r '.body // ""' <<<"$pr")
head=$(jq -r '.headRefName' <<<"$pr")

leftover=0

# 後片付けの残りを1件出す（上の「後片付けの残りは…」）。**この行を出したぶんの `leftover` もここで
# 立てる**——出した側の仕事にすると、立て忘れたぶんが片付いていないのに終了コード 0 で返る。
unfinished() {
  echo "$1 $2: ${3//$'\n'/ }"
  leftover=1
}

# 張り替えの記録と、押し返されたかを見るための先頭コミットの時刻、既に差し戻されているかを見る
# ラベルを、開いているPRぶん1回で引く（上の「張り替わったPRは…」）。
STACKED_QUERY='query($owner:String!,$name:String!){repository(owner:$owner,name:$name)'\
'{pullRequests(states:OPEN,first:100){nodes{number labels(first:20){nodes{name}}'\
' commits(last:1){nodes{commit{committedDate}}}'\
' timelineItems(itemTypes:[AUTOMATIC_BASE_CHANGE_SUCCEEDED_EVENT],last:1)'\
'{nodes{... on AutomaticBaseChangeSucceededEvent{oldBase createdAt}}}}}}}'

# 引けなかった理由は標準エラーに在るが、この `gh` は**標準出力が値**なので、混ぜずに受ける。
stderr="$(mktemp)"
if stacked=$(gh api graphql -f "query=$STACKED_QUERY" -F owner='{owner}' -F name='{repo}' --jq "
  .data.repository.pullRequests.nodes[]
  | select((.timelineItems.nodes | last | .oldBase) == \"$head\")
  | select((.timelineItems.nodes | last | .createdAt) > (.commits.nodes | last | .commit.committedDate))
  | select(([.labels.nodes[].name] | index(\"直し待ち\")) == null)
  | .number" 2>"$stderr"); then
  # 差し戻す理由は、起こされた本人がPRを見て分かるものではない（コンフリクトもCIの赤もレビューの
  # 指摘も無い）ので、ここで書き残す。**差し戻すPR全部に同じ文面**なので、1回だけ組む。
  note="$(mktemp)"
  {
    echo "[デーモン] **下の PR #$PR がマージされ、GitHub がこのPRの base を張り替えました。**"
    echo
    echo 'squash マージでは下のコミットが `main` の履歴に入らないので、**張り替わっただけでは差分に'
    echo '下のぶんが混ざったまま**で、CIも古い base で得た緑のままです。'
    echo
    echo '`origin/main` の上へ載せ直して push してください。push すれば判定のラベルが外れ、CIも'
    echo '走り直します。'
  } >"$note"
  while read -r other; do
    [ -n "$other" ] || continue
    # 理由を残せなければラベルも付けない（`UNMENDED` は「`直し待ち` が付いていない」と同じ意味に
    # しておく）。**盤面はこのPRを普通に捌きにかかる**——ここで出せるのは「差し戻せなかった」までで、
    # 混ざった差分がレビューへ出るのは止められない。
    if err=$(gh pr comment "$other" --body-file "$note" 2>&1 >/dev/null) &&
      err=$(gh pr edit "$other" --add-label 直し待ち 2>&1 >/dev/null); then
      echo "MENDED $other"
      continue
    fi
    unfinished UNMENDED "$other" "$err"
  done <<<"$stacked"
  rm -f "$note"
else
  unfinished UNSTACKED "$PR" "$(cat "$stderr")"
fi
rm -f "$stderr"

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

# 本体は作業ツリーの共有先なので、進める前に汚れていないことを見る。**未追跡は数え上げない**
# ——妨げになるかは、進める先に同じパスが在るかで決まるので、判定は `checkout` 自身に任せる。
#
# **その `checkout` の失敗も `DIRTY` で受ける。** `set -e` へ落とすと、既に済んだ `MENDED`・`CLOSED`
# ごと「打てなかった」の一語になり、盤面は覚えを残さないので**毎周同じところまで打ち直し続ける**
# （[`board-move.mjs`](board-move.mjs) の `TIDY` が覚えるのは、終了コード 0 と 2 だけ）。
main_dir="$(cd "$HERE" && cd "$(git rev-parse --git-common-dir)/.." && pwd)"
if changes=$(git -C "$main_dir" status --porcelain --untracked-files=no) && [ -n "$changes" ]; then
  unfinished DIRTY "$main_dir" "$changes"
else
  before=$(git -C "$main_dir" rev-parse HEAD:package-lock.json)
  git -C "$main_dir" fetch --quiet origin main
  if ! err=$(git -C "$main_dir" checkout --quiet --detach origin/main 2>&1); then
    unfinished DIRTY "$main_dir" "$err"
  else
    echo "SYNCED $(git -C "$main_dir" rev-parse --short HEAD)"
    # 依存が変わったときだけ入れ直す。`npm install` の最中は共有先が揺れるので、毎回は打たない
    # （直近30日で `package-lock.json` を触ったコミットは1572件中3件）。
    if [ "$before" != "$(git -C "$main_dir" rev-parse HEAD:package-lock.json)" ] ||
      [ ! -e "$main_dir/node_modules/.package-lock.json" ]; then
      (cd "$main_dir" && npm install --no-fund --no-audit)
      echo "INSTALLED"
    fi
  fi
fi

exit "$([ "$leftover" -eq 0 ] && echo 0 || echo 2)"
