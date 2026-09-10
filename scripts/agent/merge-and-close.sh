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
#   UNRETARGETED <PR番号>: <理由>  … その張り替えに失敗した。ブランチは消していない
#   UNMENDED <PR番号>: <理由>      … 張り替えたが、書いた本人へ差し戻せなかった（`直し待ち` が
#                                    付いていない）
#   UNDELETED <ブランチ>: <理由>    … マージ済みのブランチを消せなかった
#   CLOSED   <issue番号>            … PR本文の `Closes #N` が閉じたことの確認
#   OPEN     <issue番号>            … 閉じるはずが開いたまま（`Closes` の書き方を疑う）
#   SYNCED   <コミット>             … 本体のチェックアウトを新しい `main` へ進めた
#   INSTALLED                       … 依存が変わったので本体で `npm install` した
#   DIRTY    <本体のパス>           … 本体に未コミットの変更があるので触らなかった
#   終了コード 0 … すべて片付いた
#   終了コード 1 … マージできなかった（何もしていない。関門を含む）
#   終了コード 2 … マージはしたが、後片付けに残りがある
#                  （上の `UNRETARGETED`・`UNMENDED`・`UNDELETED`・`OPEN`・`DIRTY`）
#
# ## 後片付けの失敗は、打った `gh` の言葉で出す
#
# 失敗の行（`UNRETARGETED`・`UNMENDED`・`UNDELETED`）にタグと対象だけを載せると、読んだ側は**失敗した
# 事実しか受け取れない**——権限が足りないのか、参照がもう無いのか、GitHubが断ったのかへ辿り着けず、
# 同じコマンドを手で打ち直すところから始めることになる。理由を持っているのは `gh` の標準エラーなので、
# 捨てずに同じ行へ載せる（[`archive-session.sh`](archive-session.sh) の `DIRTY` と同じ形。issue #1557
# では、パスだけの行を読んだ側が実際に誤読した）。**出力は1行1件**なので、改行は空白へ畳む。
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
# **だから張り替えたPRは、その場で書いた本人へ差し戻す**——`直し待ち` を付け、なぜ差し戻したかを
# コメントで残す。盤面は既存の `mend` でそのセッションを起こす
# （[`board-move.mjs`](board-move.mjs)）。載せ直して push すれば
# [`board-labels.yml`](../../.github/workflows/board-labels.yml) の `synchronized` が判定のラベルを
# 外し、CIも走り直すので、そこから先は普通のPRと同じ道を通る。**差し戻さずに張り替えるだけだと、
# base が `main` になったぶん盤面は普通に捌きにかかり、混ざった差分が古い緑のままマージ候補になる。**
#
# **デーモンは載せ直さない。** 他人のブランチへの force push になるので、履歴を書き換えるのは書いた
# 本人だけ。**張り替えに失敗したPR（`UNRETARGETED`）には付けない**——base が消えていないので、
# まだ積まれたままで、書いた本人にできることが無い。
#
# ## 関門（`needs-user-review.sh`）は、この道具では越えられない
#
# 確定の宣言（節の `【確定】` と、文書単位の `**本書は全体が確定です。**`）を足した／消したPRは、
# **ユーザー以外の判断ではマージしない**。
# [`needs-user-review.sh`](needs-user-review.sh) が該当を出したら `判断待ち` を付けて `HELD` で止め、
# ユーザーへ回す。越えるにはユーザーの許可を引いて `--user-ok` を付けて叩き直す——**そのとき許可を
# 受けたことをPRへコメントとして残す**ので、後からどのPRが誰の許可で通ったのかを辿れる。
#
# **自動では越えられない関門にしてあるのは、越えられる関門は越えるから。** 直近25本で
# `## 仮決め` に中身のあったPRが22本、`判断待ち` が付いたのは0本だった。
#
# **レビュアーが付けた `判断待ち` は、こことは別。** `[レビュー] 通してよい（人の判断が要る）` で
# 付くほうを見ているのは盤面（[`board-move.mjs`](board-move.mjs)）で、**この道具はラベルを見ない**
# ——外れればマージの手が出て、ここは該当なしで通す。だから `--user-ok` は要らない
# （[`board-design.md`](../../.claude/board-design.md) 2.13.4）。**ラベルを1つ外すだけで越えられる形に
# してあるのは、何を判断してほしいかがレビューのコメントに書いてあるから。**
#
# ## 畳んだのは、毎回同じ順で叩いていた手順
#
# `gh pr merge` → PRが `MERGED` か確認 → `Closes` の issue が `CLOSED` か確認 → 結果の報告。
# **どれも判断が無いのに、叩く側の文脈を1往復ずつ食う。** レビューは既に済んでいるので、ここから
# 先を1回にまとめる。
#
# ## セッションを畳むのは、ここではない
#
# **PRをマージしたかと、そのために立てたセッションを畳んでよいかは別の問い**（出どころ: ユーザーの
# 指示・2026-09-05。[`board-design.md`](../../.claude/board-design.md) 2.10）。畳むのは盤面が毎周
# 見て打つ。ここに繋いでいたときは、**人が画面からマージすると後片付けが一度も走らず**、
# ワーカーが枠を握ったまま残った（PR #1524）。レビューのセッションも同じ形で残った（#1549）。
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

# `%/*` は区切りが無いと文字列をそのまま返す。
HERE="${BASH_SOURCE[0]%/*}"
if [[ "$HERE" == "${BASH_SOURCE[0]}" ]]; then HERE='.'; fi
HERE="$(cd "$HERE" && pwd)"
# 試験は差し替える（`gh` は PATH で差し替わるが、これはパスで呼ぶため）。
NEEDS_USER_REVIEW="${NEEDS_USER_REVIEW:-$HERE/needs-user-review.sh}"

# **PRは1回だけ引く。** 項目ごとに `gh pr view` を打つと、その数だけ往復が増えるうえ、**項目ごとに
# 見ている時点がずれる**。引き直すのは、**この後の操作で変わるもの**だけ——マージ後の `state` と、
# 打つ直前に見たい `mergeable`。
pr=$(gh pr view "$PR" --json body,state,headRefName)
body=$(jq -r '.body // ""' <<<"$pr")
state=$(jq -r '.state' <<<"$pr")
# ブランチ名はマージでは変わらないので、ここで一緒に受けておく（使うのは後片付けの段）。
head=$(jq -r '.headRefName' <<<"$pr")

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

# 後片付けの残りを1件出す（上の「後片付けの失敗は、打った `gh` の言葉で出す」）。**残りが在ることを
# 数えるのもここ**——出した側が後で `leftover` を立て忘れると、片付いていないのに終了コード 0 で返る。
unfinished() {
  echo "$1 $2: ${3//$'\n'/ }"
  leftover=1
}

# 上に積まれたPRを `main` へ下ろしてから、マージ済みのブランチを消す（上の「積まれたPRは…」）。
# **1本でも下ろせなければ、ブランチを残す。** 引けなかったときも同じ——積まれたPRが在るかどうかが
# 分からないまま消すと、閉じられたPRは機械では戻せない。
retargeted=1
# 引けなかった理由は標準エラーに在るが、この `gh` は**標準出力が値**なので、混ぜずに受ける。
stderr="$(mktemp)"
if stacked=$(gh pr list --state open --base "$head" --json number --jq '.[].number' 2>"$stderr"); then
  # 差し戻す理由は、起こされた本人がPRを見て分かるものではない（コンフリクトもCIの赤もレビューの
  # 指摘も無い）ので、ここで書き残す。**張り替えたPR全部に同じ文面**なので、1回だけ組む。
  note="$(mktemp)"
  {
    echo "[デーモン] **下の PR #$PR がマージされたので、base を \`main\` へ張り替えました。**"
    echo
    echo 'squash マージでは下のコミットが `main` の履歴に入らないので、**張り替えただけでは差分に'
    echo '下のぶんが混ざったまま**で、CIも古い base で得た緑のままです。'
    echo
    echo '`origin/main` の上へ載せ直して push してください。push すれば判定のラベルが外れ、CIも'
    echo '走り直します。'
  } >"$note"
  while read -r other; do
    [ -n "$other" ] || continue
    if ! err=$(gh pr edit "$other" --base main 2>&1 >/dev/null); then
      unfinished UNRETARGETED "$other" "$err"
      retargeted=0
      continue
    fi
    echo "RETARGETED $other"
    if err=$(gh pr comment "$other" --body-file "$note" 2>&1 >/dev/null) &&
      err=$(gh pr edit "$other" --add-label 直し待ち 2>&1 >/dev/null); then
      continue
    fi
    # 理由を残せなければラベルも付けない（`UNMENDED` は「`直し待ち` が付いていない」と同じ意味に
    # しておく）。**張り替えは済んでいるので、盤面はこのPRを普通に捌きにかかる**——ここで出せるのは
    # 「差し戻せなかった」までで、混ざった差分がレビューへ出るのは止められない。
    unfinished UNMENDED "$other" "$err"
  done <<<"$stacked"
  rm -f "$note"
else
  unfinished UNRETARGETED "$PR" "$(cat "$stderr")"
  retargeted=0
fi
rm -f "$stderr"
# 既に消えているブランチは、消さない（同じPRへ二度叩いたときに `UNDELETED` が出ないように）。
if [ "$retargeted" -eq 1 ] && gh api "repos/{owner}/{repo}/git/refs/heads/$head" >/dev/null 2>&1; then
  if ! err=$(gh api -X DELETE "repos/{owner}/{repo}/git/refs/heads/$head" 2>&1 >/dev/null); then
    unfinished UNDELETED "$head" "$err"
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

# 本体は作業ツリーの共有先なので、進める前に汚れていないことを見る。未追跡は見ない——手で置いた
# ものが本体を進める妨げになるなら、その場で `git merge --ff-only` が失敗して分かる。
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
