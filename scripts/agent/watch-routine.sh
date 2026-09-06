#!/usr/bin/env bash
# 監視係を立てる Routine を、在るべき姿へ揃える（`.claude/board-design.md` 2.19）。
#
#   bash scripts/agent/watch-routine.sh
#   DRY_RUN=1 bash scripts/agent/watch-routine.sh
#
# 出力は1行。`CREATED <ID>`（無かったので作った）・`UPDATED <ID> <直した項目>`・`OK <ID>`（直すものが
# 無かった）。直せないずれは理由を stderr へ出して1で終わる。
#
# ## 何度打っても1本のまま
#
# **監視係は毎回これを打つ**（[`watch-prompt.md`](../../.claude/watch-prompt.md)）ので、**冪等で
# なければ発火のたびに Routine が増える。** 探す鍵は名前で、名前はプロンプトの `題:` の行が持つ
# ——係の題と Routine の名前を別々に持つと、片方だけ変えたときに次の登録が2本目を作る。
#
# ## 間隔は「毎時1回であること」で見る。綴りでは見ない
#
# **`0 * * * *` で登録すると、向こうが登録した分へ寄せて `<分> * * * *` として保存する**（「毎時、
# 今から」。Routine が毎時0分に揃って発火しないようにするため）。**綴りで突き合わせると毎回ずれる**
# ので、見るのは**毎時1回の形をしているか**だけ。ここで守りたいのは間隔が1時間であることで、何分に
# 発火するかは決めていない。
#
# ## 直せないずれは、直さずに言う
#
# `update_trigger` が替えられるのは名前・間隔・止め起こし・本文だけ。**投入先の環境と、常駐か
# 1回きりかは替えられない**ので、そこがずれていたら作り直すしかない。**ここでは消さない**——消して
# 作り直すと、人が手で立てた別物を名前の一致だけで消しうる。何がずれているかを出して人へ回す。

set -euo pipefail

# **毎時1回。** 何分に発火するかは決めていない（上の「間隔は毎時1回であることで見る」）。
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
# よこすのは `has_more` だけで、次を指す印が無い（2026-09-07 に実測）。**1回で引ける範囲に収まって
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
' "$LIST" "$NAME" "$INSTRUCTION" "$BRIDGE_ENV" "$CRON" "$WORK/args.json")

case "$DECISION" in
OK*)
  echo "$DECISION"
  exit 0
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
id=$(grep -o '{"trigger".*' "$WORK/done.json" | jq -r '.trigger.id // ""' || true)
[ -n "$id" ] || {
  echo "打った結果を読めなかった: $(cat "$WORK/done.json")" >&2
  exit 1
}

case "$DECISION" in
CREATE) echo "CREATED $id" ;;
*) echo "UPDATED ${DECISION#UPDATE }" ;;
esac
