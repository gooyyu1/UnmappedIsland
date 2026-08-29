#!/usr/bin/env bash
# PRが「ユーザーの判断なしにマージしてはいけない」ものかを、差分のファイルだけで判定する。
#
#   bash scripts/agent/needs-user-review.sh 1152
#
# 出力は1行1件の理由。該当が無ければ何も出さない。
#   GRAMMAR   <パス>              … 宣言文法・スキーマ・文法リファレンスに触っている
#   MARK      <パス> <見出し>     … `【確定】` の印そのものを足した／消した
#   CONFIRMED <パス> <見出し>     … 印は動いていないが、確定節の射程に変更が掛かっている
#   終了コード 0 … `GRAMMAR` か `MARK` がある（**ユーザーの判断が要る**。`判断待ち` にする）
#   終了コード 1 … 該当なし、または `CONFIRMED` だけ（司令塔が振り分けてよい）
#   終了コード 2 … 調べられなかった（`gh` が失敗した等。**該当ありとして扱う**）
#
# **`CONFIRMED` だけのときに止めないのは、実測で大半が良性だったから。** 直近25本（2026-08-29）で
# `CONFIRMED` だけだった5本のうち4本は「`【未実装】` を外して実装した」PRで、確定した中身は動いて
# いない（#1148・#1153・#1156・#1158）。全部を止めると、**タップを1回増やすだけの関門**になる
# （[`parallel-work.md`](../../.claude/parallel-work.md)）。一方 `MARK` は、**誰が決めたのか分から
# ないまま確定が増える**唯一の入口なので止める——#1127（倍率を確定として書いたPR）と #1162 が
# ここで掛かる。`CONFIRMED` は司令塔が**その節の差分だけ**読んで、通すか差し戻すかを決める。
#
# ## なぜ申告ではなく機械で判定するのか
#
# PR本文の `## 仮決め` 節に申告させる仕組みは動いている——実測（2026-08-29）で、直近25本のうち
# **22本が中身を書いていた**。壊れていたのは受け取る側で、`判断待ち` が付いたのは **0本**だった。
# 22/25 に付ければ全部がユーザーへ行って関門にならないので、司令塔は
# [`parallel-work.md`](../../.claude/parallel-work.md) の逃げ道（「既に受けた後続 issue へ回した
# ものなら素通し」）を使っていたが、**その判定には差分を読むことが要る**。「差分を読み直して判定
# しない」と決めた同じ文書が、読まないと使えない逃げ道を持っていた。
#
# **ここが引くのは、申告の中身ではなくファイルの線と印の増減。** どちらも触ったかどうかしか見ない
# ので、司令塔は差分を読まない。実測で**直近25本のうち5本**だけが止まり、その5本に
# #1127・#1152・#1166（倍率がゲームへ入った3本すべて）が入る。22/25 とは別物の関門になる。
#
# 取りこぼしは残る（ここに挙げていないファイルで文法に相当することをする道はある）。それでよい
# ——[`policies.md`](../../.claude/policies.md)「**既に壊した実績のある操作は、取りこぼしが残っても
# 機械で止める**」。促す仕組みではなく、止める仕組みなので機械が引く。
#
# ## 線を引いたのは「yaml に書ける形」を決めているファイル
#
# - **`src/loader/Raw*.ts`・`parse*.ts`・`WorldCodexYamlLoader.ts`・`yamlMapping.ts`** — 生の yaml を
#   受け取る側。ここが変わると yaml に書ける形が変わる。
# - **`src/domain/DeclaredNumber.ts`** — `weight`/`duration` が受け取れる数の形。
# - **`docs/engine/WorldCodex.schema.json`** — 書ける形の宣言そのもの。
# - **`docs/engine/GameElementDefinition.md`** — 上の3つの仕様書。
#
# **`src/loader/` を丸ごとにはしない。** `loadDefinitions.ts`・`loadWorldCodex.ts`・`LoadReport.ts` は
# 読んだ結果を組み立てて報告する側で、書ける形は決めていない。丸ごとにしていたとき、PR #1183
# （絵の名前が重なるパックを、定義もろとも外して起動を続ける）が掛かった——文法には一切触っていない。
#
# `【確定】` は「覆すには人間の判断が要る」という宣言なので、その射程への変更も同じ扱い。
# **見出しの行だけでなく、節の本文への変更も見る**——印は見出しに付くが、囲っているのは本文。

set -euo pipefail

PR="${1:?PRの番号を渡す（例: 1152）}"

GRAMMAR_PATHS='^src/loader/(Raw[A-Za-z]*|parse[A-Za-z]*|WorldCodexYamlLoader|yamlMapping)\.ts$|^src/domain/DeclaredNumber\.ts$|^docs/engine/WorldCodex\.schema\.json$|^docs/engine/GameElementDefinition\.md$'

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

gh pr view "$PR" --json files --jq '.files[].path' >"$WORK/files" || {
  echo "PR #$PR のファイル一覧を引けなかった" >&2
  exit 2
}

blocking=0

while IFS= read -r path; do
  [ -n "$path" ] || continue
  echo "GRAMMAR $path"
  blocking=1
done < <(grep -E "$GRAMMAR_PATHS" "$WORK/files" || true)

# `【確定】` の節は、**PRの側の版**で射程を数える。main の版で数えると、そのPRが足した確定節を
# 見落とす（印を付ける変更こそ、ユーザーの判断が要るもの）。
head_sha=$(gh pr view "$PR" --json headRefOid --jq '.headRefOid') || exit 2
base_sha=$(gh pr view "$PR" --json baseRefOid --jq '.baseRefOid') || exit 2
git fetch -q origin "pull/$PR/head" || exit 2

# 変更が掛かった行（新しい側の行番号）を、ファイルごとに集める。
gh pr diff "$PR" >"$WORK/diff" || exit 2

while IFS= read -r path; do
  case "$path" in
  docs/*.md | docs/*/*.md | docs/*/*/*.md) ;;
  *) continue ;;
  esac

  git show "$head_sha:$path" >"$WORK/doc.md" 2>/dev/null || continue
  grep -q '【確定】' "$WORK/doc.md" || continue

  # 確定見出しの射程（その見出しから、同位以上の次の見出しの手前まで）を出す。
  awk '
    /^#+ / {
      match($0, /^#+/); lvl = RLENGTH
      if (owner_lvl > 0 && lvl <= owner_lvl) { print owner_start "\t" (NR - 1) "\t" owner; owner_lvl = 0 }
      if (owner_lvl == 0 && $0 ~ /【確定】/) { owner = $0; owner_lvl = lvl; owner_start = NR }
    }
    END { if (owner_lvl > 0) print owner_start "\t" NR "\t" owner }
  ' "$WORK/doc.md" >"$WORK/ranges"

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
  strip_marks() { sed -n 's/^#\+ //p' "$1" | sed 's/【.*//' | sed 's/[[:space:]]*$//'; }
  git show "$head_sha:$path" 2>/dev/null | grep '【確定】' >"$WORK/head-marked" || true
  git show "$base_sha:$path" 2>/dev/null | grep '【確定】' >"$WORK/base-marked" || true
  strip_marks "$WORK/head-marked" | sort >"$WORK/head-set"
  strip_marks "$WORK/base-marked" | sort >"$WORK/base-set"
  mark_moved=$(comm -3 "$WORK/base-set" "$WORK/head-set")

  while IFS=$'\t' read -r from to heading; do
    if awk -v a="$from" -v b="$to" '$1 >= a && $1 <= b { hit = 1; exit } END { exit hit ? 0 : 1 }' "$WORK/touched"; then
      if [ -n "$mark_moved" ]; then
        echo "MARK $path ${heading#\#* }"
        blocking=1
      else
        echo "CONFIRMED $path ${heading#\#* }"
      fi
    fi
  done <"$WORK/ranges"
done <"$WORK/files"

[ "$blocking" -eq 1 ]
