#!/usr/bin/env bash
# CCRの環境ID。**シェルからは `source` して、node からは実行して読む**（下の「node から読む口」）。
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

# ## node から読む口
#
# **直接実行されたら値を出す**（[`live-sessions.mjs`](live-sessions.mjs)）。`source` したときは
# 何も起きない。**書き写させないためにある**——既定値を向こうへ複製すると、ここを直したときに
# あちらが黙って古いIDを見続ける。
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  printf 'CLOUD_ENV=%s\nBRIDGE_ENV=%s\n' "$CLOUD_ENV" "$BRIDGE_ENV"
fi
