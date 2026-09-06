#!/usr/bin/env bash
# 監視係の1回ぶん（`.claude/board-design.md` 2.19）。名乗り・前の周の畳み・デーモンの起こし・自分の
# Routine の直しを、この順で打つ。
#
#   bash scripts/agent/watch-routine.sh
#   DRY_RUN=1 bash scripts/agent/watch-routine.sh   # Routine をどう直すかだけ見る。外へは打たない
#
# 出力は1行1件。`SELF <ID>`・`TAGGED <ID>`・`DAEMON <生死>`・畳んだ相手（`archive-session.sh` の行）・
# `CREATED <ID>` / `UPDATED <ID> <直した項目>` / `OK <ID>`。打てなかった段があれば理由を stderr へ
# 出し、最後に1で終わる——**途中で降りない**。デーモンを起こすことと Routine を直すことは互いに
# 要らないので、片方が転んだからといってもう片方を落とす理由が無い。
#
# ## 打つのを1行にしてあるのは、分類器が中身を見ないから
#
# **Routine で立つセッションは `auto` で走る**（2.19.2）。`create_trigger` に承認モードの口が無く、
# ブリッジへ立てても渡せない。auto の分類器は**打った文字列で判断する**ので、
# `git worktree list | … | archive-session.sh` のような列は撥ねられ、3回続くとそこで手番が終わる
# （2026-09-06 に実測）。**`bash scripts/agent/watch-routine.sh` の1行なら中身は見られない。**
#
# だから係の本文（[`watch-prompt.md`](../../.claude/watch-prompt.md)）が持つのは、この1行を打って
# 結果を報告することだけ。**判断は1つも要らない**ので、ここに全部置いてある。
#
# ## 自分が誰かは、走っている場所が知っている
#
# 立った先の作業ツリーが `bridge-cse_<ID>` で、これが `session_<ID>`（2.11.1）。**渡されなくても
# 分かる**ので、係の本文はIDを持たない。`bridge-cse_*` の中で走っていないときは名乗らず、畳みも
# しない——**自分を除けないまま畳むと、報告を書く前に自分のコンテナが解放される。**
#
# ## デーモンは本体のチェックアウトから起こす
#
# 監視係の作業ツリーは、次の周がこの係を畳むときに消える。そこから立てたデーモンは足元ごと消える
# ので、`daemon.sh` は本体の側のものを打つ。
#
# ## 何度打っても Routine は1本のまま
#
# 探す鍵は名前で、名前は本文の `題:` の行が持つ——係の題と Routine の名前を別々に持つと、片方だけ
# 変えたときに次の登録が2本目を作る。
#
# **間隔は綴りではなく形で見る。** `0 * * * *` で登録すると、向こうは**登録した分へ寄せて
# `<分> * * * *` として保存する**（2026-09-06 に実測）。綴りで突き合わせると毎周ずれる。
#
# **直せないずれは、直さずに言う。** `update_trigger` が替えられるのは名前・間隔・止め起こし・本文
# だけで、**投入先の環境と、常駐か1回きりかは替えられない**。消して作り直す道は採らない——名前の
# 一致だけで、人が手で立てた別物を消しうる。

set -euo pipefail

# **毎時1回。** 何分に発火するかは決めていない（上の「間隔は綴りではなく形で見る」）。
CRON='0 * * * *'

# `%/*` は区切りが無いと文字列をそのまま返す。
HERE="${BASH_SOURCE[0]%/*}"
if [[ "$HERE" == "${BASH_SOURCE[0]}" ]]; then HERE='.'; fi
HERE="$(cd "$HERE" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

PROMPT="$ROOT/.claude/watch-prompt.md"
CCR_META="${CCR_META:-$ROOT/.claude/ccr-meta.sh}"

# shellcheck source=scripts/agent/ccr-env.sh
source "$HERE/ccr-env.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

failed=0

# --- 自分が誰か ---------------------------------------------------------------

# **`cd` する前に見る。** 立った先の作業ツリーで走り始めるので、ここでの `$PWD` だけが自分を指す。
SELF=''
case "${PWD##*/}" in
bridge-cse_*) SELF="session_${PWD##*/bridge-cse_}" ;;
esac
echo "SELF ${SELF:-なし}"

MAIN="$(cd "$(git rev-parse --git-common-dir 2>/dev/null || echo .)/.." 2>/dev/null && pwd)" || MAIN=''

if [ -z "${DRY_RUN:-}" ] && [ -n "$SELF" ]; then
  # **`chore-watch` を名乗る。** 次の周がこのタグで畳む相手を選ぶ。
  #
  # **付いたかは引き直して見る。** `set_session_tags` が返すのは打った件数だけ（`{"failed":null,
  # "updated":1}`）で、何が付いたかを言わない。次の周が畳めるかがここに掛かっているので、
  # 付いた側を読む。
  printf '{"session_ids":["%s"],"add":["chore-watch"]}' "$SELF" >"$WORK/tag.json"
  printf '{"session_id":"%s"}' "$SELF" >"$WORK/self.json"
  if bash "$CCR_META" set_session_tags <"$WORK/tag.json" >"$WORK/tagged.json" 2>&1 &&
    bash "$CCR_META" get_session <"$WORK/self.json" | grep -o '{"ccr".*' |
    jq -e '.ccr.tags | index("chore-watch")' >/dev/null; then
    echo "TAGGED $SELF"
  else
    echo "名乗れなかった。次の周がこのセッションを畳めない: $(cat "$WORK/tagged.json")" >&2
    failed=1
  fi
fi

# --- 前の周を畳む -------------------------------------------------------------

# **畳んでよいかを決めるのは [`archive-session.sh`](archive-session.sh)。** ここが渡すのは、この
# PCに作業ツリーを持つ相手から自分を除いたものだけで、`chore-watch` を持たない相手は向こうが
# `KEPT` として素通りさせる。**盤面はこの係を畳めない**（2.19.3）ので、ここで打つ。
if [ -z "${DRY_RUN:-}" ] && [ -n "$SELF" ] && [ -n "$MAIN" ]; then
  { (cd "$MAIN" && git worktree list --porcelain) |
    sed -n 's|^worktree .*/bridge-cse_|session_|p' >"$WORK/worktrees.txt"; } || true
  # `grep -v` は1行も残らないと1を返す。**残らない周がある**（作業ツリーが自分だけ）ので、そこで
  # 落とさない。
  grep -v "^$SELF\$" "$WORK/worktrees.txt" >"$WORK/sweep.txt" || true
  (cd "$MAIN" && CCR_META="$CCR_META" bash "$MAIN/scripts/agent/archive-session.sh" \
    --keep-untagged chore-watch) <"$WORK/sweep.txt"
fi

# --- デーモンを起こす ---------------------------------------------------------

if [ -z "${DRY_RUN:-}" ]; then
  if [ -z "$MAIN" ]; then
    echo "本体のチェックアウトが分からないので、デーモンを見られない" >&2
    failed=1
  else
    # `status` は生きていれば0。`start` は錠を取れなければ自分で引き返すので、走っているかを
    # ここで確かめる必要は無い（`daemon.sh`「二重に起こさない」）。
    beat=$(bash "$MAIN/scripts/agent/daemon.sh" status 2>&1) || beat=''
    if [ -n "$beat" ]; then
      echo "DAEMON $beat"
    elif woke=$(bash "$MAIN/scripts/agent/daemon.sh" start 2>&1); then
      echo "DAEMON $woke"
    else
      echo "デーモンを起こせなかった: $woke" >&2
      failed=1
    fi
  fi
fi

# --- 自分の Routine を直す ----------------------------------------------------

# 渡すのは囲みの中だけ（[`dispatch-chore.sh`](dispatch-chore.sh) と同じ形）。
INSTRUCTION="$WORK/prompt.md"
awk '/^````$/ { inside = !inside; if (!inside) exit; next } inside' "$PROMPT" >"$INSTRUCTION"
[ -s "$INSTRUCTION" ] || {
  echo "プロンプトの囲み（\`\`\`\`）が空: $PROMPT" >&2
  exit 1
}

# **日本語をシェル変数に載せない**（`dispatch-chore.sh` と同じ）。ファイルで node へ渡す。
NAME="$WORK/name.txt"
sed -n 's/^題: *//p' "$PROMPT" | head -1 >"$NAME"
[ -s "$NAME" ] || {
  echo "プロンプトに \`題:\` の行が無い: $PROMPT" >&2
  exit 1
}

# 登録済みの Routine を引く。**繰れない**——`list_triggers` は `cursor` を受けるが、応答に返して
# よこすのは `has_more` だけで、次を指す印が無い（2026-09-06 に実測）。**1回で引ける範囲に収まって
# いることを見て、収まっていなければ言う**——溢れた向こうに当たりが居ると、探して見つからなかった
# ことと区別が付かないまま2本目を作る。
#
# `recurring` で絞るのは、一度きりの Routine（`send_later` の跡）がそちらに溜まるから。
LIST="$WORK/triggers.json"
printf '{"limit":100,"recurring":true}' >"$WORK/query.json"
bash "$CCR_META" list_triggers <"$WORK/query.json" >"$LIST"
# **引けなかったら、道具が言った理由をそのまま出す**（`.claude/board-design.md` 1.7）。認証切れは
# JSONではなく1行の文で返るので、そのまま `jq` へ流すと解釈の失敗だけが残って理由が消える。
grep -q '^{"data"' "$LIST" || {
  echo "Routine の一覧を引けなかった: $(cat "$LIST")" >&2
  exit 1
}
[ "$(jq -r '.has_more' <"$LIST")" = false ] || {
  echo "周期の Routine が1回で引ける数を超えている。名前で探せないので、手で減らす。" >&2
  exit 1
}

# 何を打つかを決める。**出すのはASCIIの1行だけ**で、渡す本体は `args.json` へ書く。
DECISION=$(node -e '
  const fs = require("node:fs");
  const [listPath, namePath, promptPath, envId, cron, outPath] = process.argv.slice(1);
  const name = fs.readFileSync(namePath, "utf8").trim();
  const prompt = fs.readFileSync(promptPath, "utf8");
  const found = (JSON.parse(fs.readFileSync(listPath, "utf8")).data ?? []).filter(
    (trigger) => trigger.name === name,
  );
  if (found.length > 1) {
    console.error(`同じ名前の Routine が ${found.length} 本ある: ${found.map((t) => t.id).join(" ")}`);
    process.exit(1);
  }
  const it = found[0];
  if (it === undefined) {
    fs.writeFileSync(
      outPath,
      JSON.stringify({
        name,
        prompt,
        initiation: "human_request",
        cron_expression: cron,
        environment_id: envId,
        create_new_session_on_fire: true,
        notifications: {},
      }),
    );
    console.log("CREATE");
    process.exit(0);
  }
  const where = it.session_request?.environment_id ?? "";
  if (it.persist_session || where !== envId) {
    const how = it.persist_session ? "既存のセッションへ発火する形" : `投入先が ${where}`;
    console.error(`${it.id} は作り直さないと直せない（${how}）。手で消してから打ち直す。`);
    process.exit(1);
  }
  const patch = { trigger_id: it.id };
  const fixes = [];
  if (!it.enabled) {
    patch.enabled = true;
    fixes.push("enabled");
  }
  if (!/^[0-9]+ \* \* \* \*$/.test(it.cron_expression ?? "")) {
    patch.cron_expression = cron;
    fixes.push("cron");
  }
  if ((it.derived_state?.prompt ?? "") !== prompt) {
    patch.prompt = prompt;
    fixes.push("prompt");
  }
  if (fixes.length === 0) {
    console.log(`OK ${it.id}`);
    process.exit(0);
  }
  fs.writeFileSync(outPath, JSON.stringify(patch));
  console.log(`UPDATE ${it.id} ${fixes.join(",")}`);
' "$LIST" "$NAME" "$INSTRUCTION" "$BRIDGE_ENV" "$CRON" "$WORK/args.json") || exit 1

case "$DECISION" in
OK*)
  echo "$DECISION"
  exit "$failed"
  ;;
CREATE) TOOL=create_trigger ;;
UPDATE*) TOOL=update_trigger ;;
*)
  echo "決められなかった: $DECISION" >&2
  exit 1
  ;;
esac

if [ -n "${DRY_RUN:-}" ]; then
  echo "$DECISION"
  # 本文は長いので頭だけ。**直す項目に本文が入らない周もある**ので、無ければそのまま出す。
  jq 'if .prompt then .prompt |= (split("\n") | .[0:3] | join("\n") + "\n…") else . end' "$WORK/args.json"
  exit 0
fi

# **応答からJSONだけを取り出す。** `create_trigger` は、直した中身のJSONに続けて人向けの1行を返す
# ので、そのまま流すと JSON として読めない（`archive-session.sh` が `{"ccr"` を拾うのと同じ形）。
bash "$CCR_META" "$TOOL" <"$WORK/args.json" >"$WORK/done.json"
id=$(grep -o '{"trigger".*' "$WORK/done.json" | jq -r '.trigger.id // ""')
[ -n "$id" ] || {
  echo "打った結果を読めなかった: $(cat "$WORK/done.json")" >&2
  exit 1
}

case "$DECISION" in
CREATE) echo "CREATED $id" ;;
*) echo "UPDATED ${DECISION#UPDATE }" ;;
esac
exit "$failed"
