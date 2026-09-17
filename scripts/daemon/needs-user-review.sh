#!/usr/bin/env bash
# PRが「ユーザーの判断なしにマージしてはいけない」ものかを、確定節の差分から判定する。
# **止めるかどうかを決めるのは `【確定】` の印の増減だけ**（増えた印を緩めるかは、節が挙げた
# 出どころで決まる）で、射程への変更は理由として出すだけ。
#
#   bash scripts/daemon/needs-user-review.sh 1152
#
# 出力は1行1件の理由。該当が無ければ何も出さない。
#   MARK       <パス> <見出し>    … `【確定】` の印そのものを足した／消した
#   UNANSWERED <パス> <見出し> … <なぜ>
#                                 … 印を足し、出どころに issue を挙げたが、そこに答えが無い
#   SOURCED    <パス> <見出し>    … 印を足したが、その節が**答えの出た** issue を指す
#                                   `**出どころ**:` を持っている
#   CONFIRMED  <パス> <見出し>    … 印は動いていないが、確定節の射程に変更が掛かっている
#   終了コード 0 … `MARK` か `UNANSWERED` がある（**ユーザーの判断が要る**。`判断待ち` にする）
#   終了コード 1 … 該当なし、または `CONFIRMED`・`SOURCED` だけ（**この関門では止めない**。人へ
#                  回すかは、差分を読むレビュアーが決める）
#   終了コード 2 … 調べられなかった（`gh` が失敗した等。**該当ありとして扱う**）
#
# **出どころの issue を引けなかったときは 2 ではなく `UNANSWERED`。** 2 を返すのは、PRそのものを
# 引けずに**何も判定できない**とき。あちらは節も番号も分かっているので、名指しで出すほうが、
# 受け取った人が次にどこを見ればよいかを読める（どちらも `merge-pr.sh` は `HELD` にする）。
#
# **`MARK` と `UNANSWERED` は、通す前に確かめることが違う。** 前者は「あなたが決めたのか」で、
# そうなら画面からマージすればよい。後者は**指された issue にまだ答えが無い**ので、先にあちらへ
# 答えるかどうかから。**通し方はどちらも画面からのマージで同じ**——issue へ答えても、このPRが
# 関門へ戻ってくることはない（`HELD` でPRに付いた `判断待ち` が落ちるのは次の push で、
# [`board-move.mjs`](board-move.mjs) は付いている間マージを打たない）。
#
# **`CONFIRMED` だけのときに止めないのは、実測で大半が良性だったから。** 直近25本（2026-08-29）で
# `CONFIRMED` だけだった5本のうち4本は「`【未実装】` を外して実装した」PRで、確定した中身は動いて
# いない（#1148・#1153・#1156・#1158）。全部を止めると、**タップを1回増やすだけの関門**になる
# （[`parallel-work.md`](../../agent-ops/parallel-work.md)）。一方 `MARK` と `UNANSWERED` は、
# **誰が決めたのか分からないまま確定が増える**入口なので止める——#1127（倍率を確定として書いたPR）と
# #1162 がここで掛かる。`CONFIRMED` の節の中身は、差分を読むレビュアーが見る
# （[`review-criteria.md`](../../agent-ops/review-criteria.md)「人の判断へ回す（止める理由ではない）」）。
#
# ## 機械が引くのは印の増減だけ
#
# **印の増減には、誤検知が構造的に無い。** `【確定】` は「覆すには人間の判断が要る」という宣言
# そのものなので、ユーザー以外がそれを増やしたこと自体が、定義上ユーザーの判断を要する。触ったか
# どうかではなく印の増減を見ているので、**止めた理由がそのまま「何を判断してほしいか」になる。**
# [`policies.md`](../../agent-ops/policies.md)「仕組みの作り方」の、**既に壊した実績のある操作は機械で
# 止める**にあたる。
#
# **差分を読まないと決められないことは、ここでは決めない。** 宣言文法・スキーマ・ゲームコンセプト・
# 確定節に抵触するかは、**差分を読むレビュアーが判定する**（[`review-criteria.md`](../../agent-ops/review-criteria.md)
# 「人の判断へ回す」。判定の形は `[レビュー] 通してよい（人の判断が要る）`）。ここが文法・スキーマの
# ファイルに触ったかでも引いていた頃は、**スキーマの `description` を変えただけの差分と、文法を足した
# 差分が同じに見えていた**——止めた理由とPR本文の `## 仮決め` の中身が一致せず、通すかを決める側は
# 「何を判断すればよいのか」を読み取れなかった。
#
# `【確定】` は「覆すには人間の判断が要る」という宣言なので、その射程への変更も同じ扱い。
# **見出しの行だけでなく、節の本文への変更も見る**——印は見出しに付くが、囲っているのは本文。
#
# ### 掛け先は、印の条件が掛かる文書と同じ1つ
#
# **見るファイルを自分で決めない。** [`docScope.mjs`](../docScope.mjs) の `isMarkRuleDoc` へ渡して
# 絞る——印の条件を課す検査（`tests/docs/docReferences.test.ts`）が読むのと同じ1つで、
# **`docs/` の中かでは絞らない**（印の意味は置き場で変わらないため）。**外れる記録がどれかと、
# その理由は [`DocumentStyle.md`](../../docs/DocumentStyle.md) 10 節**が持つ——ここへ書き写すと、
# 写しだけが古くなる先が増える。
#
# **ここでパターンを書き写すと、射程が2つになる。** 実際そうなっていて、掛け先が `docs/` に
# 取り残されている間、[`board-design.md`](../../agent-ops/board-design.md) の確定節は**印を足す変更
# ごと素通りしていた**（#1800）。
#
# **`main` へ直接 push できる配下では、通る差分と通らない差分が並ぶ。** `agent-ops/**` がそれで
# （[`parallel-work.md`](../../agent-ops/parallel-work.md)「盤面を回す仕組みの手入れは `main` へ直接
# push する」）、**関門はPRになった差分しか見ない。** 掛け先を広げても、この抜けは残る。
#
# ### 文書単位の宣言も同じ1つの印として数える
#
# 全節が確定に当たる文書は、節ごとの印ではなく題名の直後で1回宣言する
# （[`DocumentStyle.md`](../../docs/DocumentStyle.md) 6.2 節。`**本書は全体が確定です。**` で始まる段落）。
# **印の増減だけを数えていた頃、この形は素通りした**——PR #1396（`GameConcept.md` を文書単位で宣言）が
# その1例目で、本作の土台が丸ごと確定になる変更が止まらなかった。
#
# 宣言は `# 本書全体` という1つの確定見出しと同じに扱い、射程は文書の全行。宣言のある文書には節の印を
# 付けない決まりなので、両方が並ぶことはない。**宣言が増えた側だけでなく消えた側も止める**——
# 確定を外すのは、付けるのと同じだけ人間の判断が要る。
#
# ### 出どころが書いてある印は、指した先に答えが在るなら止めない
#
# **止めたいのは「誰が決めたのか分からないまま増える確定」だけ。** 新しく印が付いた節が
# issue を指す `**出どころ**:` の1行を持ち、その issue に答えが下りているなら、決めたのはユーザー
# 本人で、答えは既に出ている。それを止めると、**同じ答えに二度目のタップを求める**ことになる
# ——実測（2026-08-30）で `判断待ち` に積まれていた3本（#1364・#1266・#1262）がこれだった。
#
# **緩めるのは、印がそのPRで増えた節に限る。** base に既に在った確定節は、そのPRが決めたもの
# ではないので、出どころの行があっても今までどおり `CONFIRMED` として扱う。
# 出どころの行が無い印は `MARK` のまま止める（[#656](https://github.com/gooyyu1/UnmappedIsland/issues/656)
# 「出どころの1行がある印は、あなたのタップを待たずにマージする」）。
#
# **出どころは申告なので、嘘は書ける。** だから指された issue を引いて、`判断待ち` のラベルが
# 残っていないかを見る。**答えたという合図がこのラベルを外すことなので**
# （[`parallel-work.md`](../../agent-ops/parallel-work.md)「チェックだけでは、機械は拾わない」）、
# **残っている issue には答えがまだ無い。** issue の側のこのラベルを外す手は仕組みの側に無く、
# 外せるのは人だけ。待ったままの issue を指した印と、引けない番号を指した印は `UNANSWERED` で止める。
#
# **言えるのは片側だけ。** 通った印について機械が言えるのは「**答えを待ったままの issue は指して
# いない**」であって、「ユーザーが答えた」ではない。`判断待ち` が**一度も付いたことのない** issue
# ——投入された `kind:task` の issue（自分の担当の番号がこれ）や、答えの出た別の issue——を指した
# 申告は、ここを素通りする。**節の中身と issue の中身を突き合わせないと分からない**ので、そこは
# 差分を読むレビュアーの側（[`review-criteria.md`](../../agent-ops/review-criteria.md)「人の判断へ
# 回す」の、確定節の射程）。
#
# **`ユーザーの指示` と書いた出どころは、意図して緩めない**（`DocumentStyle.md` 6.1節。issue を
# 通らず対話の中で決まったものがこの形）。チェックという確かめられる跡が無いので、緩めると
# 申告するだけで確定を増やせる。ユーザーに見せて止めるのが正しい扱い。

set -euo pipefail

HERE="${BASH_SOURCE[0]%/*}"
if [[ "$HERE" == "${BASH_SOURCE[0]}" ]]; then HERE='.'; fi
HERE="$(cd "$HERE" && pwd)"

PR="${1:?PRの番号を渡す（例: 1152）}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

gh pr view "$PR" --json files --jq '.files[].path' >"$WORK/files" || {
  echo "PR #$PR のファイル一覧を引けなかった" >&2
  exit 2
}

gh pr diff "$PR" >"$WORK/diff" || exit 2

blocking=0

# 文書単位の宣言（上の「文書単位の宣言も…」）。題名（`#`）と最初の節（`##`）の間だけを見る。
# `DocumentStyle.md` 6.2 節は書式そのものを本文で引用しているので、位置で絞らないとあの文書が
# 自分を宣言していることになる。
declares_whole() {
  awk '/^## / { exit } /^\*\*本書は全体が確定です。\*\*/ { found = 1; exit } END { exit found ? 0 : 1 }' "$1"
}

# 出どころが指す issue に、ユーザーの答えが在るか（上の「出どころが書いてある印は…」）。
#   answered … 答えは出ている（`判断待ち` が付いていない）
#   pending  … まだ答えを待っている
#   missing  … 引けなかった（番号が実在しない・`gh` が失敗した）
# 同じ番号を節の数だけ引かないよう、1度引いたら控える。
answer_state() {
  local cache="$WORK/issue-$1" labels
  if [ ! -f "$cache" ]; then
    if labels=$(gh issue view "$1" --json labels --jq '.labels[].name' 2>/dev/null); then
      if printf '%s\n' "$labels" | grep -qxF '判断待ち'; then
        echo pending >"$cache"
      else
        echo answered >"$cache"
      fi
    else
      echo missing >"$cache"
    fi
  fi
  cat "$cache"
}

# `【確定】` の節は、**PRの側の版**で射程を数える。main の版で数えると、そのPRが足した確定節を
# 見落とす（印を付ける変更こそ、ユーザーの判断が要るもの）。
shas=$(gh pr view "$PR" --json headRefOid,baseRefOid --jq '"\(.headRefOid) \(.baseRefOid)"') || exit 2
read -r head_sha base_sha <<<"$shas"
git fetch -q origin "pull/$PR/head" || exit 2

# 見るのは、確定度の印の条件が掛かる文書だけ（上の「掛け先は、印の条件が掛かる文書と同じ1つ」）。
node "$HERE/../docScope.mjs" <"$WORK/files" >"$WORK/targets" || exit 2

while IFS= read -r path; do
  git show "$head_sha:$path" >"$WORK/doc.md" 2>/dev/null || continue
  git show "$base_sha:$path" >"$WORK/base-doc.md" 2>/dev/null || : >"$WORK/base-doc.md"

  head_declares=0
  if declares_whole "$WORK/doc.md"; then head_declares=1; fi
  base_declares=0
  if declares_whole "$WORK/base-doc.md"; then base_declares=1; fi

  if [ "$head_declares" -eq 0 ] && [ "$base_declares" -eq 0 ]; then
    grep -q '【確定】' "$WORK/doc.md" || continue
  fi

  # 射程を出す。文書単位の宣言があるなら文書の全行、無ければ確定見出しごとに（その見出しから、
  # 同位以上の次の見出しの手前まで）。
  if [ "$head_declares" -eq 1 ] || [ "$base_declares" -eq 1 ]; then
    printf '1\t%s\t# 本書全体\n' "$(wc -l <"$WORK/doc.md")" >"$WORK/ranges"
  else
    awk '
      /^#+ / {
        match($0, /^#+/); lvl = RLENGTH
        if (owner_lvl > 0 && lvl <= owner_lvl) { print owner_start "\t" (NR - 1) "\t" owner; owner_lvl = 0 }
        if (owner_lvl == 0 && $0 ~ /【確定】/) { owner = $0; owner_lvl = lvl; owner_start = NR }
      }
      END { if (owner_lvl > 0) print owner_start "\t" NR "\t" owner }
    ' "$WORK/doc.md" >"$WORK/ranges"
  fi

  # そのファイルの差分から、新しい側で触られた行番号を出す。
  awk -v target="$path" '
    /^\+\+\+ b\// { file = substr($0, 7); next }
    file != target { next }
    /^@@ / {
      # @@ -a,b +c,d @@ の c と d
      split($3, plus, ",")
      start = plus[1] + 0; if (start < 0) start = -start
      len = (length(plus) > 1) ? plus[2] + 0 : 1
      for (i = 0; i < len; i++) print start + i
    }
  ' "$WORK/diff" >"$WORK/touched"

  [ -s "$WORK/touched" ] || continue

  # 印そのものが動いたか——**変更前後で、確定している見出しの顔ぶれが変わったか**を見る。
  # 差分の行に `【確定】` が出るかでは判定できない。`【未実装: …】` を外す変更は同じ見出し行を
  # 触るので、印が動いていないのに毎回引っかかる（実測で #1148・#1153・#1156・#1158 の4本）。
  # 見出しの同一性は、印を全部落とした残りで見る。印は見出しの末尾に並ぶので、**最初の `【` から
  # 行末まで**を落とす。`【[^】]*】` は使えない——`[^】]` はバイト単位の否定になり、`】`（E3 80 91）と
  # 先頭バイトを共有する `の`（E3 81 AE）等で止まる。
  strip_marks() { sed -n 's/^#\+ //p' | sed 's/【.*//' | sed 's/[[:space:]]*$//'; }
  git show "$head_sha:$path" 2>/dev/null | grep '【確定】' >"$WORK/head-marked" || true
  git show "$base_sha:$path" 2>/dev/null | grep '【確定】' >"$WORK/base-marked" || true
  # 文書単位の宣言を、`# 本書全体` という1つの確定見出しとして混ぜる。宣言が増えた／消えた変更が
  # `mark_moved` に出て、増えた側は `new-marks` に入る。
  if [ "$head_declares" -eq 1 ]; then printf '# 本書全体\n' >>"$WORK/head-marked"; fi
  if [ "$base_declares" -eq 1 ]; then printf '# 本書全体\n' >>"$WORK/base-marked"; fi
  strip_marks <"$WORK/head-marked" | sort >"$WORK/head-set"
  strip_marks <"$WORK/base-marked" | sort >"$WORK/base-set"
  mark_moved=$(comm -3 "$WORK/base-set" "$WORK/head-set")
  # そのPRで新しく印が付いた見出しだけ。出どころを見て緩めるのはこれに限る（上の「出どころが
  # 書いてある印は、指した先に答えが在るなら止めない」）。
  comm -13 "$WORK/base-set" "$WORK/head-set" >"$WORK/new-marks"

  # 新しく印が付いた節が、答えの出どころとして指している issue の番号。出どころの行が無い節と、
  # そのPRで印が増えたのではない節では何も出さない。**答えが在るかを見るのは `answer_state`。**
  #
  # 出どころそのものが issue の番号である形だけを拾う——確認は1問1 issue で出す（`CLAUDE.md`）ので、
  # 指す先はその issue。生（`#1970（…）`）とリンク（`[#1970](…)（…）`）の両方が実在する。
  # **どの番号かでは絞らない。** 行き先は問いの数だけあるので、1本に絞ると新しい経路の答えが全部止まる。
  #
  # **番号は `:` の直後になければならない。** `ユーザーの指示（… #1884）` のように、答えの在処を
  # 添えただけの行を緩めないため（上の「`ユーザーの指示` と書いた出どころは、意図して緩めない」）。
  source_issue() {
    printf '%s\n' "$3" | strip_marks | grep -qxFf "$WORK/new-marks" - || return 0
    awk -v a="$1" -v b="$2" '
      NR < a || NR > b { next }
      match($0, /^\*\*出どころ\*\*: *\[?#[0-9]+/) {
        n = substr($0, RSTART, RLENGTH); sub(/.*#/, "", n); print n; exit
      }
    ' "$WORK/doc.md"
  }

  while IFS=$'\t' read -r from to heading; do
    if awk -v a="$from" -v b="$to" '$1 >= a && $1 <= b { hit = 1; exit } END { exit hit ? 0 : 1 }' "$WORK/touched"; then
      if [ -z "$mark_moved" ]; then
        echo "CONFIRMED $path ${heading#\#* }"
        continue
      fi
      issue=$(source_issue "$from" "$to" "$heading")
      if [ -z "$issue" ]; then
        echo "MARK $path ${heading#\#* }"
        blocking=1
        continue
      fi
      case "$(answer_state "$issue")" in
      answered)
        echo "SOURCED $path ${heading#\#* }"
        ;;
      pending)
        echo "UNANSWERED $path ${heading#\#* } … #$issue は答えを待ったまま"
        blocking=1
        ;;
      *)
        echo "UNANSWERED $path ${heading#\#* } … #$issue を引けなかった"
        blocking=1
        ;;
      esac
    fi
  done <"$WORK/ranges"
done <"$WORK/targets"

[ "$blocking" -eq 1 ]
