#!/usr/bin/env bash
# **畳まれていないセッション**を1行1件で出す。「畳まれていない」の定義はここ1箇所だけが持つ。
#
#   $ bash scripts/agent/live-sessions.sh
#   cse_abc123<TAB>SESSION_STATUS_RUNNING<TAB>SESSION_STATUS_BUCKET_WORKING<TAB>task-1234
#
# 1行が `<セッションID>\t<session_status>\t<status_bucket>\t<タグをカンマで繋いだもの>`。1本も
# 無ければ**何も出さずに終了コード0**。**引けなかったときは終了コード1**で、呼び手は止まる側へ
# 倒せる。
#
# ## なぜ切り出したか
#
# 一覧を要るのは2つある——**占有の判定**（[`occupancy.sh`](occupancy.sh)）と、**使用量の割り当て**
# （[`usage-record.sh`](usage-record.sh)。[`board-design.md`](../../.claude/board-design.md) 2.5.3）。
# **2箇所に同じ条件を書くと、片方だけが直る。**
#
# ## 絞るのは `SESSION_STATUS_ARCHIVED` だけ
#
# **手が空いていることは、仕事が終わったことではない。** `status_bucket` が
# `..._COMPLETED` / `..._BLOCKED` / `..._FAILED` でも、そのセッションは仕事を持ったまま次の指示を
# 待っている——**畳まれたセッションでさえ、`unarchive_session` → `send_message` で文脈ごと再開
# できる**（1.5 の実測）。ここで落とすと、占有の側が「空いている」と読んで二重に立てる。
#
# **`session_status` と `status_bucket` は両方そのまま出す。** どちらで何を読むかは呼び手が決める
# （1.6）。条件をこちらへ持つと、どちらの呼び手にも合わない定義が1つできる。
#
# 判定に **`updated_at` は使わない**（1.6）——走行中でも動かないことを 2026-09-05 に実測している。
#
# ## 一覧は最後まで繰る
#
# `list_sessions` の `tags` での絞り込みは、この呼び出し元からは使えない（指定すると異常終了する。
# 使えるのはOAuthの呼び出し元だけ）ので、取ってから手元で絞る。**1ページで済ませない**——固まった
# 走行中のセッションは占有したままなので、直近100件の外に居ることがある。
#
# ## `tr -d '\r'` が要る側と要らない側
#
# **要るのは、複数行を出して、その行を「シェルが」受け取るとき。** Windowsの外部 jq は標準出力を
# テキストモードで開くので、行の区切りが CRLF になる。**`\r` が残るのは各行の末尾**で、`$(…)` が
# 落とすのはそのうち**最後の1行ぶんだけ**。
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
#   `\r` は抜き出す側に入らない。`board.sh` に `tr` の無い `$(jq …)` があるのはこれで、
#   **シェルが行を受け取る箇所（`read`・値の比較・正規表現への埋め込み）にだけ付いている。**
#
# **この「丸ごと落とす」はWindowsの bash だけ**で、Linuxでは末尾の `\r` が残る。ただしLinuxの jq は
# `\r` を出さないので、どちらでも同じ結果になる。`gh` の `--jq` は gh 内蔵なので、Windowsでも LF。
# 無条件に掛けると、要る理由が読めなくなる。

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 試験は差し替える（パスで呼ぶため PATH では差し替わらない）。
CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}"

after=''
while :; do
  if [ -z "$after" ]; then
    req='{"mine":true,"limit":100}'
  else
    req=$(printf '{"mine":true,"limit":100,"after_id":"%s"}' "$after")
  fi

  page=$(bash "$CCR_META" list_sessions <<<"$req" | grep -o '{"ccr".*' || true)
  if [ -z "$page" ]; then
    echo "セッションの一覧を引けなかった" >&2
    exit 1
  fi

  jq -r '.ccr.data[]?
    | select(.session_status != "SESSION_STATUS_ARCHIVED")
    | [.id, (.session_status // "-"), (.status_bucket // "-"), ([.tags[]?] | join(","))]
    | @tsv' <<<"$page" | tr -d '\r'

  [ "$(jq -r '.ccr.has_more // false' <<<"$page" | tr -d '\r')" = true ] || break
  after=$(jq -r '.ccr.last_id // ""' <<<"$page" | tr -d '\r')
  [ -n "$after" ] || break
done
