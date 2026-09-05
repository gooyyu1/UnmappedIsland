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
# **渡さなければ、投入先ごとに違うモードで立つ。** 書くのは観測だけで、**そうなる理由は突き止めて
# いない**——`.claude/settings.json`（`defaultMode: bypassPermissions`）はリポジトリに追跡されていて
# クラウドの箱にも入るので、設定ファイルの有無では説明が付かない。
#
# - **クラウドは `auto`。** 渡さずに立てたセッションは、`.claude/**` を**読むだけ**の `bash` が
#   「機微なファイルの編集」と判定されて承認を待つ。**その承認は降りない**（見ている人が居ない）
#   ので、そこで手番が終わる——2026-09-05、PR #1567 のレビューが判定を書く前にこれで止まった。
# - **ブリッジは空。** 渡さずに立てたセッションは、`.claude/**` の読み書きを承認なしで通す
#   （2026-09-06 に実測。`permission_denials` が空）。**この経路から明示はできない**
#   ——`requires a CCR parent session` で撥ねられる（出どころ: ユーザーの指示・2026-09-06）。
#
# **`bypassPermissions` 以外は明示できる。** 渡すと撥ねられるのはあの値だけで、以前の「
# `permission_mode` は渡さない」は1件の失敗を全部の値へ広げたものだった（2026-09-06 に叩き直し）。
#
# **実効モードは `get_session` から読めない。** 渡さなかったセッションは、手番を回した後も
# `permission_mode` が `null` のまま返る。確かめるなら、実際に何かを叩かせて `permission_denials`
# を見る（2026-09-06 に `null` を「未設定＝手動」と読み違えた）。
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
