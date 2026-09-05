#!/usr/bin/env bash
# CCRの環境IDと、そこへ立てるときの承認モード。**シェルからは `source` して、node からは実行して
# 読む**（下の「node から読む口」）。
#
#   source "$HERE/ccr-env.sh"
#
# クラウドが既定。ブリッジ（このPC）はリポジトリを既に持っているので、投入するときに `source_url` を
# 渡さない。**畳む側もこの2つを見る**——タグはクラウドとブリッジで同じなので、環境IDでしか区別が
# 付かない（[`archive-session.sh`](archive-session.sh)）。
#
# **試験は環境変数で差し替える。** 既定値のIDを試験へ書き写すと、ここを直したときに向こうが黙って
# 古いIDを見続ける。

CLOUD_ENV="${CLOUD_ENV:-env_01JEqw2RUbL6EFo4p8EgRLSC}"
BRIDGE_ENV="${BRIDGE_ENV:-env_018uF5fo4jU3HVotrg51gqLe}"

# ## 承認モードは環境で決まる
#
# **投入する側は選ばない。** どちらへ立てるかを決めれば、モードも一緒に決まる
# （`.claude/board-design.md` 2.16）。**空なら `permission_mode` を渡さない**、が呼び手の約束。
#
# - **クラウドは `auto`。** 渡さないと未設定のまま立ち、`.claude/**` を**読むだけ**の `bash` が
#   「機微なファイルの編集」と判定されて承認を待つ。**その承認は降りない**（見ている人が居ない）
#   ので、そこで手番が終わる——2026-09-05、PR #1567 のレビューが判定を書く前にこれで止まった。
# - **ブリッジは空。** この経路から `bypassPermissions` を明示すると
#   `requires a CCR parent session` で撥ねられるが、**渡さなければそれになる。** 承認を出せる人が
#   目の前に居る側なので、そこは訊かずに通す（出どころ: ユーザーの指示・2026-09-06）。
#
# **`bypassPermissions` 以外は明示できる。** 渡すと撥ねられるのはあの値だけで、以前の「
# `permission_mode` は渡さない」は1件の失敗を全部の値へ広げたものだった（2026-09-06 に叩き直し）。
CLOUD_MODE="${CLOUD_MODE-auto}"
BRIDGE_MODE="${BRIDGE_MODE-}"

# ## node から読む口
#
# **直接実行されたら環境IDを出す**（[`live-sessions.mjs`](live-sessions.mjs)）。`source` したときは
# 何も起きない。**書き写させないためにある**——既定値を向こうへ複製すると、ここを直したときに
# あちらが黙って古いIDを見続ける。
#
# **出すのは環境IDだけ。** 読む側は `BRIDGE_ENV` 以外の行を全部クラウドの環境IDとして扱うので、
# モードをここへ足すと、その値が環境IDとして対応表に載る。モードを要るのは投入する側だけで、
# あちらは `source` して読む。
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  printf 'CLOUD_ENV=%s\nBRIDGE_ENV=%s\n' "$CLOUD_ENV" "$BRIDGE_ENV"
fi
