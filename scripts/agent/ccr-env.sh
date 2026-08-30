#!/usr/bin/env bash
# CCRの環境ID。**`source` して使う**（実行しない）。
#
#   source "$HERE/ccr-env.sh"
#
# クラウドが既定。ブリッジ（このPC）はリポジトリを既に持っているので、投入するときに `source_url` を
# 渡さない。**畳む側もこの2つを見る**——タグはクラウドとブリッジで同じなので、環境IDでしか区別が
# 付かない（`archive-reviews.sh`・`merge-and-close.sh`）。
#
# **試験は環境変数で差し替える。** 既定値のIDを試験へ書き写すと、ここを直したときに向こうが黙って
# 古いIDを見続ける。

CLOUD_ENV="${CLOUD_ENV:-env_01JEqw2RUbL6EFo4p8EgRLSC}"
BRIDGE_ENV="${BRIDGE_ENV:-env_018uF5fo4jU3HVotrg51gqLe}"
