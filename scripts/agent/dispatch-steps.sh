#!/usr/bin/env bash
# `dispatch-*.sh` が共有する、投入の段取り。**シェルから `source` して使う。**
#
#   # shellcheck source=scripts/agent/dispatch-steps.sh
#   source "$(dirname "${BASH_SOURCE[0]}")/dispatch-steps.sh"
#   choose_target "$WHERE"                                     # ENV_ID・MODE・SOURCE が決まる
#   template_body "$TEMPLATE" "$INSTRUCTION"                   # ひな形から渡す本体を取り出す
#   …題・タグ・投入する前の関門は、投入するものごとに違うので呼ぶ側が持つ…
#   dump_dry_run "$WORK/args.json"                             # DRY_RUN が立っていれば、ここで終わる
#   create_session_and_check "$WORK/args.json" "$INSTRUCTION"  # 立てて、届いたことを確かめる
#
# **投入するものごとに違うのは、題・タグと、投入する前の関門だけ。** それ以外を写しで持つと、
# 片方だけ直したときに黙って食い違う。
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
CHECK_PROMPT="$AGENT_DIR/../../.claude/ccr-check-prompt.sh"
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
# **渡す文面は投入先で変わらない**（`.claude/dispatch-prompt.md`「走る場所で文面を変えない」）。
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

# 立てずに、渡す引数（`$1`）だけを見る（`DRY_RUN=1 bash …`）。**立っていなければ何もしない**ので、
# 呼ぶ側は「立っていたら抜ける」を覚えていなくてよい。
#
# **本文は頭だけに切る**——目で見たいのは引数の形（環境ID・タグ・`source_url`）で、指示の全文は
# 邪魔になる。**`DRY_RUN=full` なら切らない**（埋めた値は本文の途中に出るので、そこを確かめる側は
# こちらを使う）。
dump_dry_run() {
  [ -n "${DRY_RUN:-}" ] || return 0
  if [ "$DRY_RUN" = full ]; then
    jq . "$1"
  else
    jq '.prompt |= (split("\n") | .[0:3] | join("\n") + "\n…")' "$1"
  fi
  exit 0
}

# 渡す引数（`$1`）でセッションを立てて、届いたことを確かめる。出すのは1行1件。
#
#   SESSION <セッションID>
#   SOURCES <リポジトリのURL>@<リビジョン>   … 空の箱で起動していないことの確認
#   一致 / 不一致                            … 送った指示（`$2`）が化けずに届いたか
create_session_and_check() {
  local args="$1" instruction="$2" session sources
  # 応答は `<other-session>` の包みに入って返るので、中のJSONだけ取り出す。
  session=$(bash "$CCR_META" create_session <"$args" | grep -o '{"ccr".*' | jq -r '.ccr.id')
  [ -n "$session" ] && [ "$session" != "null" ] || {
    echo "セッションを立てられなかった" >&2
    return 1
  }
  echo "SESSION $session"

  # **渡した `source_url` が入ったかを見る**ので、渡していない（`choose_target` がブリッジを選んで
  # `SOURCE` を空にした）なら確かめるものが無い。
  if [ -n "$SOURCE" ]; then
    printf '{"session_id":"%s"}' "$session" >"$WORK/get.json"
    sources=$(bash "$CCR_META" get_session <"$WORK/get.json" | grep -o '{"ccr".*' |
      jq -r '.ccr.session_context.sources[]?.git_repository | "\(.url)@\(.revision)"')
    [ -n "$sources" ] || {
      echo "リポジトリが入っていない（空の箱で起動している）。畳んで立て直す。" >&2
      return 1
    }
    echo "SOURCES $sources"
  fi

  bash "$CHECK_PROMPT" "$session" "$instruction"
}
