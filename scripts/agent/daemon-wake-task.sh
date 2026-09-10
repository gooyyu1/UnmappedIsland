#!/usr/bin/env bash
# デーモンを起こす係を、このPCのタスクとして登録する（`.claude/board-design.md` 2.19）。
#
#   bash scripts/agent/daemon-wake-task.sh            # 登録する。何度打っても1本のまま
#   DRY_RUN=1 bash scripts/agent/daemon-wake-task.sh  # 登録せずに、渡すXMLを出す
#
# 出すのは1行（`REGISTERED <タスク名>`）。打てなければ理由を stderr へ出して1で終わる。
#
# **起こす者はデーモンの外に居なければならない**（2.19）。クラウドの cron ではなくこのPCのタスクに
# 置く理由は 2.19.2。
#
# ## 打つのは `daemon.sh start` の1行だけ
#
# **二重に立たない・落ちた跡の錠を取り上げる・本体を `origin/main` へ寄せる**は、全部あちらが持って
# いる（[`daemon.sh`](daemon.sh)「二重に起こさない」「立てるときは」）。ここに条件を書くと、同じ
# 判断が2箇所になる。
#
# ## 起こす口は、ログオンと毎時の2つ
#
# **再起動の直後**（ログオン）と、**落ちた跡**（毎時）で、拾う相手が違う。間隔が1時間なのは
# 2.19（出どころ: ユーザーの指示・2026-09-06）。
#
# ## 登録は XML で渡す
#
# 引数の口（`/SC`）は**引き金を1つしか渡せない**。XMLは UTF-16 で渡す——UTF-8 のまま渡すと
# `schtasks` が読めないと言って撥ねる。
#
# **`MSYS2_ARG_CONV_EXCL` を落とさない。** 手元の bash は `/query` のような引数をパスとみなして
# `C:/Program Files/Git/query` へ化けさせる（`CLAUDE.md`「一次レビュー」の `git show` と同じ）。

set -euo pipefail

NAME="${WAKE_TASK_NAME:-ClaudeCode-BoardDaemonWake}"

# 起こす先は**本体のチェックアウト**。作業ツリーから立てると、進めた本体は走らず、走る1本は古いまま
# 残る（`daemon.sh`「寄せる先と立てる先が同じでなければ」）。
common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || {
  echo "本体のチェックアウトが分からないので、登録する先を決められない" >&2
  exit 1
}
ROOT=$(cd "$(dirname "$common")" && pwd)

BASH_EXE=$(cygpath -w "$(command -v bash)" 2>/dev/null) || BASH_EXE="$(command -v bash)"
WHO="$(hostname)\\$(whoami)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# `&` はXMLでは書けない。**`cd` が転んだら打たない**ので、`;` ではなく `&&` で繋ぐ。
cat >"$WORK/task.xml" <<XML
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>$WHO</Author>
    <Description>盤面のデーモンを起こす。生きていれば何もしない（UnmappedIsland の .claude/board-design.md 2.19）。</Description>
  </RegistrationInfo>
  <Principals>
    <Principal id="Author">
      <UserId>$WHO</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
    <Hidden>true</Hidden>
    <Enabled>true</Enabled>
  </Settings>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$WHO</UserId>
    </LogonTrigger>
    <TimeTrigger>
      <StartBoundary>2026-09-11T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <Repetition>
        <Interval>PT1H</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </TimeTrigger>
  </Triggers>
  <Actions Context="Author">
    <Exec>
      <Command>$BASH_EXE</Command>
      <Arguments>-lc "cd '$ROOT' &amp;&amp; bash scripts/agent/daemon.sh start"</Arguments>
    </Exec>
  </Actions>
</Task>
XML

if [ -n "${DRY_RUN:-}" ]; then
  cat "$WORK/task.xml"
  exit 0
fi

# UTF-16LE（BOM付き）へ。`schtasks` は UTF-8 のXMLを読めない。
{
  printf '\xff\xfe'
  iconv -f UTF-8 -t UTF-16LE <"$WORK/task.xml"
} >"$WORK/task-utf16.xml"

if ! MSYS2_ARG_CONV_EXCL='*' schtasks /create /tn "\\$NAME" /xml "$(cygpath -w "$WORK/task-utf16.xml")" /f \
  >"$WORK/done.txt" 2>&1; then
  echo "登録できなかった: $(cat "$WORK/done.txt")" >&2
  exit 1
fi

# **登録できたかは引き直して見る。** `schtasks` は撥ねた理由を標準出力へ流して0で返すことがある。
if ! MSYS2_ARG_CONV_EXCL='*' schtasks /query /tn "\\$NAME" >/dev/null 2>&1; then
  echo "登録した直後に引けなかった: $NAME" >&2
  exit 1
fi

echo "REGISTERED $NAME"
