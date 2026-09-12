#!/usr/bin/env bash
# `dispatch-*.sh` が共有する、投入の段取り。**シェルから `source` して使う。**
#
#   # shellcheck source=scripts/agent/dispatch-steps.sh
#   source "$(dirname "${BASH_SOURCE[0]}")/dispatch-steps.sh"
#   choose_target "$WHERE"                    # ENV_ID・MODE・SOURCE が決まる
#   template_body "$TEMPLATE" "$INSTRUCTION"  # ひな形から渡す本体を取り出す
#   …立ててよいかを投入するものから確かめる（開いているか・閉じるPRが既に無いか）のは呼ぶ側…
#   dispatch_session new-task "$TAG" -- task --tag "$TAG" …   # 立てて、届いたことを確かめる
#
# **呼ぶ側が持つのは、渡すタグと、投入するものからしか確かめられない関門だけ。** 手綱と占有へ訊く
# のは下の `dispatch_session` が、題の組み立ては [`dispatch-session.mjs`](dispatch-session.mjs) が
# 持つ——写しで持つと、片方だけ直したときに黙って食い違う。
#
# `source` した側は、次も受け取る。
#
# - ひな形の読み方（[`prompt-template.sh`](prompt-template.sh) の `template_body`・`template_title`）
# - `AGENT_DIR` … このファイルの在り処。隣のスクリプト（`may-dispatch.sh` など）はここから引く
# - `CCR_META` … メタMCPの入口（[`.claude/ccr-meta.sh`](../../.claude/ccr-meta.sh)）
# - `WORK` … 作業用の一時ディレクトリ。**抜けるときに消える**

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/agent/ccr-env.sh
source "$AGENT_DIR/ccr-env.sh"
# shellcheck source=scripts/agent/prompt-template.sh
source "$AGENT_DIR/prompt-template.sh"
CCR_META="$AGENT_DIR/../../.claude/ccr-meta.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 立てる先が決まれば、渡すものは全部決まる（[`ccr-env.sh`](ccr-env.sh)）。`--bridge` はこのPCで
# 走る側で、リポジトリを既に持っているので `source_url` を渡さない。
#
# 決まるのは、`create_session` へ渡す次の値。
#
# - `ENV_ID` … 立てる先の環境ID
# - `MODE` … 承認モード。**空なら `permission_mode` を渡さない**、が呼び手の約束（`ccr-env.sh`）
# - `SOURCE` … `source_url` へ渡すリポジトリのURL。ブリッジでは空
#
# **渡す文面は投入先で変わらない**（`agent-ops/prompts/dispatch-prompt.md`「走る場所で文面を変えない」）。
choose_target() {
  if [ "${1:-}" = "--bridge" ]; then
    ENV_ID="$BRIDGE_ENV"
    MODE="$BRIDGE_MODE"
    SOURCE=""
  else
    ENV_ID="$CLOUD_ENV"
    MODE="$CLOUD_MODE"
    SOURCE="https://github.com/$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"
  fi
}

# セッションを1本立てて、届いたことを確かめる。**組み立てから確認までは1つの node の中**
# （[`dispatch-session.mjs`](dispatch-session.mjs)）——分けると投入1回あたりの node が増え、その数が
# そのまま常時の固定費になる（[`ccr-meta.mjs`](../../.claude/ccr-meta.mjs)「node から呼ぶ側は」）。
#
#   dispatch_session <関門の種類> <タグ…> -- <投入するものの種類> <dispatch-session.mjs へ渡す引数…>
#
# **順を持つのはここ。** `DRY_RUN` は立てないので関門の手前で降り、関門
# （[`may-dispatch.sh`](may-dispatch.sh)）は**立てる直前**に訊く——間が空くほど、その隙に他が
# 立てられる。呼ぶ側がこの順を覚えていると、片方だけ入れ替わっても誰も気づかない。
#
# **関門の終了コードはそのまま呼び手の終了コードになる**（`set -e`）。人が手綱で止めている周を
# 3で返すのはそのため——**盤面が進まない周を詰まりと読む側**が、人の意思で止まっている周を
# 数えないようにするのに要る（[`brake.sh`](brake.sh)）。
#
# 出すのは1行1件。
#
#   SESSION <セッションID>
#   SOURCES <リポジトリのURL>@<リビジョン>   … 空の箱で起動していないことの確認
#   一致 / 不一致                            … 送った指示が欠けずに届いたか
dispatch_session() {
  local -a gate=()
  while [ "$#" -gt 0 ] && [ "$1" != '--' ]; do
    gate+=("$1")
    shift
  done
  [ "$#" -gt 0 ] || {
    echo "dispatch_session: 関門と引数を \`--\` で区切る" >&2
    return 1
  }
  shift

  # 立てる先が決めるもの（`choose_target`）。**空なら渡さない**、が呼び手の約束（`ccr-env.sh`）。
  local -a where=(--env "$ENV_ID")
  [ -z "$SOURCE" ] || where+=(--source "$SOURCE")
  [ -z "$MODE" ] || where+=(--mode "$MODE")

  # **本文は頭だけに切る**——目で見たいのは引数の形（環境ID・タグ・`source_url`）で、指示の全文は
  # 邪魔になる。**`DRY_RUN=full` なら切らない**（埋めた値は本文の途中に出るので、そこを確かめる側は
  # こちらを使う）。
  if [ -n "${DRY_RUN:-}" ]; then
    node "$AGENT_DIR/dispatch-session.mjs" "$@" "${where[@]}" --dry-run "$DRY_RUN"
    return
  fi

  CCR_META="$CCR_META" bash "$AGENT_DIR/may-dispatch.sh" "${gate[@]}"
  node "$AGENT_DIR/dispatch-session.mjs" "$@" "${where[@]}"
}
