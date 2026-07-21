#!/bin/bash
# SessionStart hook: Claude Code on the web 用に .NET 8 SDK を用意し、
# `dotnet test Tests/Tests.csproj`（NUnit）と `python3 Tools/check_namespace.py`
# がそのまま回せる状態にする。
#
# この環境の egress プロキシは dotnet の SDK 配布 CDN（builds.dotnet.microsoft.com
# など）を 403 で拒否するため、公式インストールスクリプトは使えない。一方 Ubuntu の
# アーカイブと nuget.org は到達可能なので、apt から dotnet-sdk-8.0 を導入する。
# apt は HTTPS_PROXY(CONNECT) 経由でしか出られず http:// は 405 になるため、
# ソースを https:// に書き換えたうえでプロキシを明示して取得する。
#
# 冪等（SDK が既にあれば何もしない）・非対話。既定では Claude Code on the web
# （CLAUDE_CODE_REMOTE=true）でのみ実体処理を行う。
set -euo pipefail

# --- web(remote) 以外では何もしない -------------------------------------------
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

REPO_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# --- セッション用の環境変数を永続化（dotnet のバナー/テレメトリ抑制） ---------
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo 'export DOTNET_CLI_TELEMETRY_OPTOUT=1'
    echo 'export DOTNET_NOLOGO=1'
  } >> "$CLAUDE_ENV_FILE"
fi
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1

# --- 既に .NET 8 SDK があれば導入はスキップ（冪等） ---------------------------
if command -v dotnet >/dev/null 2>&1 && dotnet --list-sdks 2>/dev/null | grep -q '^8\.'; then
  echo "[session-start] .NET 8 SDK は既に導入済み: $(dotnet --version)"
else
  echo "[session-start] .NET 8 SDK を apt から導入します..."
  export DEBIAN_FRONTEND=noninteractive

  # apt をプロキシ(HTTPS CONNECT)で出せるようにする。archive/security を https:// に。
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources; do
    [ -f "$f" ] && sed -i \
      -e 's|http://archive.ubuntu.com|https://archive.ubuntu.com|g' \
      -e 's|http://security.ubuntu.com|https://security.ubuntu.com|g' "$f"
  done

  # メインの ubuntu.sources だけを更新（到達不能な PPA の 403 で失敗させない）。
  apt-get \
    -o Acquire::https::Proxy="${HTTPS_PROXY:-}" \
    -o Dir::Etc::sourcelist="sources.list.d/ubuntu.sources" \
    -o Dir::Etc::sourceparts="-" \
    update || true

  apt-get \
    -o Acquire::https::Proxy="${HTTPS_PROXY:-}" \
    install -y --no-install-recommends dotnet-sdk-8.0

  echo "[session-start] 導入完了: $(dotnet --version)"
fi

# --- NuGet 復元でコンテナのキャッシュを温める（初回 dotnet test を高速化） -----
# nuget.org はプロキシ経由で到達可能。ネットワークの一時失敗でセッション開始を
# 妨げないよう best-effort（失敗しても続行。dotnet test 側で再復元される）。
if [ -f "$REPO_DIR/Tests/Tests.csproj" ]; then
  echo "[session-start] NuGet パッケージを復元します..."
  dotnet restore "$REPO_DIR/Tests/Tests.csproj" \
    || echo "[session-start] 警告: restore に失敗しました（dotnet test 実行時に再試行されます）。"
fi

echo "[session-start] 準備完了。'dotnet test Tests/Tests.csproj' と 'python3 Tools/check_namespace.py' が利用できます。"
