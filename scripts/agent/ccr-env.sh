#!/usr/bin/env bash
# CCRの環境IDと、そこへ立てるときの承認モード。**シェルからは `source` して、node からは実行して
# 読む**（下の「node から読む口」）。
#
#   source "$HERE/ccr-env.sh"
#
# クラウドが既定。ブリッジ（このPC）はリポジトリを既に持っているので、投入するときに `source_url` を
# 渡さない。**畳む側は見ない**——どちらで立ったかは畳んでよいかの条件ではない
# （[`archive-session.sh`](archive-session.sh)「ブリッジで立てたものも、同じ条件で畳む」）。
#
# **試験は環境変数で差し替える。** 既定値のIDを試験へ書き写すと、ここを直したときに向こうが黙って
# 古いIDを見続ける。

CLOUD_ENV="${CLOUD_ENV:-env_01JEqw2RUbL6EFo4p8EgRLSC}"

# ## ブリッジのIDは、開き直すたびに変わる
#
# **書かない。** ブリッジの環境は CLI のプロセス1つにつき1つ立ち、閉じれば消える——PCを再起動して
# 開き直すと、**前のIDはもう存在しない**。直書きすると、投入は消えた環境を指したまま黙って通らなく
# なる（2026-09-11、当時デーモンを起こしていた Routine が同じIDを指したまま丸一日発火しなかった。
# あの係は `agent-ops/board-design.md` 2.19.2 でこのPCのタスクへ移した）。
#
# 引くのは CLI 自身が書く手元の記録（`bridge-pointer.json`）。置き場は**その CLI の作業ディレクトリ**
# ごとに分かれ、名前は英数字以外を `-` へ潰したパス。**見るのは本体のチェックアウト**なので、
# 作業ツリーの中から読んでも、このPCで開いている CLI が返る。
#
# **開いていなければ空。** 立てようとした側がそこで転ぶ（[`dispatch-steps.sh`](dispatch-steps.sh)）
# ——ここで代わりのIDを当てずっぽうに埋めると、居ない相手へ投げて返らないセッションになる。
bridge_env_id() {
  local root slug pointer
  root=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 0
  # MSYS2 の bash は `/c/...` を返すが、CLI が知っているのは Windows のパス（`pwd -W`）。
  root=$(cd "$(dirname "$root")" 2>/dev/null && { pwd -W 2>/dev/null || pwd; }) || return 0
  slug=$(printf '%s' "$root" | sed 's/[^A-Za-z0-9]/-/g')
  pointer="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/$slug/bridge-pointer.json"
  [ -f "$pointer" ] || return 0
  jq -r '.environmentId // empty' "$pointer" 2>/dev/null || return 0
}

BRIDGE_ENV="${BRIDGE_ENV:-$(bridge_env_id)}"

# ## 承認モードは環境で決まる
#
# **投入する側は選ばない。** どちらへ立てるかを決めれば、モードも一緒に決まる
# （`agent-ops/board-design.md` 2.16）。**空なら `permission_mode` を渡さない**、が呼び手の約束。
#
# **渡さなければ、投入先ごとに違うモードで立つ。** 書くのは観測だけで、**そうなる理由は突き止めて
# いない**——`.claude/settings.json`（`defaultMode: bypassPermissions`）はリポジトリに追跡されていて
# クラウドの箱にも入るので、設定ファイルの有無では説明が付かない。
#
# - **クラウドは `auto`。** 渡さずに立てたセッションは、`.claude/**` を**読むだけ**の `bash` が
#   「機微なファイルの編集」と判定されて承認を待つ。**その承認は降りない**（見ている人が居ない）
#   ので、そこで手番が終わる——2026-09-05、PR #1567 のレビューが判定を書く前にこれで止まった。
# - **ブリッジは空**（出どころ: ユーザーの指示・2026-09-06）。渡さずに立てたセッションは、
#   `.claude/**` の読み書きを承認なしで通す（2026-09-06 に実測。`permission_denials` が空）。
#   **この経路から明示はできない**——`requires a CCR parent session` で撥ねられる。
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
#
# **決まらなかった側は出さない**（上の「開いていなければ空」）。空のIDを出すと、環境IDを持たない
# セッションが**ブリッジで走っている**ことになる。
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  [ -z "$CLOUD_ENV" ] || printf 'CLOUD_ENV=%s\n' "$CLOUD_ENV"
  [ -z "$BRIDGE_ENV" ] || printf 'BRIDGE_ENV=%s\n' "$BRIDGE_ENV"
fi
